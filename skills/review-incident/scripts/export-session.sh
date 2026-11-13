#!/usr/bin/env bash
set -euo pipefail

die() { printf 'export-session.sh: %s\n' "$*" >&2; exit 1; }
if [ "$#" -eq 1 ] && [ "$1" = --help ]; then
    cat <<'HELP'
Usage: bash export-session.sh SESSION_ID [NEW_OUTPUT_DIRECTORY]
Requires Bash, jq and OpenCode 2 CLI with access to the target session.
Run in the project holding the incident record; the default output is a new
.opencode/runs/incident-SESSION_ID-TIMESTAMP directory under the current directory.
Uses the CLI's current server/authentication context and only GET API requests.
Writes export.json (unsanitized local evidence), index.jsonl, summary.json,
cli-version.txt and server-info.json. Existing directories are never overwritten.
On failure, exits nonzero and retains any captured files for diagnosis.
HELP
    exit 0
fi
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || die 'expected SESSION_ID and optional new output directory; see --help'
session="$1"
[[ "$session" =~ ^ses_[a-zA-Z0-9]+$ ]] || die 'invalid session ID'
command -v opencode >/dev/null || die 'opencode command not found'
command -v jq >/dev/null || die 'jq command not found'
output="${2:-.opencode/runs/incident-$session-$(date -u +%Y%m%dT%H%M%S%N)}"
mkdir -p -- "$(dirname -- "$output")"
mkdir -- "$output" || die "output must be a new directory: $output"
endpoint="/api/experimental/session/$session/export?sanitize=false"
opencode --version > "$output/cli-version.txt"
opencode api get /api/info > "$output/server-info.json"
opencode api get "$endpoint" > "$output/export.json"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Validate the fields used for attribution and arithmetic at the API boundary.
jq -e --arg session "$session" '
    .data.info.id == $session and (.data.messages | type == "array")
    and all(.data.messages[];
        (.id | type == "string") and (.type | type == "string")
        and (if .type == "assistant" then
            (.model.providerID | type == "string") and (.model.id | type == "string")
            and (.cost == null or (.cost | type == "number"))
            and (.tokens == null or
                ([.tokens.input, .tokens.output, .tokens.reasoning,
                  .tokens.cache.read, .tokens.cache.write] | all(.[]; type == "number")))
        else true end))
' "$output/export.json" >/dev/null || die "unexpected export schema or session ID; evidence retained in $output"

jq -c '.data.messages | to_entries[] | {
    index: (.key + 1), id: .value.id, type: .value.type,
    time: .value.time, model: .value.model
}' "$output/export.json" > "$output/index.jsonl"

jq --arg captured_at "$captured_at" --arg endpoint "$endpoint" '
    def metric($path):
        map(getpath($path)) as $values
        | [$values[] | numbers] as $reported
        | {reported_messages: ($reported | length),
           missing_messages: (($values | length) - ($reported | length)),
           sum: (if ($reported | length) == 0 then null else ($reported | add) end)};
    def usage:
        {assistant_messages: length, cost_usd: metric(["cost"]),
         tokens: {input: metric(["tokens", "input"]), output: metric(["tokens", "output"]),
                  reasoning: metric(["tokens", "reasoning"]),
                  cache_read: metric(["tokens", "cache", "read"]),
                  cache_write: metric(["tokens", "cache", "write"])}};
    .data as $data | [$data.messages[] | select(.type == "assistant")] as $assistant
    | {captured_at: $captured_at, endpoint: $endpoint, session: $data.info,
       message_count: ($data.messages | length),
       first_message_id: $data.messages[0].id, last_message_id: $data.messages[-1].id,
       scope: "Reported assistant-message usage in this export, not attributable incident loss or a billing total. Missing values are not zero. Token categories are not combined.",
       usage: ($assistant | usage),
       by_model: ($assistant | group_by([.model.providerID, .model.id, .model.variant])
           | map({model: .[0].model, usage: usage}))}
' "$output/export.json" > "$output/summary.json"
printf 'Session evidence saved to %s\n' "$output"
