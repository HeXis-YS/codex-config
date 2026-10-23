#!/usr/bin/env python3
"""Run install.sh in an isolated home and verify the installed global rules."""

import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile


def main():
    argparse.ArgumentParser(
        description="Verify global-rule installation using the deepseek profile. "
        "Requires Bash, Git, jq, Codex and GitHub access. Writes a unique log "
        "under .codex/runs/; isolates installation and skips daemon restart."
    ).parse_args()
    root = Path(__file__).resolve().parent.parent
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
            log.write("Entry: python3 scripts/verify-rules-install.py; profile: deepseek\n")
            for path in (Path(__file__).resolve(), root / "AGENTS.global.md",
                         root / "install.sh", root / "config.toml", root / "models/deepseek.json"):
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
            log.write("PASS: temporary installation removed\n")
        except Exception as error:
            log.write(f"FAIL: {error}\n")
            raise
    print("PASS: isolated global-rule installation")


if __name__ == "__main__":
    main()
