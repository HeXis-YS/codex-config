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
for dir in /usr /bin /lib /lib64 /etc /home /tmp /opt; do
    [ ! -e "$dir" ] || sandbox+=(--ro-bind "$dir" "$dir")
done
sandbox+=(--ro-bind "$root" "$root" --bind "$tmp" "$tmp")
opencode="$(readlink -f -- "$(command -v opencode)")"
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
for obsolete in record-incident score-incident avoid-overengineering calibrate-fable constrain-opus; do
    mkdir -p "$home/.config/opencode/skills/$obsolete"
    printf 'old entrypoint\n' > "$home/.config/opencode/skills/$obsolete/SKILL.md"
done
mkdir -p "$home/.config/opencode/skills/avoid-overengineering/references"
printf 'old reference\n' > "$home/.config/opencode/skills/avoid-overengineering/references/verification.md"
printf 'keep\n' > "$home/.config/opencode/skills/record-incident/personal-note.md"
mkdir -p "$home/.config/opencode/model-skills/avoid-overengineering" \
    "$home/.config/opencode/models-md/references"
printf 'old copy\n' > "$home/.config/opencode/model-skills/avoid-overengineering/SKILL.md"
printf 'old reference\n' > "$home/.config/opencode/models-md/references/verification.md"
printf 'old name\n' > "$home/.config/opencode/models-md/gpt.md"
mkdir -p "$home/.config/opencode/plugins/commander" "$home/.config/opencode/plugins/orchestrator" "$home/.config/opencode/plugins/deepseek-fallback"
printf 'obsolete\n' > "$home/.config/opencode/plugins/commander/obsolete.ts"
printf 'obsolete\n' > "$home/.config/opencode/plugins/orchestrator/obsolete.ts"
printf 'obsolete\n' > "$home/.config/opencode/plugins/deepseek-fallback/obsolete.ts"
printf '{"personal":true}\n' > "$home/.config/opencode/opencode.json"
custom_ignore="$tmp/custom-ignore"
HOME="$home" XDG_CONFIG_HOME="$home/.config" git config --global core.excludesFile "$custom_ignore"
printf 'keep-global' > "$home/.gitignore_global"
printf 'keep-template\n' > "$home/.gitignore_template"

run_install "$home" "$home/.config" legacy
target="$home/.config/opencode"
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
for skill in "$root"/skills/*; do
    diff -r "$skill" "$target/skills/${skill##*/}"
done
[ ! -e "$target/skills/record-incident/SKILL.md" ]
[ ! -e "$target/skills/score-incident" ]
grep -qx keep "$target/skills/record-incident/personal-note.md"
# Model instructions moved out of the skills directory and mirror models-md.
for skill in avoid-overengineering calibrate-fable constrain-opus; do
    [ ! -e "$target/skills/$skill" ]
done
for model in gpt-6 claude-fable-5-2 claude-opus-5-5; do
    cmp "$root/models-md/$model.md" "$target/models-md/$model.md"
done
# Earlier layouts are removed, and the merged reference stays available.
[ ! -e "$target/model-skills" ]
[ ! -e "$target/models-md/references" ]
[ ! -e "$target/models-md/gpt.md" ]
grep -q '^#### 新增测试的依据$' "$target/models-md/gpt-6.md"
cmp "$root/plugins/adopt-catalog.ts" "$target/plugins/adopt-catalog.ts"
cmp "$root/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
[ ! -e "$target/plugins/commander" ]
diff -r "$root/plugins/orchestrator" "$target/plugins/orchestrator"
diff -r "$root/plugins/deepseek-fallback" "$target/plugins/deepseek-fallback"
cmp "$root/templates/opencode.json" "$target/opencode.json"
[ "$(stat -c %a "$target/opencode.json")" = 600 ]
grep -qx keep "$home/.codex/config.toml"
grep -qx keep "$target/skills/personal/SKILL.md"
[ "$(HOME="$home" XDG_CONFIG_HOME="$home/.config" git config --global user.name)" = 'HeXis-YS' ]
[ "$(HOME="$home" XDG_CONFIG_HOME="$home/.config" git config --global user.email)" = '40174982+HeXis-YS@users.noreply.github.com' ]
[ ! -e "$custom_ignore" ]
[ ! -e "$home/.config/git/ignore" ]
grep -Fqx 'keep-global' "$home/.gitignore_global"
grep -Fqx 'keep-template' "$home/.gitignore_template"
for ignore_file in "$home/.gitignore_global" "$home/.gitignore_template"; do
    grep -Fqx '.opencode' "$ignore_file"
    grep -Fqx '.codex' "$ignore_file"
done
before="$tmp/installed-config.json"
cp "$target/opencode.json" "$before"
run_install "$home" "$home/.config" legacy
cmp "$before" "$target/opencode.json"
for ignore_file in "$home/.gitignore_global" "$home/.gitignore_template"; do
    [ "$(grep -Fxc '.opencode' "$ignore_file")" -eq 1 ]
    [ "$(grep -Fxc '.codex' "$ignore_file")" -eq 1 ]
