#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
tmp="$(mktemp -d /tmp/opencode/verify-install.XXXXXX)"
trap 'rm -rf -- "$tmp"' EXIT
home="$tmp/home"
mkdir -p "$home/.codex" "$home/.config/opencode/skills/personal"
printf 'keep\n' > "$home/.codex/config.toml"
printf 'keep\n' > "$home/.config/opencode/skills/personal/SKILL.md"
cat > "$home/.config/opencode/opencode.json" <<'JSON'
{"$schema":"https://opencode.ai/config.json","mcp":{"servers":{"personal":{"type":"remote","url":"https://example.com/mcp"}}},"providers":{"openai":{"settings":{"baseURL":"https://old.example","timeout":1234}}},"plugins":["personal-plugin","opencode-orchestrator@2.0.20","opencode-orchestrator",{"package":"@personal/extra@1.2.0","options":{"keep":true}}],"unrelated":true}
JSON

HOME="$home" XDG_CONFIG_HOME="$home/.config" "$root/install.sh"
target="$home/.config/opencode"
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
for skill in "$root"/skills/*; do
    cmp "$skill/SKILL.md" "$target/skills/${skill##*/}/SKILL.md"
done
cmp "$root/plugins/cap-context.ts" "$target/plugins/cap-context.ts"
jq -e --slurpfile template "$root/templates/opencode.json" '
    .["$schema"] == "https://opencode.ai/config.json"
    and .mcp.servers.personal.url == "https://example.com/mcp"
    and .unrelated == true
    and .providers.openai.settings.timeout == 1234
    and (.providers | keys == ["anthropic", "deepseek", "openai"])
    and (.providers.openai.settings.apiKey | type == "string" and length > 0 and (startswith("{env:") | not))
    and .providers.anthropic.settings.apiKey == .providers.openai.settings.apiKey
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
before="$tmp/installed-config.json"
cp "$target/opencode.json" "$before"
HOME="$home" XDG_CONFIG_HOME="$home/.config" "$root/install.sh"
cmp "$before" "$target/opencode.json"

# First installation must also configure the package without an existing file.
HOME="$home" XDG_CONFIG_HOME="$tmp/fresh-config" "$root/install.sh"
jq -e --slurpfile template "$root/templates/opencode.json" '. == $template[0]' \
    "$tmp/fresh-config/opencode/opencode.json" >/dev/null
cmp "$root/AGENTS.global.md" "$tmp/fresh-config/opencode/AGENTS.md"
if HOME="$home" XDG_CONFIG_HOME="$home/.config" "$root/install.sh" --profile highgo > /dev/null 2>&1; then
    printf 'legacy --profile option unexpectedly accepted\n' >&2
    exit 1
fi
cmp "$root/AGENTS.global.md" "$target/AGENTS.md"
printf 'OpenCode single-configuration installation checks passed.\n'
