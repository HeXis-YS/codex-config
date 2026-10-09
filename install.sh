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

selected_profile=""

usage() {
    printf 'usage: %s [--profile <name>]\n' "${0##*/}" >&2
    printf '  Installs config.toml, global rules, skills, and the model list of the\n' >&2
    printf '  selected profile as ~/.codex/models.json. --profile <name> also points\n' >&2
    printf '  the custom provider of the installed config at that backend.\n' >&2
    printf '  Profiles: deepseek (default), higress, openlux.\n' >&2
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --profile)
                [ "$#" -ge 2 ] || die 'the --profile option requires a name'
                selected_profile="$2"
                shift 2
                ;;
            --profile=*)
                selected_profile="${1#--profile=}"
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

parse_args "$@"
case "$selected_profile" in
    ""|deepseek|higress|openlux) ;;
    *) die "unknown profile: $selected_profile (expected deepseek, higress, or openlux)" ;;
esac
deepseek_provider='[model_providers.custom]
name = "hexis.moe"
base_url = "https://api.deepseek.com/"
experimental_bearer_token = "sbx-cs-deepseek"
supports_standalone_web_search = true'

higress_provider='[model_providers.custom]
name = "Higress"
base_url = "http://host.docker.internal:8080/v1/"
supports_standalone_web_search = true'

openlux_provider='[model_providers.custom]
name = "OpenLux"
base_url = "https://api.openlux.ai/v1/"
experimental_bearer_token = "sbx-cs-openlux"
supports_standalone_web_search = true'

# Replace the provider placeholder in the installed config with the whole
# [model_providers.custom] section of the selected backend.
set_custom_provider() {
    local section
    if [ "$selected_profile" = higress ]; then
        section="$higress_provider"
    elif [ "$selected_profile" = openlux ]; then
        section="$openlux_provider"
    else
        section="$deepseek_provider"
    fi
    CUSTOM_PROVIDER_SECTION="$section" awk '
        /^# __CUSTOM_PROVIDER__$/ { print ENVIRON["CUSTOM_PROVIDER_SECTION"]; next }
        { print }
    ' "$codex_dir/config.toml" > "$codex_dir/.config.toml.staged"
    mv -f "$codex_dir/.config.toml.staged" "$codex_dir/config.toml"
}
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
bin_install_dir="$HOME/.local/bin"
skills_source_dir="$script_dir/skills"
legacy_skills_install_dir="$HOME/.agents/skills"
skills_install_dir="$HOME/.codex/skills"
eli5_repo_url="https://github.com/DreambigOu/ELI5.git"
eli5_install_dir="$skills_install_dir/eli5"
retired_skills=(analyze write-code use-git)

# Keep the source outside Codex's discovery names so this repository does not load it twice.
for source_file in config.toml AGENTS.global.md install-codex.sh; do
    [ -f "$script_dir/$source_file" ] || die "required source file is missing: $script_dir/$source_file"
done
grep -q '^# __CUSTOM_PROVIDER__$' "$script_dir/config.toml" \
    || die 'config.toml is missing the # __CUSTOM_PROVIDER__ placeholder'
[ -d "$script_dir/models" ] || die "required model directory is missing: $script_dir/models"
[ -d "$skills_source_dir" ] || die "required skill directory is missing: $skills_source_dir"

shopt -s nullglob
skill_source_dirs=("$skills_source_dir"/*)
shopt -u nullglob

# The generated catalog, the staged catalog, and the ELI5 checkout are removed
# on every exit path, including the failures below that happen before staging.
staged_models=""
generated_catalog=""
eli5_tmp_dir=""
cleanup() {
    if [ -n "$staged_models" ] && [ -e "$staged_models" ]; then
        rm -f -- "$staged_models"
    fi
    if [ -n "$generated_catalog" ] && [ -e "$generated_catalog" ]; then
        rm -f -- "$generated_catalog"
    fi
    if [ -n "$eli5_tmp_dir" ] && [ -d "$eli5_tmp_dir" ]; then
        rm -rf -- "$eli5_tmp_dir"
    fi
}
trap cleanup EXIT

profile_name="${selected_profile:-deepseek}"
catalog_source="$script_dir/models/$profile_name.json"
if [ "$profile_name" = openlux ]; then
    # The OpenLux profile serves the official OpenAI models, so its catalog is
    # read from the installed CLI at install time instead of being kept as a
    # snapshot in this repository. `codex debug models` without --bundled would
    # refresh over the network; --bundled keeps the install hermetic.
    catalog_source="$(mktemp "${TMPDIR:-/tmp}/codex-config-catalog.XXXXXX")" \
        || die 'failed to create a temporary file for the model catalog.'
    generated_catalog="$catalog_source"
    codex debug models --bundled > "$catalog_source" \
        || die 'failed to read the bundled model catalog from the Codex CLI.'
else
    [ -f "$catalog_source" ] || die "required model catalog is missing: $catalog_source"
fi

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

mkdir -p "$codex_dir" "$git_ignore_dir" "$bin_install_dir" "$skills_install_dir"
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
set_custom_provider
install -m 0644 "$script_dir/AGENTS.global.md" "$codex_dir/AGENTS.md"
# Remove the profile files and catalogs installed by earlier versions of this repository.
for stale_artifact in \
    "$codex_dir/higress.config.toml" \
    "$codex_dir/gateway.config.toml" \
    "$codex_dir/models.gateway.json" \
    "$codex_dir/models.higress.json"; do
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
# Install the non-interactive CLI installer as `update-codex`, so it sits on
# PATH next to the standalone `codex` it refreshes.
install -m 0755 "$script_dir/install-codex.sh" "$bin_install_dir/update-codex"
printf 'Installed update-codex to %s\n' "$bin_install_dir/update-codex"
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

catalog_target="$codex_dir/models.json"
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

printf 'Installed Codex configuration to %s\n' "$codex_dir"
printf 'Installed %s models from profile %s to %s\n' \
    "$(jq '.models | length' "$catalog_target")" "$profile_name" "$catalog_target"
printf 'Installed ELI5 skill to %s\n' "$eli5_install_dir"
