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
                profile_name="${2:-deepseek}"
                shift 2
                ;;
            --profile=*)
                profile_name="${1#--profile=}"
                profile_name="${profile_name:-deepseek}"
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

select_profile() {
    catalog_source="$script_dir/models/$profile_name.json"
    # Local gateways need nonempty placeholder tokens for the CLI to start.
    case "$profile_name" in
        highgo)
            provider_name='HighGo'
            provider_base_url='http://host.docker.internal:8080/v1/'
            provider_token='sbx-cs-highgo'
            ;;
        openlux)
            catalog_source=bundled
            provider_name='OpenLux'
            provider_base_url='https://api.openlux.ai/v1/'
            provider_token='sbx-cs-openlux'
            ;;
        cc-switch)
            provider_name='CC Switch'
            provider_base_url='http://host.docker.internal:15721/v1/'
            provider_token='sbx-cs-cc-switch'
            ;;
        deepseek)
            provider_name='DeepSeek'
            provider_base_url='https://api.deepseek.com/'
            provider_token='sbx-cs-deepseek'
            ;;
        *) die "unknown profile: $profile_name (expected deepseek, highgo, openlux, or cc-switch)" ;;
    esac
}

render_config() {
    sed -e "s|__PROVIDER_NAME__|$provider_name|" \
        -e "s|__PROVIDER_BASE_URL__|$provider_base_url|" \
        -e "s|__PROVIDER_TOKEN__|$provider_token|" \
        "$script_dir/config.toml" > "$staging_dir/config.toml" \
        || die 'failed to render config.toml.'
    if grep -q '__PROVIDER_' "$staging_dir/config.toml"; then
        die 'the prepared config.toml still contains a provider placeholder'
    fi
    chmod 0644 "$staging_dir/config.toml"
}

check_sources() {
    local source_file provider_placeholder skill_source_dir
    # Only the distributable global rules are installed; AGENTS.md is project-local.
    for source_file in config.toml AGENTS.global.md; do
        [ -f "$script_dir/$source_file" ] || die "required source file is missing: $script_dir/$source_file"
    done
    for provider_placeholder in __PROVIDER_NAME__ __PROVIDER_BASE_URL__ __PROVIDER_TOKEN__; do
        grep -q "\"$provider_placeholder\"" "$script_dir/config.toml" \
            || die "config.toml is missing the $provider_placeholder template field"
    done
    [ -d "$script_dir/models" ] || die "required model directory is missing: $script_dir/models"
    if [ "$catalog_source" != bundled ]; then
        [ -f "$catalog_source" ] || die "required model catalog is missing: $catalog_source"
    fi
    [ -d "$skills_source_dir" ] || die "required skill directory is missing: $skills_source_dir"
    shopt -s nullglob
    skill_source_dirs=("$skills_source_dir"/*)
    shopt -u nullglob
    [ "${#skill_source_dirs[@]}" -gt 0 ] || die "no skills were found in $skills_source_dir"
    for skill_source_dir in "${skill_source_dirs[@]}"; do
        [ -d "$skill_source_dir" ] || die "skill source is not a directory: $skill_source_dir"
        [ -f "$skill_source_dir/SKILL.md" ] \
            || die "required skill file is missing: $skill_source_dir/SKILL.md"
        [ -f "$skill_source_dir/agents/openai.yaml" ] \
            || die "required skill metadata is missing: $skill_source_dir/agents/openai.yaml"
    done
}

ensure_dependencies() {
    # Check codex before attempting any package-manager operation.
    command_exists codex || die 'codex command was not found; install Codex CLI and retry.'
    command_exists git || die 'git command was not found; install Git and retry.'
    if ! command_exists jq; then
        install_jq
    fi
}

cleanup() {
    if [ -n "$staging_dir" ]; then
        rm -rf -- "$staging_dir"
    fi
}

prepare_artifacts() {
    local skill_source_dir
    mkdir -p "$codex_dir"
    # Prepare all inputs before touching installed files. This directory shares
    # their filesystem so config and catalog replacement can use atomic rename.
    staging_dir="$(mktemp -d "$codex_dir/.install.XXXXXX")" \
        || die "failed to create a staging directory in $codex_dir"
    render_config
    if [ "$catalog_source" = bundled ]; then
        # Read the current CLI's bundled catalog on every install, without a
        # repository snapshot or the network refresh of the non-bundled command.
        codex debug models --bundled > "$staging_dir/models.json" \
            || die 'failed to read the bundled model catalog from the Codex CLI.'
    else
        install -m 0644 "$catalog_source" "$staging_dir/models.json" \
            || die "failed to stage the model catalog: $catalog_source"
    fi
    jq -e '
        type == "object"
        and ((.models | type) == "array")
        and all(.models[];
            type == "object"
            and ((.slug | type) == "string")
            and ((.slug | length) > 0)
        )
    ' "$staging_dir/models.json" >/dev/null \
        || die "invalid model catalog fragment: $catalog_source"
    chmod 0644 "$staging_dir/models.json"
    model_count="$(jq '.models | length' "$staging_dir/models.json")"
    install -m 0644 "$script_dir/AGENTS.global.md" "$staging_dir/AGENTS.md"
    if [ -f "$script_dir/proxy-setup.cjs" ]; then
        install -m 0644 "$script_dir/proxy-setup.cjs" "$staging_dir/proxy-setup.cjs"
    fi
    mkdir "$staging_dir/skills"
    for skill_source_dir in "${skill_source_dirs[@]}"; do
        mkdir "$staging_dir/skills/${skill_source_dir##*/}"
        cp -a "$skill_source_dir/." "$staging_dir/skills/${skill_source_dir##*/}/" \
            || die "failed to stage skill: $skill_source_dir"
    done
}

