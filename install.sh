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
    printf '  Profiles: deepseek (default), highgo, openlux, cc-switch.\n' >&2
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
    ""|deepseek|highgo|openlux|cc-switch) ;;
    *) die "unknown profile: $selected_profile (expected deepseek, highgo, openlux, or cc-switch)" ;;
esac

# Generate the installed config from the repository template, filling the three
# provider fields of the selected backend; the result is staged beside its
# destination so an interrupted install cannot leave a partial file. The local
# highgo and cc-switch gateways use placeholder tokens because Codex refuses to
# start when the declared token is empty.
set_custom_provider() {
    local provider_name provider_base_url provider_token
    if [ "$selected_profile" = highgo ]; then
        provider_name='HighGo'
        provider_base_url='http://host.docker.internal:8080/v1/'
        provider_token='sbx-cs-highgo'
    elif [ "$selected_profile" = openlux ]; then
        provider_name='OpenLux'
        provider_base_url='https://api.openlux.ai/v1/'
        provider_token='sbx-cs-openlux'
    elif [ "$selected_profile" = cc-switch ]; then
        provider_name='CC Switch'
        provider_base_url='http://host.docker.internal:15721/v1/'
        provider_token='sbx-cs-cc-switch'
    else
        provider_name='DeepSeek'
        provider_base_url='https://api.deepseek.com/'
        provider_token='sbx-cs-deepseek'
    fi
    sed -e "s|__PROVIDER_NAME__|$provider_name|" \
        -e "s|__PROVIDER_BASE_URL__|$provider_base_url|" \
        -e "s|__PROVIDER_TOKEN__|$provider_token|" \
        "$script_dir/config.toml" > "$codex_dir/.config.toml.staged"
    if grep -q '__PROVIDER_' "$codex_dir/.config.toml.staged"; then
        rm -f -- "$codex_dir/.config.toml.staged"
        die 'the installed config.toml still contains a provider placeholder'
    fi
    mv -f "$codex_dir/.config.toml.staged" "$codex_dir/config.toml"
    # Install proxy-setup.cjs for MCP servers that need proxy support
    if [ -f "$script_dir/proxy-setup.cjs" ]; then
        install -m 0644 "$script_dir/proxy-setup.cjs" "$codex_dir/proxy-setup.cjs" \
            || die "failed to install proxy-setup.cjs in $codex_dir"
    fi
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
retired_skills=(analyze write-code use-git write-lessons write-report)

# Keep the source outside Codex's discovery names so this repository does not load it twice.
for source_file in config.toml AGENTS.global.md; do
    [ -f "$script_dir/$source_file" ] || die "required source file is missing: $script_dir/$source_file"
done
for provider_placeholder in __PROVIDER_NAME__ __PROVIDER_BASE_URL__ __PROVIDER_TOKEN__; do
    grep -q "\"$provider_placeholder\"" "$script_dir/config.toml" \
        || die "config.toml is missing the $provider_placeholder template field"
done
[ -d "$script_dir/models" ] || die "required model directory is missing: $script_dir/models"
[ -d "$skills_source_dir" ] || die "required skill directory is missing: $skills_source_dir"

shopt -s nullglob
skill_source_dirs=("$skills_source_dir"/*)
shopt -u nullglob

# The generated and staged catalogs are removed on every exit path, including
# failures below that happen before the catalog is installed.
staged_models=""
generated_catalog=""
cleanup() {
    if [ -n "$staged_models" ] && [ -e "$staged_models" ]; then
        rm -f -- "$staged_models"
    fi
    if [ -n "$generated_catalog" ] && [ -e "$generated_catalog" ]; then
        rm -f -- "$generated_catalog"
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

managed_skill_names=()
for skill_source_dir in "${skill_source_dirs[@]}"; do
    managed_skill_names+=("${skill_source_dir##*/}")
done

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

set_custom_provider
install -m 0644 "$script_dir/AGENTS.global.md" "$codex_dir/AGENTS.md"
# Remove the profile files and catalogs installed by earlier versions of this
# repository, plus the retired update-codex CLI wrapper.
for stale_artifact in \
    "$bin_install_dir/update-codex" \
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
printf '%s\n' '.codex' > "$git_ignore_dir/ignore"

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
printf 'Installed skills to %s\n' "$skills_install_dir"

# The daemon is a separate process that reads the configuration when it starts,
# so restart it once the install above is complete to make it load the installed
# config.toml and models.json. Nothing downstream depends on the daemon, so a
# daemon that cannot restart only warns.
printf 'Restarting the app-server daemon\n'
if ! codex app-server daemon restart; then
    printf 'install.sh: warning: could not restart the app-server daemon; the installed configuration is unaffected\n' >&2
fi
