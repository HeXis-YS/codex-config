#!/usr/bin/env python3
"""Verify installed rules and skills, or the full installer contract, in isolated homes."""

import argparse
import hashlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile


PROFILES = {
    "deepseek": ("DeepSeek", "https://api.deepseek.com/"),
    "highgo": ("HighGo", "http://host.docker.internal:8080/v1/"),
    "openlux": ("OpenLux", "https://api.openlux.ai/v1/"),
    "cc-switch": ("CC Switch", "http://host.docker.internal:15721/v1/"),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(command, log, **kwargs):
    log.write(f"Command: {command!r}\n")
    log.flush()
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, **kwargs)
    log.write(result.stdout)
    log.write(f"Exit: {result.returncode}\n")
    log.flush()
    return result


def snapshot(directory):
    """Compare file contents, modes, directories and symlinks without logging secrets."""
    result = {}
    for path in sorted(directory.rglob("*")):
        mode = path.lstat().st_mode
        value = os.readlink(path) if path.is_symlink() else (
            hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None)
        result[str(path.relative_to(directory))] = (mode, value)
    return result


def isolated_environment(base, catalog=None):
    test_home, bin_dir, temporary = (base / name for name in ("home", "bin", "tmp"))
    for path in (test_home, bin_dir, temporary):
        path.mkdir(parents=True)
    stub = bin_dir / "codex"
    stub.write_text(
        '#!/bin/sh\n'
        'printf "%s\\n" "$*" >> "$VERIFY_CODEX_CALLS"\n'
        'case "$*" in\n'
        '  "app-server daemon restart")\n'
        '    echo "Verification: daemon restart intercepted"\n'
        '    exit "${VERIFY_DAEMON_EXIT:-0}" ;;\n'
        '  "debug models --bundled")\n'
        '    case "${VERIFY_CATALOG_MODE:-ok}" in\n'
        '      fail) echo "Injected catalog failure" >&2; exit 17 ;;\n'
        '      invalid) echo \'{"models":[{"slug":""}]}\'; exit 0 ;;\n'
        '    esac\n'
        '    [ -n "$VERIFY_CATALOG" ] && exec cat "$VERIFY_CATALOG" ;;\n'
        'esac\n'
        'echo "Unexpected Codex invocation during verification" >&2\nexit 1\n'
    )
    stub.chmod(0o755)
    env = dict(os.environ, HOME=str(test_home), CODEX_HOME=str(test_home / ".codex"),
               XDG_CONFIG_HOME=str(test_home / ".config"),
               GIT_CONFIG_GLOBAL=str(test_home / ".gitconfig"), GIT_CONFIG_NOSYSTEM="1",
               TMPDIR=str(temporary), PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
               VERIFY_CODEX_CALLS=str(base / "codex-calls"),
               VERIFY_CATALOG=str(catalog) if catalog else "",
               VERIFY_CATALOG_MODE="ok", VERIFY_DAEMON_EXIT="0")
    return test_home, env


def verify_files(root, test_home, skill_files):
    require((test_home / ".codex/AGENTS.md").read_bytes() == (root / "AGENTS.global.md").read_bytes(),
            "Installed AGENTS.md differs from AGENTS.global.md")
    for name, paths in skill_files.items():
        source_dir = root / "skills" / name
        installed_dir = test_home / ".codex/skills" / name
        installed_paths = sorted(path.relative_to(installed_dir)
                                 for path in installed_dir.rglob("*") if path.is_file())
        require(installed_paths == paths, f"Installed file list differs for skill {name}")
        for path in paths:
            require((installed_dir / path).read_bytes() == (source_dir / path).read_bytes(),
                    f"Installed skill file differs: {name}/{path}")


