#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
for tool in bwrap sudo setpriv opencode; do
    command -v "$tool" >/dev/null || { printf 'missing test dependency: %s\n' "$tool" >&2; exit 1; }
done
uid="$(id -u)"
gid="$(id -g)"
[ "$uid" -ne 0 ] || { printf 'run as an unprivileged user with sudo access\n' >&2; exit 1; }
sudo -n true
tmp="$(mktemp -d /tmp/opencode/verify-install.XXXXXX)"
trap 'rm -rf -- "$tmp"' EXIT
printf '0::/\n' > "$tmp/host-cgroup"
printf '0::/docker/verify-install\n' > "$tmp/container-cgroup"
host_bin="$tmp/host-bin"
mkdir -p "$host_bin"
# The host branch must work without OpenCode, jq, Git, or findmnt on PATH.
for tool in bash dirname grep mkdir cp rm rmdir; do
    ln -s "$(command -v "$tool")" "$host_bin/$tool"
done

# A minimal filesystem hides real container markers without altering the host.
sandbox=(bwrap --die-with-parent --unshare-pid --proc /proc --dev /dev)
for dir in /usr /bin /lib /lib64 /etc /home /tmp; do
    [ ! -e "$dir" ] || sandbox+=(--ro-bind "$dir" "$dir")
done
sandbox+=(--ro-bind "$root" "$root" --bind "$tmp" "$tmp")
opencode="$(command -v opencode)"
sandbox+=(--ro-bind "$opencode" "$opencode")

run_install() {
    local home="$1" config_home="$2" kind="$3"
    shift 3
    local cgroup="$tmp/host-cgroup" sandbox_id=''
    local options=()
    case "$kind" in
        host) options+=(--setenv PATH "$host_bin") ;;
        legacy) cgroup="$tmp/container-cgroup" ;;
        shared)
            sandbox_id=verify-install
            options+=(--ro-bind "$tmp/shared-skills" "$config_home/opencode/skills")
            ;;
        *) printf 'unknown fixture: %s\n' "$kind" >&2; return 1 ;;
    esac
    sudo -n "${sandbox[@]}" --ro-bind "$cgroup" /proc/1/cgroup \
        --setenv HOME "$home" --setenv XDG_CONFIG_HOME "$config_home" \
        --setenv SANDBOX_ID "$sandbox_id" --setenv LC_ALL C --setenv PATH "$PATH" "${options[@]}" \
        -- /usr/bin/setpriv --reuid "$uid" --regid "$gid" --clear-groups \
        /bin/bash "$root/install.sh" "$@"
}

home="$tmp/home"
mkdir -p "$home/.codex" "$home/.config/opencode/skills/personal"
printf 'keep\n' > "$home/.codex/config.toml"
printf 'keep\n' > "$home/.config/opencode/skills/personal/SKILL.md"
for obsolete in record-incident score-incident; do
    mkdir -p "$home/.config/opencode/skills/$obsolete"
    printf 'old entrypoint\n' > "$home/.config/opencode/skills/$obsolete/SKILL.md"
done
printf 'keep\n' > "$home/.config/opencode/skills/record-incident/personal-note.md"
cat > "$home/.config/opencode/opencode.json" <<'JSON'
{"$schema":"https://opencode.ai/config.json","mcp":{"servers":{"personal":{"type":"remote","url":"https://example.com/mcp"}}},"providers":{"openai":{"settings":{"baseURL":"https://old.example","timeout":1234}}},"plugins":["personal-plugin","opencode-orchestrator@2.0.20","opencode-orchestrator",{"package":"@personal/extra@1.2.0","options":{"keep":true}}],"unrelated":true}
JSON

run_install "$home" "$home/.config" legacy
target="$home/.config/opencode"
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
for skill in "$root"/skills/*; do
    diff -r "$skill" "$target/skills/${skill##*/}"
done
[ ! -e "$target/skills/record-incident/SKILL.md" ]
[ ! -e "$target/skills/score-incident" ]
grep -qx keep "$target/skills/record-incident/personal-note.md"
cmp "$root/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
jq -e --slurpfile template "$root/templates/opencode.json" '
    .["$schema"] == "https://opencode.ai/config.json"
    and .mcp.servers.personal.url == "https://example.com/mcp"
    and .unrelated == true
    and .providers.openai.settings.timeout == 1234
    and (.providers | keys == ["anthropic", "deepseek", "google", "openai"])
    and (.providers.openai.settings.apiKey | type == "string" and length > 0 and (startswith("{env:") | not))
    and .providers.anthropic.settings.apiKey == .providers.openai.settings.apiKey
    and .providers.google.settings.baseURL == "https://api.openlux.ai/v1beta"
    and .providers.google.settings.apiKey == .providers.openai.settings.apiKey
    and (.providers.deepseek.settings.apiKey | type == "string" and length > 0 and (startswith("{env:") | not))
    and .compaction.buffer == "5%"
    and .agents.title.model == "openai/gpt-6-luna"
    and .agents.compaction.model == "openai/gpt-6-luna"
    and .agents.summary.model == "openai/gpt-6-luna"
    and .plugins == (["personal-plugin", {"package":"@personal/extra@1.2.0","options":{"keep":true}}] + $template[0].plugins)
