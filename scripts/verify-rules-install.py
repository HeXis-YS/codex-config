#!/usr/bin/env python3
"""Run install.sh in an isolated home and verify rules and selected skills."""

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
    args = parser.parse_args()
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
            log.write(f"Entry: python3 scripts/verify-rules-install.py; profile: deepseek; "
                      f"skills: {list(skill_files)}; retired skills: {retired_names}\n")
            inputs = [Path(__file__).resolve(), root / "AGENTS.global.md",
                      root / "install.sh", root / "config.toml", root / "models/deepseek.json"]
            for name, paths in skill_files.items():
                inputs.extend(root / "skills" / name / path for path in paths)
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
            with tempfile.TemporaryDirectory(prefix="rules-install-", dir=run_dir) as temporary:
                base = Path(temporary)
                test_home = base / "home"
                test_home.mkdir()
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
                bin_dir = base / "bin"
                bin_dir.mkdir()
                stub = bin_dir / "codex"
                stub.write_text(
                    '#!/bin/sh\n'
                    'if [ "$#" -eq 3 ] && [ "$1" = app-server ] && '
                    '[ "$2" = daemon ] && [ "$3" = restart ]; then\n'
                    '  echo "Verification: daemon restart skipped"\n'
                    '  exit 0\nfi\n'
                    'echo "Unexpected Codex invocation during verification" >&2\nexit 1\n'
                )
                stub.chmod(0o755)
                # Override paths only for the installer child process; keep the caller's environment.
                env = dict(os.environ, HOME=str(test_home), CODEX_HOME=str(test_home / ".codex"),
                           XDG_CONFIG_HOME=str(test_home / ".config"),
                           GIT_CONFIG_GLOBAL=str(test_home / ".gitconfig"),
                           PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])
                log.write(f"Isolated installation: {test_home}; daemon restart stubbed\n")
                log.flush()
                subprocess.run(["bash", "install.sh", "--profile", "deepseek"], cwd=root,
                               env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
                source = (root / "AGENTS.global.md").read_bytes()
                installed = (test_home / ".codex" / "AGENTS.md").read_bytes()
                if installed != source:
                    raise RuntimeError("Installed AGENTS.md differs from AGENTS.global.md")
                log.write("PASS: installed AGENTS.md is byte-identical to AGENTS.global.md\n")
                for name, paths in skill_files.items():
                    source_dir = root / "skills" / name
                    installed_dir = test_home / ".codex" / "skills" / name
                    installed_paths = sorted(path.relative_to(installed_dir)
                                             for path in installed_dir.rglob("*") if path.is_file())
                    if installed_paths != paths:
                        raise RuntimeError(f"Installed file list differs for skill {name}")
                    for path in paths:
                        if (installed_dir / path).read_bytes() != (source_dir / path).read_bytes():
                            raise RuntimeError(f"Installed skill file differs: {name}/{path}")
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
    print("PASS: isolated installation of global rules and selected skills")


if __name__ == "__main__":
    main()
