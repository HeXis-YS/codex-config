#!/usr/bin/env bash
set -euo pipefail

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

die() {
    printf 'install.sh: %s\n' "$*" >&2
    exit 1
}

run_privileged() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif command_exists sudo; then
        sudo "$@"
    else
        die "jq is missing, and installing it requires root privileges or sudo."
    fi
}

install_jq() {
    printf '%s\n' 'jq was not found; attempting automatic installation.' >&2

    command_exists apt-get || die 'jq is missing and apt-get was not found.'
    run_privileged apt-get update || die 'failed to update the apt package index.'
    run_privileged apt-get install -y jq || die 'failed to install jq with apt-get.'

    hash -r 2>/dev/null || true
    command_exists jq || die 'jq installation completed, but jq is still unavailable on PATH.'
}

# Check codex before attempting any package-manager operation.
command_exists codex || die 'codex command was not found; install Codex CLI and retry.'
command_exists git || die 'git command was not found; install Git and retry.'

if ! command_exists jq; then
    install_jq
fi

: "${HOME:?HOME must be set before running this script.}"

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
codex_dir="$HOME/.codex"
git_ignore_dir="$HOME/.config/git"
skills_source_dir="$script_dir/skills"
legacy_skills_install_dir="$HOME/.agents/skills"
skills_install_dir="$HOME/.codex/skills"
eli5_repo_url="https://github.com/DreambigOu/ELI5.git"
eli5_install_dir="$skills_install_dir/eli5"
retired_skills=(analyze write-code use-git)

# Keep the source outside Codex's discovery names so this repository does not load it twice.
for source_file in config.toml AGENTS.global.md; do
    [ -f "$script_dir/$source_file" ] || die "required source file is missing: $script_dir/$source_file"
done
[ -d "$script_dir/models" ] || die "required model directory is missing: $script_dir/models"
[ -d "$skills_source_dir" ] || die "required skill directory is missing: $skills_source_dir"

shopt -s nullglob
skill_source_dirs=("$skills_source_dir"/*)
shopt -u nullglob

catalog_file="$script_dir/models/deepseek.json"
[ -f "$catalog_file" ] || die "required model catalog is missing: $catalog_file"

[ "${#skill_source_dirs[@]}" -gt 0 ] || die "no skills were found in $skills_source_dir"
for skill_source_dir in "${skill_source_dirs[@]}"; do
    [ -d "$skill_source_dir" ] || die "skill source is not a directory: $skill_source_dir"
    [ -f "$skill_source_dir/SKILL.md" ] \
        || die "required skill file is missing: $skill_source_dir/SKILL.md"
    [ -f "$skill_source_dir/agents/openai.yaml" ] \
        || die "required skill metadata is missing: $skill_source_dir/agents/openai.yaml"
done

managed_skill_names=(eli5)
for skill_source_dir in "${skill_source_dirs[@]}"; do
    managed_skill_names+=("${skill_source_dir##*/}")
done

staged_models=""
eli5_tmp_dir=""
cleanup() {
    if [ -n "$staged_models" ] && [ -e "$staged_models" ]; then
        rm -f -- "$staged_models"
    fi
    if [ -n "$eli5_tmp_dir" ] && [ -d "$eli5_tmp_dir" ]; then
        rm -rf -- "$eli5_tmp_dir"
    fi
}
trap cleanup EXIT

mkdir -p "$codex_dir" "$git_ignore_dir" "$skills_install_dir"
# Migrate skills previously installed to the legacy Codex user-skill directory.
if [ -d "$legacy_skills_install_dir" ]; then
    for skill_name in "${managed_skill_names[@]}"; do
        legacy_skill_dir="$legacy_skills_install_dir/$skill_name"
        new_skill_dir="$skills_install_dir/$skill_name"
        if [ -e "$legacy_skill_dir" ] || [ -L "$legacy_skill_dir" ]; then
            if [ -e "$new_skill_dir" ] || [ -L "$new_skill_dir" ]; then
                rm -rf -- "$legacy_skill_dir"
            else
                mv -- "$legacy_skill_dir" "$new_skill_dir"
            fi
        fi
    done
    for retired_skill in "${retired_skills[@]}"; do
        legacy_retired_dir="$legacy_skills_install_dir/$retired_skill"
        if [ -e "$legacy_retired_dir" ] || [ -L "$legacy_retired_dir" ]; then
            rm -rf -- "$legacy_retired_dir"
        fi
    done
    rmdir "$legacy_skills_install_dir" 2>/dev/null || true
fi

install -m 0644 "$script_dir/config.toml" "$codex_dir/config.toml"
install -m 0644 "$script_dir/AGENTS.global.md" "$codex_dir/AGENTS.md"
for skill_source_dir in "${skill_source_dirs[@]}"; do
    skill_name="${skill_source_dir##*/}"
    skill_install_dir="$skills_install_dir/$skill_name"
    mkdir -p "$skill_install_dir"
    cp -a "$skill_source_dir/." "$skill_install_dir/"
done
# Remove only the skill names previously managed by this repository.
for retired_skill in "${retired_skills[@]}"; do
    retired_skill_dir="$skills_install_dir/$retired_skill"
    if [ -e "$retired_skill_dir" ] || [ -L "$retired_skill_dir" ]; then
        rm -rf -- "$retired_skill_dir"
    fi
done
printf '%s\n' '.codex' > "$git_ignore_dir/ignore"

eli5_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-config-eli5.XXXXXX")" \
    || die 'failed to create a temporary directory for ELI5.'
eli5_repo_dir="$eli5_tmp_dir/ELI5"
git clone --depth 1 "$eli5_repo_url" "$eli5_repo_dir" \
    || die 'failed to clone the ELI5 skill repository.'
eli5_source_dir="$eli5_repo_dir/skills/eli5"
[ -f "$eli5_source_dir/SKILL.md" ] \
    || die 'the ELI5 repository does not contain skills/eli5/SKILL.md.'

if [ -d "$eli5_install_dir" ]; then
    cp -a "$eli5_source_dir/." "$eli5_install_dir/"
elif [ -e "$eli5_install_dir" ] || [ -L "$eli5_install_dir" ]; then
    die "ELI5 install path is not a directory: $eli5_install_dir"
else
    cp -a "$eli5_source_dir" "$eli5_install_dir"
fi

catalog_filter='
    type == "object"
    and ((.models | type) == "array")
    and all(.models[];
        type == "object"
        and ((.slug | type) == "string")
        and ((.slug | length) > 0)
    )
'

jq -e "$catalog_filter" "$catalog_file" >/dev/null \
    || die "invalid model catalog fragment: $catalog_file"

# Stage the catalog beside its destination so an interrupted copy cannot leave a partial file.
staged_models="$(mktemp "$codex_dir/.models.json.XXXXXX")" \
    || die "failed to create a staging file in $codex_dir"
install -m 0644 "$catalog_file" "$staged_models" \
    || die "failed to stage the model catalog in $codex_dir"
mv -f "$staged_models" "$codex_dir/models.json" \
    || die "failed to install the model catalog in $codex_dir"
staged_models=""

model_count="$(jq '.models | length' "$codex_dir/models.json")"
printf 'Installed Codex configuration and %s models to %s\n' "$model_count" "$codex_dir"
printf 'Installed ELI5 skill to %s\n' "$eli5_install_dir"