' "$target/opencode.json" >/dev/null
[ "$(stat -c %a "$target/opencode.json")" = 600 ]
grep -qx keep "$home/.codex/config.toml"
grep -qx keep "$target/skills/personal/SKILL.md"
[ "$(HOME="$home" XDG_CONFIG_HOME="$home/.config" git config --global user.name)" = 'HeXis-YS' ]
[ "$(HOME="$home" XDG_CONFIG_HOME="$home/.config" git config --global user.email)" = '40174982+HeXis-YS@users.noreply.github.com' ]
grep -Fqx '.opencode' "$home/.config/git/ignore"
before="$tmp/installed-config.json"
cp "$target/opencode.json" "$before"
run_install "$home" "$home/.config" legacy
cmp "$before" "$target/opencode.json"

# First installation must also work without an existing configuration or skills directory.
mkdir -p "$tmp/fresh-config"
run_install "$home" "$tmp/fresh-config" legacy
jq -e --slurpfile template "$root/templates/opencode.json" '. == $template[0]' \
    "$tmp/fresh-config/opencode/opencode.json" >/dev/null
cmp "$root/AGENTS.global.md" "$tmp/fresh-config/opencode/AGENTS.md"
grep -Fqx '.opencode' "$tmp/fresh-config/git/ignore"
if run_install "$home" "$home/.config" legacy --profile highgo > /dev/null 2>&1; then
    printf 'legacy --profile option unexpectedly accepted\n' >&2
    exit 1
fi
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
printf 'Legacy container installation checks passed.\n'

host_home="$tmp/host-home"
host_target="$host_home/.local/state/sandboxes/sandboxes/agent-skills"
mkdir -p "$host_target/personal" "$host_target/record-incident" "$host_target/score-incident"
printf 'keep\n' > "$host_target/personal/SKILL.md"
printf 'old entrypoint\n' > "$host_target/record-incident/SKILL.md"
printf 'old entrypoint\n' > "$host_target/score-incident/SKILL.md"
printf 'keep\n' > "$host_target/record-incident/personal-note.md"
for attempt in 1 2; do
    run_install "$host_home" "$host_home/.config" host
    for skill in "$root"/skills/*; do
        diff -r "$skill" "$host_target/${skill##*/}"
    done
done
grep -qx keep "$host_target/personal/SKILL.md"
grep -qx keep "$host_target/record-incident/personal-note.md"
[ ! -e "$host_target/record-incident/SKILL.md" ]
[ ! -e "$host_target/score-incident" ]
[ ! -e "$host_home/.config" ]
[ ! -e "$host_home/.gitconfig" ]
printf 'Host skills-only installation checks passed without container dependencies.\n'

cp -a "$host_target" "$tmp/shared-skills"
cp -a "$tmp/shared-skills" "$tmp/shared-before"
for container in first second; do
    container_home="$tmp/$container-container"
    container_target="$container_home/.config/opencode"
    mkdir -p "$container_target/skills"
    jq -n --arg plugin "$container-plugin" \
        '{plugins: [$plugin], providers: {openai: {settings: {timeout: 5678}}}}' \
        > "$container_target/opencode.json"
    run_install "$container_home" "$container_home/.config" shared > "$tmp/$container-output.log"
    cat "$tmp/$container-output.log"
    grep -Fq 'mounted read-only; left unchanged.' "$tmp/$container-output.log"
    jq -e --arg plugin "$container-plugin" \
        '.plugins == [$plugin] and .providers.openai.settings.timeout == 5678
         and .providers.google.settings.baseURL == "https://api.openlux.ai/v1beta"' \
        "$container_target/opencode.json" >/dev/null
    cmp "$root/AGENTS.global.md" "$container_target/AGENTS.md"
    cmp "$root/plugins/cap-context.ts" "$container_target/plugins/cap-context.ts"
    # No local skills may be installed underneath the temporary read-only mount.
    [ -z "$(ls -A "$container_target/skills")" ]
done
diff -r "$tmp/shared-before" "$tmp/shared-skills"
printf 'Read-only shared skills and independent container configurations: PASS\n'

denied_home="$tmp/denied-home"
mkdir -p "$denied_home/.config/opencode/skills"
chmod 0555 "$denied_home/.config/opencode/skills"
if run_install "$denied_home" "$denied_home/.config" legacy > "$tmp/denied-output.log" 2>&1; then
    printf 'unwritable local skills directory unexpectedly accepted\n' >&2
    exit 1
fi
chmod 0755 "$denied_home/.config/opencode/skills"
cat "$tmp/denied-output.log"
grep -Fq 'Permission denied' "$tmp/denied-output.log"
if grep -Fq 'mounted read-only; left unchanged.' "$tmp/denied-output.log"; then
    printf 'permission error incorrectly treated as a shared mount\n' >&2
    exit 1
fi
printf 'Local permission failure is not treated as a shared mount: PASS\n'
printf 'OpenCode environment-aware installation checks passed.\n'
