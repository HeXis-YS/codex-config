#!/usr/bin/env bash
set -euo pipefail

die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

if [ "$#" -ne 0 ]; then
    if [ "$#" -eq 1 ] && [ "$1" = --help ]; then
        printf 'usage: %s\n' "${0##*/}"
        printf 'Host: install shared skills to ~/.local/state/sandboxes/sandboxes/agent-skills.\n'
        printf 'Container: install OpenCode configuration, rules, plugins, and Git settings.\n'
        printf 'Container skills are installed unless their filesystem is mounted read-only.\n'
        exit 0
    fi
    die 'no profiles are supported; usage: install.sh'
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
: "${HOME:?HOME must be set}"
container=false
if [ -n "${SANDBOX_ID:-}" ] || [ -f /.dockerenv ] || [ -f /run/.containerenv ] \
    || grep -Eq '(^|/)(docker|kubepods|containerd|libpod|lxc)([-/.:]|$)' /proc/1/cgroup; then
    container=true
fi

manage_skills=true
if "$container"; then
    if ! command -v opencode >/dev/null; then
        command -v curl >/dev/null || die 'curl command not found'
        curl -fsSL https://opencode.ai/v2/install | bash
        PATH="$HOME/.opencode/bin:$PATH"
        export PATH
        command -v opencode >/dev/null || die 'opencode installation failed'
    fi
    command -v git >/dev/null || die 'git command not found'
    command -v findmnt >/dev/null || die 'findmnt command not found'
    target="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    skills_target="$target/skills"
    # Check mount flags, not permissions: an unwritable local directory is an error.
    mount_path="$skills_target"
    while [ ! -e "$mount_path" ]; do
        mount_path="$(dirname -- "$mount_path")"
    done
    mount_options="$(findmnt -n -o VFS-OPTIONS -T "$mount_path")" \
        || die "could not inspect mount for $skills_target"
    case ",$mount_options," in
        *,ro,*) manage_skills=false ;;
    esac

    for source in templates/opencode.json AGENTS.global.md; do
        [ -f "$script_dir/$source" ] || die "missing $source"
    done
    [ -d "$script_dir/models-md" ] || die 'missing models-md'
    [ -f "$script_dir/plugins/cap-context.ts" ] || die 'missing cap-context.ts plugin'
else
    skills_target="$HOME/.local/state/sandboxes/sandboxes/agent-skills"
fi

if "$manage_skills"; then
    shopt -s nullglob
    skills=("$script_dir"/skills/*)
    shopt -u nullglob
    [ "${#skills[@]}" -gt 0 ] || die 'no skills found'
    for skill in "${skills[@]}"; do
        [ -f "$skill/SKILL.md" ] || die "missing SKILL.md in $skill"
    done
fi

install_skills() {
    mkdir -p "$skills_target"
    for skill in "${skills[@]}"; do
        mkdir -p "$skills_target/${skill##*/}"
        cp -a "$skill/." "$skills_target/${skill##*/}/"
    done
    # The merged skill replaces record-incident/score-incident; the three model
    # instructions now live outside the skills directory.
    for obsolete in record-incident score-incident \
        avoid-overengineering calibrate-fable constrain-opus; do
        dir="$skills_target/$obsolete"
        rm -f -- "$dir/SKILL.md"
        if [ -f "$dir/references/verification.md" ]; then
            rm -f -- "$dir/references/verification.md"
            rmdir --ignore-fail-on-non-empty -- "$dir/references" 2>/dev/null || true
        fi
        if [ -d "$dir" ]; then
            rmdir --ignore-fail-on-non-empty -- "$dir" 2>/dev/null || true
        fi
    done
    printf 'Installed skills to %s\n' "$skills_target"
}

if ! "$container"; then
    install_skills
    exit 0
fi

mkdir -p "$target"
config="$target/opencode.json"
if [ -e "$config" ]; then
    [ -f "$config" ] || die "not a regular file: $config"
fi
install -m 0600 "$script_dir/templates/opencode.json" "$config"
install -m 0644 "$script_dir/AGENTS.global.md" "$target/AGENTS.md"
# Model instructions mirror the models-md layout in the config directory; the
# plugin reads them on each request and never registers them as skills.
mkdir -p "$target/models-md"
# Remove artifacts from earlier layouts: copied model bodies and a separate
# reference file that now lives inside gpt-6.md.
if [ -d "$target/model-skills" ]; then
    rm -rf -- "$target/model-skills"
fi
rm -f -- "$target/models-md/references/verification.md" "$target/models-md/gpt.md"
rmdir --ignore-fail-on-non-empty -- "$target/models-md/references" 2>/dev/null || true
cp -a "$script_dir/models-md/." "$target/models-md/"
if "$manage_skills"; then
    install_skills
else
    # A read-only mount may predate the move to models-md; only the host can
    # remove those copies, and until then they would also be exposed as skills.
    stale=
    for skill in avoid-overengineering calibrate-fable constrain-opus; do
        if [ -e "$skills_target/$skill" ]; then
            stale="$stale $skill"
        fi
    done
    if [ -n "$stale" ]; then
        printf 'install.sh: shared skills still contain old model skills:%s\n' "$stale" >&2
        printf 'install.sh: run install.sh on the host to remove them.\n' >&2
    fi
    printf 'Shared skills at %s are mounted read-only; left unchanged.\n' "$skills_target"
fi
mkdir -p "$target/plugins"
install -m 0644 "$script_dir/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
rm -f -- "$target/plugins/inject-model-skills.ts"
git config --global user.email '40174982+HeXis-YS@users.noreply.github.com'
git config --global user.name 'HeXis-YS'
git_ignore_dir="${XDG_CONFIG_HOME:-$HOME/.config}/git"
mkdir -p "$git_ignore_dir"
printf '%s\n' '.opencode' '.codex' > "$git_ignore_dir/ignore"
printf 'Installed OpenCode configuration, rules, and plugins to %s\n' "$target"
