#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
mkdir -p "$root/.opencode/runs"
run="$(mktemp -d "$root/.opencode/runs/verify-incident-export.XXXXXX")"
exec > >(tee "$run/result.log") 2>&1
printf 'Verification evidence: %s\n' "$run"
cp "$root/skills/review-incident/scripts/export-session.sh" "$run/export-session.sh"
cp "${BASH_SOURCE[0]}" "$run/verify-incident-export.sh"
{
    bash --version
    jq --version
    git -C "$root" rev-parse HEAD
    git -C "$root" status --short
} > "$run/environment.txt"
git -C "$root" diff --binary > "$run/worktree.diff"
mkdir "$run/bin"
export FIXTURE="$run/fixture.json"
cat > "$FIXTURE" <<'JSON'
{"data":{"info":{"id":"ses_Test","model":{"providerID":"other","id":"current"}},"messages":[
{"id":"msg_1","type":"user","time":{"created":1000},"content":[{"type":"text","text":"Review the full output"}]},
{"id":"msg_2","type":"assistant","time":{"created":2000},"model":{"providerID":"a","id":"model","variant":"high"},"cost":1.25,"tokens":{"input":10,"output":5,"reasoning":2,"cache":{"read":3,"write":4}},"content":[{"type":"tool","state":{"output":"first\nlast"}}]},
{"id":"msg_3","type":"assistant","time":{"created":3000},"model":{"providerID":"b","id":"model"},"content":[]},
{"id":"msg_4","type":"assistant","time":{"created":4000},"model":{"providerID":"a","id":"model","variant":"high"},"cost":0,"tokens":{"input":20,"output":6,"reasoning":1,"cache":{"read":7,"write":0}},"content":[]}
]}}
JSON
# Replace only the external CLI; run the real collector and jq arithmetic.
cat > "$run/bin/opencode" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
    --version) printf 'fixture OpenCode 2\n' ;;
    'api get /api/info') printf '{"version":"fixture"}\n' ;;
    'api get /api/experimental/session/ses_Test/export?sanitize=false')
        if [ "${FAIL_EXPORT:-0}" = 1 ]; then exit 42; fi
        cat "$FIXTURE"
        ;;
    *) printf 'Unexpected CLI request: %s\n' "$*" >&2; exit 1 ;;
esac
SH
chmod +x "$run/bin/opencode"
export PATH="$run/bin:$PATH"
bash "$run/export-session.sh" ses_Test "$run/success"
cmp "$FIXTURE" "$run/success/export.json"
jq -e '
    .message_count == 4 and .first_message_id == "msg_1" and .last_message_id == "msg_4"
    and .usage.assistant_messages == 3
    and .usage.cost_usd == {reported_messages: 2, missing_messages: 1, sum: 1.25}
    and .usage.tokens.input.sum == 30 and .usage.tokens.output.sum == 11
    and .usage.tokens.reasoning.sum == 3
    and .usage.tokens.cache_read.sum == 10 and .usage.tokens.cache_write.sum == 4
    and (.by_model | length) == 2
    and .by_model[0].model == {providerID:"a", id:"model", variant:"high"}
    and .by_model[0].usage.assistant_messages == 2
    and .by_model[1].usage.cost_usd == {reported_messages: 0, missing_messages: 1, sum: null}
    and .by_model[1].usage.tokens.input.sum == null
' "$run/success/summary.json" >/dev/null
jq -se 'map(.index) == [1,2,3,4] and map(.id) == ["msg_1","msg_2","msg_3","msg_4"]' \
    "$run/success/index.jsonl" >/dev/null

if bash "$run/export-session.sh" ses_Test "$run/success" > "$run/existing-directory.log" 2>&1; then
    printf 'Existing evidence directory was unexpectedly accepted\n' >&2
    exit 1
fi
cmp "$FIXTURE" "$run/success/export.json"

for invalid in wrong-session invalid-cost; do
    if [ "$invalid" = wrong-session ]; then
        jq '.data.info.id = "ses_Other"' "$run/fixture.json" > "$run/$invalid.json"
    else
        jq '.data.messages[1].cost = "unknown"' "$run/fixture.json" > "$run/$invalid.json"
    fi
    if FIXTURE="$run/$invalid.json" bash "$run/export-session.sh" ses_Test "$run/$invalid" > "$run/$invalid.log" 2>&1; then
        printf 'Invalid response accepted: %s\n' "$invalid" >&2
        exit 1
    fi
    cmp "$run/$invalid.json" "$run/$invalid/export.json"
    [ ! -e "$run/$invalid/summary.json" ]
done
if FAIL_EXPORT=1 bash "$run/export-session.sh" ses_Test "$run/api-failure" > "$run/api-failure.log" 2>&1; then
    printf 'API failure unexpectedly succeeded\n' >&2
    exit 1
fi
[ ! -e "$run/api-failure/summary.json" ]
printf 'Incident export checks passed: evidence retention, ordering, per-model usage, missing values, and failure handling.\n'
