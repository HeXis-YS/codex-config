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
    command -v opencode >/dev/null || die 'opencode command not found'
    command -v jq >/dev/null || die 'jq command not found'
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
    jq -e 'type == "object" and (has("$schema") | not) and (has("mcp") | not)' \
        "$script_dir/templates/opencode.json" >/dev/null || die 'invalid opencode.json'
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
    # The merged skill replaces these two previously installed entrypoints.
    for obsolete in record-incident score-incident; do
        dir="$skills_target/$obsolete"
        rm -f -- "$dir/SKILL.md"
        if [ -d "$dir" ]; then
            rmdir --ignore-fail-on-non-empty -- "$dir"
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
if "$manage_skills"; then
    install_skills
else
    printf 'Shared skills at %s are mounted read-only; left unchanged.\n' "$skills_target"
fi
mkdir -p "$target/plugins"
install -m 0644 "$script_dir/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
rm -f -- "$target/plugins/inject-model-skills.ts"
git config --global user.email '40174982+HeXis-YS@users.noreply.github.com'
git config --global user.name 'HeXis-YS'
git_ignore_dir="${XDG_CONFIG_HOME:-$HOME/.config}/git"
mkdir -p "$git_ignore_dir"
printf '%s\n' '.opencode' > "$git_ignore_dir/ignore"
printf 'Installed OpenCode configuration, rules, and plugins to %s\n' "$target"