def verify_installer(root, base, log, baseline, retired_names):
    real_codex = shutil.which("codex")
    catalog = base / "bundled.json"
    _, catalog_env = isolated_environment(base / "catalog")
    log.write("Read bundled catalog with the real CLI in an isolated home\n")
    log.flush()
    with catalog.open("wb") as output:
        subprocess.run([real_codex, "debug", "models", "--bundled"], env=catalog_env,
                       stdout=output, stderr=log, check=True)
    log.write(f"Bundled catalog SHA256: {hashlib.sha256(catalog.read_bytes()).hexdigest()}\n")
    skill_files = {path.name: sorted(p.relative_to(path) for p in path.rglob("*") if p.is_file())
                   for path in (root / "skills").iterdir() if path.is_dir()}

    def copy_sources(destination):
        destination.mkdir()
        for name in ("install.sh", "config.toml", "AGENTS.global.md", "proxy-setup.cjs"):
            if (root / name).is_file():
                shutil.copy2(root / name, destination / name)
        for name in ("models", "skills"):
            shutil.copytree(root / name, destination / name)
        return destination

    def install(source, case, profile="deepseek", *, failure=None, env_changes=None, stub=None, seed=None):
        test_home, env = isolated_environment(base / case, catalog)
        if seed:
            seed(test_home)
        if env_changes:
            env.update(env_changes)
        if stub:
            executable = base / case / "bin" / stub[0]
            executable.write_text("#!/bin/sh\n" + stub[1] + "\n")
            executable.chmod(0o755)
        if failure:
            for name in (".codex/config.toml", ".codex/models.json", ".codex/AGENTS.md",
                         ".codex/skills/eli5/SKILL.md", ".agents/skills/eli5/SKILL.md",
                         ".local/bin/update-codex", ".config/git/ignore", ".gitconfig"):
                target = test_home / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("# Existing installation must survive preparation failure\n")
            before = snapshot(test_home)
        command = ["bash", str(source / "install.sh")]
        # Cover the default and both supported option spellings in the profile runs.
        if profile == "highgo":
            command.append("--profile=highgo")
        elif profile != "deepseek":
            command.extend(["--profile", profile])
        result = run(command, log, cwd=source, env=env)
        if failure:
            require(result.returncode != 0 and failure in result.stdout,
                    f"{case}: failed for an unexpected reason")
            require(snapshot(test_home) == before, f"{case}: modified the existing installation")
            calls = base / case / "codex-calls"
            require(not calls.exists() or "daemon restart" not in calls.read_text(),
                    f"{case}: restarted daemon after preparation failure")
        else:
            require(result.returncode == 0, f"{case}: install failed")
            if env.get("VERIFY_DAEMON_EXIT") != "0":
                require("warning: could not restart the app-server daemon" in result.stdout,
                        f"{case}: missing daemon warning")
        require(not list((test_home / ".codex").glob(".install.*")), f"{case}: staging leaked")
        require(not list((base / case / "tmp").iterdir()), f"{case}: temporary files leaked")
        log.write(f"PASS: {case}\n")
        return test_home, env

    baseline_source = None
    if baseline:
        baseline_source = copy_sources(base / "baseline-source")
        previous = subprocess.check_output(["git", "show", f"{baseline}:install.sh"], cwd=root)
        (baseline_source / "install.sh").write_bytes(previous)
        log.write(f"Baseline installer: {baseline}; SHA256: {hashlib.sha256(previous).hexdigest()}\n")

    for profile, (provider_name, base_url) in PROFILES.items():
        test_home, env = install(root, profile, profile)
        verify_files(root, test_home, skill_files)
        installed = test_home / ".codex"
        config = (installed / "config.toml").read_text()
        require('__PROVIDER_' not in config and config.count('[model_providers.') == 1
                and f'name = "{provider_name}"' in config and f'base_url = "{base_url}"' in config,
                f"{profile}: wrong provider configuration")
        expected_catalog = catalog if profile == "openlux" else root / "models" / f"{profile}.json"
        require((installed / "models.json").read_bytes() == expected_catalog.read_bytes(),
                f"{profile}: catalog differs from its source")
        for name in ("config.toml", "models.json", "AGENTS.md"):
            require((installed / name).stat().st_mode & 0o777 == 0o644, f"{profile}: wrong mode: {name}")
        if (root / "proxy-setup.cjs").is_file():
            require((installed / "proxy-setup.cjs").read_bytes() == (root / "proxy-setup.cjs").read_bytes(),
                    f"{profile}: proxy helper differs")
        require((test_home / ".config/git/ignore").read_bytes() == b".codex\n", "Wrong Git ignore file")
        require(not (test_home / ".local/bin").exists(), "Fresh install created the retired wrapper directory")
        for key, value in (("user.name", "HeXis-YS"), ("user.email", "40174982+HeXis-YS@users.noreply.github.com")):
            result = run(["git", "config", "--global", key], log, env=env)
            require(result.returncode == 0 and result.stdout.strip() == value, f"Wrong Git identity: {key}")
        expected_calls = (["debug models --bundled"] if profile == "openlux" else [])
        require((base / profile / "codex-calls").read_text().splitlines()
                == expected_calls + ["app-server daemon restart"], f"{profile}: unexpected CLI calls")
        # The real CLI parses each installed configuration; model output is input data, not a log.
        accepted = subprocess.run([real_codex, "debug", "models", "--bundled"], env=env,
                                  stdout=subprocess.PIPE, stderr=log, check=True)
        require(accepted.stdout == catalog.read_bytes(), f"{profile}: CLI returned a different bundled catalog")
        if baseline_source:
            old_home, _ = install(baseline_source, f"baseline-{profile}", profile)
            for name in ("config.toml", "models.json", "AGENTS.md"):
                require((old_home / ".codex" / name).read_bytes() == (installed / name).read_bytes(),
                        f"{profile}: {name} differs from baseline")
            log.write(f"PASS: {profile} baseline comparison\n")
        log.write(f"PASS: {profile} files, permissions and CLI parsing\n")

    retired_names = tuple(dict.fromkeys(("analyze", "write-code", "use-git", "write-lessons",
                                        "write-report", *retired_names)))

    def seed_migration(test_home):
        markers = [".agents/skills/write-todo/local-note", ".agents/skills/eli5/old-only",
                   ".codex/skills/eli5/current-only", ".local/bin/update-codex"]
        for directory in (".agents/skills", ".codex/skills"):
            markers.append(f"{directory}/unmanaged/keep")
            for name in retired_names:
                markers.append(f"{directory}/{name}/SKILL.md")
        for name in ("higress.config.toml", "gateway.config.toml", "models.gateway.json", "models.higress.json"):
            markers.append(f".codex/{name}")
        for name in markers:
            path = test_home / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("migration fixture\n")

    test_home, _ = install(root, "migration", seed=seed_migration)
    for name in (".codex/skills/write-todo/local-note", ".codex/skills/eli5/current-only",
                 ".agents/skills/unmanaged/keep", ".codex/skills/unmanaged/keep"):
        require((test_home / name).read_text() == "migration fixture\n", f"Migration lost {name}")
    for name in (".agents/skills/write-todo", ".agents/skills/eli5", ".codex/skills/eli5/old-only",
                 ".local/bin/update-codex", ".codex/higress.config.toml", ".codex/gateway.config.toml",
                 ".codex/models.gateway.json", ".codex/models.higress.json"):
        require(not (test_home / name).exists(), f"Migration retained {name}")
    for directory in (".agents/skills", ".codex/skills"):
        for name in retired_names:
            require(not (test_home / directory / name).exists(), f"Retired skill retained: {directory}/{name}")
    log.write("PASS: skill migration, existing extras, unmanaged skills and retired artifact cleanup\n")

    for case, filename, content, error in (
        ("missing-template", "config.toml", 'name = "missing"\n', "missing the __PROVIDER_NAME__"),
        ("invalid-catalog", "models/deepseek.json", '{"models":[{"slug":""}]}', "invalid model catalog"),
        ("unresolved-template", "config.toml", (root / "config.toml").read_text() + '\n# __PROVIDER_UNKNOWN__\n',
         "still contains a provider placeholder"),
    ):
        source = copy_sources(base / f"source-{case}")
        (source / filename).write_text(content)
        install(source, case, failure=error)
    source = copy_sources(base / "source-missing-metadata")
    (source / "skills/eli5/agents/openai.yaml").unlink()
    install(source, "missing-metadata", failure="required skill metadata is missing")
    for mode, error in (("fail", "failed to read the bundled"), ("invalid", "invalid model catalog")):
        install(root, f"bundled-{mode}", "openlux", failure=error, env_changes={"VERIFY_CATALOG_MODE": mode})
    install(root, "copy-failure", failure="Injected copy failure",
            stub=("cp", 'echo "Injected copy failure" >&2; exit 17'))
    install(root, "interrupted-preparation", failure="Injected interruption",
            stub=("cp", 'echo "Injected interruption" >&2; kill -TERM "$PPID"; exit 143'))
    test_home, _ = install(root, "daemon-warning", env_changes={"VERIFY_DAEMON_EXIT": "17"})
    verify_files(root, test_home, skill_files)
    log.write("PASS: preparation failures preserve existing files; interruption cleans staging; daemon failure only warns\n")


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Verify global rules and selected skills using the deepseek profile. "
        "Requires Bash, Git, jq and Codex. Writes a unique log "
        "under .codex/runs/; isolates installation and skips daemon restart."
    )
    parser.add_argument(
        "--skill", action="append", default=[],
        choices=sorted(path.name for path in (root / "skills").iterdir() if path.is_dir()),
        help="Also compare every file in this installed skill; repeat for multiple skills.",
    )
    parser.add_argument(
        "--retired-skill", action="append", default=[], metavar="NAME",
        help="Seed and verify removal of a retired skill from current and legacy paths; repeat as needed.",
    )
    parser.add_argument("--installer", action="store_true",
                        help="Check all four profiles, installed files and preparation failures.")
    parser.add_argument("--baseline", metavar="GIT_REF",
                        help="With --installer, compare successful installation outputs to an earlier installer.")
    args = parser.parse_args()
    if args.baseline and not args.installer:
        parser.error("--baseline requires --installer")
    retired_names = list(dict.fromkeys(args.retired_skill))
    for name in retired_names:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            parser.error(f"Invalid retired skill name: {name}")
    skill_files = {}
    for name in dict.fromkeys(args.skill):
        source_dir = root / "skills" / name
        skill_files[name] = sorted(path.relative_to(source_dir)
                                   for path in source_dir.rglob("*") if path.is_file())
    for command in ("bash", "git", "jq", "codex"):
        if shutil.which(command) is None:
            raise SystemExit(f"Required command is missing: {command}")
    run_dir = root / ".codex" / "runs"
    run_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", prefix="rules-install-", suffix=".log", dir=run_dir, delete=False
    ) as log:
        print(f"Log: {log.name}", flush=True)
        try:
            log.write(f"Environment: {platform.platform()}; Python {sys.version}\n")
            profiles = list(PROFILES) if args.installer else ["deepseek"]
            log.write(f"Entry: python3 scripts/verify-rules-install.py; profiles: {profiles}; "
                      f"skills: {list(skill_files)}; retired skills: {retired_names}; "
                      f"installer: {args.installer}; baseline: {args.baseline}\n")
            inputs = [Path(__file__).resolve(), root / "AGENTS.global.md",
                      root / "install.sh", root / "config.toml", root / "models/deepseek.json"]
            for name, paths in skill_files.items():
                inputs.extend(root / "skills" / name / path for path in paths)
            if args.installer:
                inputs.extend(path for name in ("models", "skills")
                              for path in (root / name).rglob("*") if path.is_file())
                if (root / "proxy-setup.cjs").is_file():
                    inputs.append(root / "proxy-setup.cjs")
            for path in inputs:
                log.write(f"SHA256 {path.relative_to(root)}: {hashlib.sha256(path.read_bytes()).hexdigest()}\n")
            # Record the worktree identity without copying configuration secrets into logs.
            diff = subprocess.check_output(["git", "diff", "HEAD", "--binary"], cwd=root)
            log.write(f"Worktree diff SHA256: {hashlib.sha256(diff).hexdigest()}\n")
            for command in (["git", "rev-parse", "HEAD"], ["git", "status", "--short"],
                            ["bash", "--version"], ["git", "--version"],
                            ["jq", "--version"], ["codex", "--version"]):
                log.flush()
                subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
            result = run(["bash", "-n", "install.sh"], log, cwd=root)
            require(result.returncode == 0, "Installer shell syntax check failed")
            with tempfile.TemporaryDirectory(prefix="rules-install-", dir=run_dir) as temporary:
                base = Path(temporary)
                if args.installer:
                    verify_installer(root, base, log, args.baseline, retired_names)
                    log.write("PASS: full installer verification\n")
                else:
                    test_home, env = isolated_environment(base)
                    retired_paths = []
                    unmanaged_markers = []
                    if retired_names:
                        for directory in (test_home / ".codex" / "skills", test_home / ".agents" / "skills"):
                            directory.mkdir(parents=True)
                            for name in retired_names:
                                retired = directory / name
                                retired.mkdir()
                                (retired / "SKILL.md").write_text("Retired skill verification fixture\n")
                                retired_paths.append(retired)
                            unmanaged = Path(tempfile.mkdtemp(prefix="unmanaged-", dir=directory))
                            marker = unmanaged / "SKILL.md"
                            marker.write_bytes(b"Unmanaged skill must be preserved\n")
                            unmanaged_markers.append(marker)
                        log.write(f"Seeded retired skills in current and legacy paths: {retired_names}\n")
                    log.write(f"Isolated installation: {test_home}; daemon restart stubbed\n")
                    log.flush()
                    subprocess.run(["bash", "install.sh", "--profile", "deepseek"], cwd=root,
                                   env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
                    verify_files(root, test_home, skill_files)
                    log.write("PASS: installed AGENTS.md is byte-identical to AGENTS.global.md\n")
                    for name, paths in skill_files.items():
                        log.write(f"PASS: skill {name}, {len(paths)} files are byte-identical\n")
                    for path in retired_paths:
                        if path.exists() or path.is_symlink():
                            raise RuntimeError(f"Retired skill was not removed: {path.relative_to(test_home)}")
                        log.write(f"PASS: retired skill removed: {path.relative_to(test_home)}\n")
                    for marker in unmanaged_markers:
                        if marker.read_bytes() != b"Unmanaged skill must be preserved\n":
                            raise RuntimeError(f"Unmanaged skill changed: {marker.relative_to(test_home)}")
                        log.write(f"PASS: unmanaged skill preserved: {marker.relative_to(test_home)}\n")
            log.write("PASS: temporary installation removed\n")
        except Exception as error:
            log.write(f"FAIL: {error}\n")
            raise
    print("PASS: full installer verification" if args.installer else
          "PASS: isolated installation of global rules and selected skills")


if __name__ == "__main__":
    main()