install_artifacts() {
    local artifact
    for artifact in config.toml models.json AGENTS.md; do
        mv -f "$staging_dir/$artifact" "$codex_dir/$artifact" \
            || die "failed to install $artifact in $codex_dir"
    done
    if [ -f "$staging_dir/proxy-setup.cjs" ]; then
        mv -f "$staging_dir/proxy-setup.cjs" "$codex_dir/proxy-setup.cjs"
    fi
}

install_skills() {
    local skill_source_dir skill_name skill_install_dir legacy_skill_dir
    mkdir -p "$skills_install_dir"
    for skill_source_dir in "${skill_source_dirs[@]}"; do
        skill_name="${skill_source_dir##*/}"
        skill_install_dir="$skills_install_dir/$skill_name"
        legacy_skill_dir="$legacy_skills_install_dir/$skill_name"
        # Preserve files in a migrated skill when no current installation exists.
        if [ -e "$legacy_skill_dir" ] || [ -L "$legacy_skill_dir" ]; then
            if [ -e "$skill_install_dir" ] || [ -L "$skill_install_dir" ]; then
                rm -rf -- "$legacy_skill_dir"
            else
                mv -- "$legacy_skill_dir" "$skill_install_dir"
            fi
        fi
        mkdir -p "$skill_install_dir"
        cp -a "$staging_dir/skills/$skill_name/." "$skill_install_dir/"
    done
}

configure_git() {
    git config --global user.email "40174982+HeXis-YS@users.noreply.github.com"
    git config --global user.name "HeXis-YS"
    mkdir -p "$git_ignore_dir"
    printf '%s\n' '.codex' > "$git_ignore_dir/ignore"
}

remove_legacy_artifacts() {
    local stale_artifact skills_dir retired_skill retired_skill_dir
    # Remove only paths previously managed by this repository.
    for stale_artifact in \
        "$HOME/.local/bin/update-codex" \
        "$codex_dir/higress.config.toml" \
        "$codex_dir/gateway.config.toml" \
        "$codex_dir/models.gateway.json" \
        "$codex_dir/models.higress.json"; do
        if [ -e "$stale_artifact" ] || [ -L "$stale_artifact" ]; then
            rm -f -- "$stale_artifact"
        fi
    done
    for skills_dir in "$legacy_skills_install_dir" "$skills_install_dir"; do
        for retired_skill in "${retired_skills[@]}"; do
            retired_skill_dir="$skills_dir/$retired_skill"
            if [ -e "$retired_skill_dir" ] || [ -L "$retired_skill_dir" ]; then
                rm -rf -- "$retired_skill_dir"
            fi
        done
    done
    rmdir "$legacy_skills_install_dir" 2>/dev/null || true
}

restart_daemon() {
    # Installation is complete; failure to reload the separate daemon only warns.
    printf 'Restarting the app-server daemon\n'
    if ! codex app-server daemon restart; then
        printf 'install.sh: warning: could not restart the app-server daemon; the installed configuration is unaffected\n' >&2
    fi
}

main() {
    profile_name=deepseek
    parse_args "$@"
    script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
    select_profile
    : "${HOME:?HOME must be set before running this script.}"
    codex_dir="$HOME/.codex"
    git_ignore_dir="$HOME/.config/git"
    skills_source_dir="$script_dir/skills"
    legacy_skills_install_dir="$HOME/.agents/skills"
    skills_install_dir="$codex_dir/skills"
    retired_skills=(analyze write-code use-git write-lessons write-report deliver-thoroughly)
    staging_dir=""
    trap cleanup EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    check_sources
    ensure_dependencies
    prepare_artifacts
    install_artifacts
    install_skills
    configure_git
    remove_legacy_artifacts

    printf 'Installed Codex configuration to %s\n' "$codex_dir"
    printf 'Installed %s models from profile %s to %s\n' \
        "$model_count" "$profile_name" "$codex_dir/models.json"
    printf 'Installed skills to %s\n' "$skills_install_dir"
    restart_daemon
}

main "$@"
