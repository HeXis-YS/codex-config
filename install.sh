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

default_profile=""

usage() {
    printf 'usage: %s [--profile <name>]\n' "${0##*/}" >&2
    printf '  Installs the repository config. With --profile <name>, the installed\n' >&2
    printf '  ~/.codex/config.toml takes model, model_provider and model_catalog_json\n' >&2
    printf '  from <name>.config.toml, so that profile becomes the default provider.\n' >&2
    printf '  Without --profile the repository default config is installed unchanged.\n' >&2
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --profile)
                [ "$#" -ge 2 ] || die 'the --profile option requires a name'
                default_profile="$2"
                shift 2
                ;;
            --profile=*)
                default_profile="${1#--profile=}"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                usage
                die "unknown argument: $1"
                ;;
        esac
    done
}

# Print the value of a top-level `key = "value"` line from a profile file.
profile_value() {
    sed -n "s/^$2 = \"\\(.*\\)\"\$/\\1/p" "$1" | head -n 1
}

# Make one profile the default provider in an installed config.toml.
apply_profile_defaults() {
    local profile_source="$1"
    local target_config="$2"
    local selected_model selected_provider selected_catalog
    selected_model="$(profile_value "$profile_source" model)"
    selected_provider="$(profile_value "$profile_source" model_provider)"
    selected_catalog="$(profile_value "$profile_source" model_catalog_json)"
    [ -n "$selected_provider" ] || die "$profile_source does not set model_provider"
    [ -n "$selected_model" ] || die "$profile_source does not set model"
    sed -i \
        -e "s|^model = \".*\"\$|model = \"$selected_model\"|" \
        -e "s|^model_provider = \".*\"\$|model_provider = \"$selected_provider\"|" \
        "$target_config"
    if [ -n "$selected_catalog" ]; then
        sed -i -e "s|^model_catalog_json = \".*\"\$|model_catalog_json = \"$selected_catalog\"|" \
            "$target_config"
    fi
}

parse_args "$@"
# Check codex before attempting any package-manager operation.
command_exists codex || die 'codex command was not found; install Codex CLI and retry.'
command_exists git || die 'git command was not found; install Git and retry.'

if ! command_exists jq; then
    install_jq
fi

: "${HOME:?HOME must be set before running this script.}"

# Configure a stable global Git identity for commits made from this environment.
git config --global user.email "40174982+HeXis-YS@users.noreply.github.com"
git config --global user.name "HeXis-YS"

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

catalog_sources=("$script_dir/models/deepseek.json" "$script_dir/models/higress.json")
for catalog_source in "${catalog_sources[@]}"; do
    [ -f "$catalog_source" ] || die "required model catalog is missing: $catalog_source"
done
shopt -s nullglob
profile_files=("$script_dir"/*.config.toml)
shopt -u nullglob
[ "${#profile_files[@]}" -gt 0 ] || die "no profile file (*.config.toml) was found in $script_dir"

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
for profile_file in "${profile_files[@]}"; do
    [ -f "$profile_file" ] || die "profile is not a regular file: $profile_file"
    install -m 0644 "$profile_file" "$codex_dir/${profile_file##*/}"
done
if [ -n "$default_profile" ]; then
    selected_profile_source="$script_dir/$default_profile.config.toml"
    [ -f "$selected_profile_source" ] \
        || die "unknown profile: $default_profile (no such file $selected_profile_source)"
    apply_profile_defaults "$selected_profile_source" "$codex_dir/config.toml"
fi
# Remove the renamed profile and catalog installed by earlier versions of this repository.
for stale_artifact in "$codex_dir/gateway.config.toml" "$codex_dir/models.gateway.json"; do
    if [ -e "$stale_artifact" ] || [ -L "$stale_artifact" ]; then
        rm -f -- "$stale_artifact"
    fi
done
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

catalog_targets=("$codex_dir/models.json" "$codex_dir/models.higress.json")
for catalog_index in "${!catalog_sources[@]}"; do
    catalog_source="${catalog_sources[$catalog_index]}"
    catalog_target="${catalog_targets[$catalog_index]}"
    jq -e "$catalog_filter" "$catalog_source" >/dev/null \
        || die "invalid model catalog fragment: $catalog_source"

    # Stage the catalog beside its destination so an interrupted copy cannot leave a partial file.
    staged_models="$(mktemp "$codex_dir/.models.json.XXXXXX")" \
        || die "failed to create a staging file in $codex_dir"
    install -m 0644 "$catalog_source" "$staged_models" \
        || die "failed to stage the model catalog in $codex_dir"
    mv -f "$staged_models" "$catalog_target" \
        || die "failed to install the model catalog in $codex_dir"
    staged_models=""
done

printf 'Installed Codex configuration to %s\n' "$codex_dir"
for catalog_target in "${catalog_targets[@]}"; do
    printf 'Installed %s models to %s\n' "$(jq '.models | length' "$catalog_target")" "$catalog_target"
done
printf 'Installed ELI5 skill to %s\n' "$eli5_install_dir"
if [ -n "$default_profile" ]; then
    printf 'Default provider taken from profile %s\n' "$default_profile"
fi
