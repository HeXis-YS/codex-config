#!/usr/bin/env bash
set -euo pipefail

# Install the Codex CLI non-interactively; install.sh requires an installed
# `codex` command. The official installer is piped into sh: without
# `-o pipefail` above, a failed download would be masked by sh's exit status,
# so the pipeline failure must abort the script instead.
installer_url='https://chatgpt.com/codex/install.sh'
# install.sh installs this file as `update-codex`, so report the invoked name.
script_name="${0##*/}"

if ! command -v curl >/dev/null 2>&1; then
    printf '%s: curl is required to download %s\n' "$script_name" "$installer_url" >&2
    exit 1
fi

# A global npm install of Codex would keep winning on PATH even after the
# standalone install, so drop that package first. npm being available is the
# whole test: uninstalling a package that is not installed is a no-op, and npm
# reports it as `up to date` with exit status 0.
if command -v npm >/dev/null 2>&1; then
    printf 'Uninstalling the global npm package @openai/codex\n' >&2
    if ! npm uninstall --global @openai/codex; then
        printf '%s: warning: could not uninstall the global npm package @openai/codex; continuing with the standalone install\n' "$script_name" >&2
    fi
    hash -r 2>/dev/null || true
fi

printf 'Installing the Codex CLI from %s\n' "$installer_url" >&2
curl -fsSL "$installer_url" | CODEX_NON_INTERACTIVE=1 sh

if command -v codex >/dev/null 2>&1; then
    printf 'Codex CLI installed: %s\n' "$(command -v codex)"
else
    printf '%s: the installer finished, but codex is not on PATH in this shell; open a new shell before running ./install.sh\n' "$script_name" >&2
fi
