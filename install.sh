#!/usr/bin/env bash
set -euo pipefail

die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

if [ "$#" -ne 0 ]; then
    if [ "$#" -eq 1 ] && [ "$1" = --help ]; then
        printf 'usage: %s\n' "${0##*/}"
        exit 0
    fi
    die 'no profiles are supported; usage: install.sh'
fi

command -v opencode >/dev/null || die 'opencode command not found'
command -v jq >/dev/null || die 'jq command not found'
command -v git >/dev/null || die 'git command not found'
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
: "${HOME:?HOME must be set}"
target="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

for source in templates/opencode.json AGENTS.global.md; do
    [ -f "$script_dir/$source" ] || die "missing $source"
done
jq -e 'type == "object" and (has("$schema") | not) and (has("mcp") | not)' \
    "$script_dir/templates/opencode.json" >/dev/null || die 'invalid opencode.json'

shopt -s nullglob
skills=("$script_dir"/skills/*)
shopt -u nullglob
[ "${#skills[@]}" -gt 0 ] || die 'no skills found'
for skill in "${skills[@]}"; do
    [ -f "$skill/SKILL.md" ] || die "missing SKILL.md in $skill"
done
for plugin_file in cap-context.ts inject-model-skills.ts; do
    [ -f "$script_dir/plugins/$plugin_file" ] || die "missing $plugin_file plugin"
done

mkdir -p "$target"
config="$target/opencode.json"
if [ -e "$config" ]; then
    [ -f "$config" ] || die "not a regular file: $config"
    source_config="$config"
    existing=true
else
    source_config=/dev/null
    existing=false
fi
# A temporary output is necessary to merge without truncating the input file.
merged="$(mktemp "$target/.opencode.json.XXXXXX")"
trap 'rm -f -- "$merged"' EXIT
jq -n --argjson existing "$existing" \
    --slurpfile current "$source_config" \
    --slurpfile update "$script_dir/templates/opencode.json" '
    def overlay($patch):
        reduce ($patch | keys_unsorted[]) as $key (.;
            .[$key] = (if (.[$key] | type) == "object" and ($patch[$key] | type) == "object"
                      then .[$key] | overlay($patch[$key])
                      else $patch[$key] end));
    if ($update | length) != 1 or ($existing and ($current | length) != 1)
       or ($existing and ($current[0] | type) != "object")
    then error("invalid OpenCode configuration")
    else
        ($current[0] // {})
        # Remove the previously managed task plugin while retaining unrelated entries.
        | (.plugins // [] | map(select(
            (if type == "string" then . else .package end)
            | test("^opencode-orchestrator(@|$)") | not
        ))) as $plugins
        | overlay($update[0])
        | .plugins = ($plugins + $update[0].plugins)
    end
' > "$merged" || die "could not merge $config"
chmod 0600 "$merged"
mv -f -- "$merged" "$config"
install -m 0644 "$script_dir/AGENTS.global.md" "$target/AGENTS.md"
mkdir -p "$target/skills"
for skill in "${skills[@]}"; do
    # 跳过由插件注入的 skill（避免重复加载）
    case "${skill##*/}" in
        calibrate-fable|constrain-opus|avoid-overengineering)
            continue
            ;;
    esac
    mkdir -p "$target/skills/${skill##*/}"
    cp -a "$skill/." "$target/skills/${skill##*/}/"
done
mkdir -p "$target/plugins"
install -m 0644 "$script_dir/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
install -m 0644 "$script_dir/plugins/inject-model-skills.ts" "$target/plugins/inject-model-skills.ts"
git config --global user.email '40174982+HeXis-YS@users.noreply.github.com'
git config --global user.name 'HeXis-YS'
git_ignore_dir="${XDG_CONFIG_HOME:-$HOME/.config}/git"
mkdir -p "$git_ignore_dir"
printf '%s\n' '.opencode' > "$git_ignore_dir/ignore"
printf 'Installed OpenCode configuration, rules, and skills to %s\n' "$target"