done

# First installation must also work without an existing configuration or skills directory.
fresh_home="$tmp/fresh-home"
mkdir -p "$tmp/fresh-config" "$fresh_home"
run_install "$fresh_home" "$tmp/fresh-config" legacy
cmp "$root/templates/opencode.json" "$tmp/fresh-config/opencode/opencode.json"
cmp "$root/AGENTS.global.md" "$tmp/fresh-config/opencode/AGENTS.md"
cmp "$root/plugins/adopt-catalog.ts" "$tmp/fresh-config/opencode/plugins/adopt-catalog.ts"
diff -r "$root/plugins/orchestrator" "$tmp/fresh-config/opencode/plugins/orchestrator"
diff -r "$root/plugins/deepseek-fallback" "$tmp/fresh-config/opencode/plugins/deepseek-fallback"
for ignore_file in "$fresh_home/.gitignore_global" "$fresh_home/.gitignore_template"; do
    grep -Fqx '.opencode' "$ignore_file"
    grep -Fqx '.codex' "$ignore_file"
done
if run_install "$home" "$home/.config" legacy --profile highgo > /dev/null 2>&1; then
    printf 'legacy --profile option unexpectedly accepted\n' >&2
    exit 1
fi
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
printf 'Legacy container installation checks passed.\n'

host_home="$tmp/host-home"
host_target="$host_home/.local/state/sandboxes/sandboxes/agent-skills"
mkdir -p "$host_target/personal" "$host_target/record-incident" "$host_target/score-incident" \
    "$host_target/avoid-overengineering/references"
printf 'keep\n' > "$host_target/personal/SKILL.md"
printf 'old entrypoint\n' > "$host_target/record-incident/SKILL.md"
printf 'old entrypoint\n' > "$host_target/score-incident/SKILL.md"
printf 'keep\n' > "$host_target/record-incident/personal-note.md"
printf 'old entrypoint\n' > "$host_target/avoid-overengineering/SKILL.md"
printf 'old reference\n' > "$host_target/avoid-overengineering/references/verification.md"
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
[ ! -e "$host_target/avoid-overengineering" ]
[ ! -e "$host_target/calibrate-fable" ]
[ ! -e "$host_target/constrain-opus" ]
[ ! -e "$host_home/.config" ]
[ ! -e "$host_home/.gitconfig" ]
printf 'Host skills-only installation checks passed without container dependencies.\n'

cp -a "$host_target" "$tmp/shared-skills"
cp -a "$tmp/shared-skills" "$tmp/shared-before"
for container in first second; do
    container_home="$tmp/$container-container"
    container_target="$container_home/.config/opencode"
    mkdir -p "$container_target/skills"
    printf '{"personal":true}\n' > "$container_target/opencode.json"
    run_install "$container_home" "$container_home/.config" shared > "$tmp/$container-output.log"
    cat "$tmp/$container-output.log"
    grep -Fq 'mounted read-only; left unchanged.' "$tmp/$container-output.log"
    cmp "$root/templates/opencode.json" "$container_target/opencode.json"
    cmp "$root/AGENTS.global.md" "$container_target/AGENTS.md"
    cmp "$root/plugins/adopt-catalog.ts" "$container_target/plugins/adopt-catalog.ts"
    cmp "$root/plugins/cap-context.ts" "$container_target/plugins/cap-context.ts"
    diff -r "$root/plugins/orchestrator" "$container_target/plugins/orchestrator"
    diff -r "$root/plugins/deepseek-fallback" "$container_target/plugins/deepseek-fallback"
    # Model instructions are installed locally even when shared skills are read-only.
    for model in gpt-6 claude-fable-5-2 claude-opus-5-5; do
        cmp "$root/models-md/$model.md" "$container_target/models-md/$model.md"
    done
    # No local skills may be installed underneath the temporary read-only mount.
    [ -z "$(ls -A "$container_target/skills")" ]
done
diff -r "$tmp/shared-before" "$tmp/shared-skills"
printf 'Read-only shared skills and independent container configurations: PASS\n'

# A read-only mount from an older host install must surface the stale copies.
mkdir -p "$tmp/shared-skills/avoid-overengineering"
printf 'old entrypoint\n' > "$tmp/shared-skills/avoid-overengineering/SKILL.md"
stale_home="$tmp/stale-home"
mkdir -p "$stale_home/.config/opencode/skills"
run_install "$stale_home" "$stale_home/.config" shared > "$tmp/stale-output.log" 2>&1
cat "$tmp/stale-output.log"
grep -Fq 'still contain old model skills: avoid-overengineering' "$tmp/stale-output.log"
grep -Fq 'run install.sh on the host' "$tmp/stale-output.log"
printf 'Stale shared model skills are reported: PASS\n'

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
