#!/usr/bin/env bash
set -euo pipefail

# Install the Codex CLI non-interactively; install.sh requires an installed
# `codex` command. The official installer is piped into sh: without
# `-o pipefail` above, a failed download would be masked by sh's exit status,
# so the pipeline failure must abort the script instead.
installer_url='https://chatgpt.com/codex/install.sh'

if ! command -v curl >/dev/null 2>&1; then
    printf 'install-codex.sh: curl is required to download %s\n' "$installer_url" >&2
    exit 1
fi

# The official installer detects an existing npm-managed `codex` but, under
# CODEX_NON_INTERACTIVE=1, only warns and leaves it in place; PATH order would
# then keep that old copy in front of the standalone install.
codex_bin_dir="${CODEX_INSTALL_DIR:-$HOME/.local/bin}"
existing_codex="$(command -v codex 2>/dev/null || true)"
if [ -n "$existing_codex" ] && [ "$existing_codex" != "$codex_bin_dir/codex" ]; then
    if [ "$(head -n 1 "$existing_codex" 2>/dev/null || true)" = '#!/usr/bin/env node' ]; then
        printf 'Uninstalling the npm-managed Codex at %s\n' "$existing_codex" >&2
        if ! npm uninstall --global @openai/codex; then
            printf 'install-codex.sh: failed to uninstall the npm-managed Codex at %s\n' "$existing_codex" >&2
            exit 1
        fi
        hash -r 2>/dev/null || true
    fi
fi

printf 'Installing the Codex CLI from %s\n' "$installer_url" >&2
curl -fsSL "$installer_url" | CODEX_NON_INTERACTIVE=1 sh

if command -v codex >/dev/null 2>&1; then
    printf 'Codex CLI installed: %s\n' "$(command -v codex)"
else
    printf 'install-codex.sh: the installer finished, but codex is not on PATH in this shell; open a new shell before running ./install.sh\n' >&2
fi
