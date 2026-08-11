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

if ! command_exists jq; then
    install_jq
fi

: "${HOME:?HOME must be set before running this script.}"

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
codex_dir="$HOME/.codex"
git_ignore_dir="$HOME/.config/git"
skills_source_dir="$script_dir/skills"
skills_install_dir="$HOME/.agents/skills"

# Keep the source outside Codex's discovery names so this repository does not load it twice.
for source_file in config.toml AGENTS.global.md; do
    [ -f "$script_dir/$source_file" ] || die "required source file is missing: $script_dir/$source_file"
done
[ -d "$script_dir/models" ] || die "required model directory is missing: $script_dir/models"
[ -d "$skills_source_dir" ] || die "required skill directory is missing: $skills_source_dir"

shopt -s nullglob
model_files=("$script_dir"/models/*.json)
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

tmp_dir=""
staged_models=""
cleanup() {
    if [ -n "$staged_models" ] && [ -e "$staged_models" ]; then
        rm -f -- "$staged_models"
    fi
    if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
        rm -rf -- "$tmp_dir"
    fi
}
trap cleanup EXIT

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-config.XXXXXX")" || die 'failed to create a temporary directory.'
official_models="$tmp_dir/models.json"
merged_models="$tmp_dir/merged-models.json"

mkdir -p "$codex_dir" "$git_ignore_dir" "$skills_install_dir"
install -m 0644 "$script_dir/config.toml" "$codex_dir/config.toml"
install -m 0644 "$script_dir/AGENTS.global.md" "$codex_dir/AGENTS.md"
for skill_source_dir in "${skill_source_dirs[@]}"; do
    skill_name="${skill_source_dir##*/}"
    skill_install_dir="$skills_install_dir/$skill_name"
    mkdir -p "$skill_install_dir"
    cp -a "$skill_source_dir/." "$skill_install_dir/"
done
printf '%s\n' '.codex' > "$git_ignore_dir/ignore"

if ! codex debug models --bundled > "$official_models"; then
    die 'failed to fetch the bundled Codex model list.'
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

jq -e "$catalog_filter" "$official_models" >/dev/null \
    || die 'the bundled model list is not a valid model catalog.'

for model_file in "${model_files[@]}"; do
    jq -e "$catalog_filter" "$model_file" >/dev/null \
        || die "invalid model catalog fragment: $model_file"
done

merge_filter='
    def merge_models($base; $extras):
        reduce $extras[] as $model
            ($base;
                if any(.[]; .slug == $model.slug) then
                    map(if .slug == $model.slug then $model else . end)
                else
                    . + [$model]
                end
            );

    .[0] as $official
    | [.[1:][] | .models[]] as $extras
    | $official
    | .models = merge_models(.models; $extras)
'

jq -s "$merge_filter" "$official_models" "${model_files[@]}" > "$merged_models" \
    || die 'failed to merge the bundled and local model catalogs.'
jq -e "$catalog_filter" "$merged_models" >/dev/null \
    || die 'the merged model catalog is invalid.'

# Stage the catalog beside its destination so an interrupted copy cannot leave a partial file.
staged_models="$(mktemp "$codex_dir/.models.json.XXXXXX")" \
    || die "failed to create a staging file in $codex_dir"
install -m 0644 "$merged_models" "$staged_models" \
    || die "failed to stage the model catalog in $codex_dir"
mv -f "$staged_models" "$codex_dir/models.json" \
    || die "failed to install the model catalog in $codex_dir"
staged_models=""

model_count="$(jq '.models | length' "$codex_dir/models.json")"
printf 'Installed Codex configuration, %s skills, and %s models\n' \
    "${#skill_source_dirs[@]}" "$model_count"
