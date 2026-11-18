#!/usr/bin/env bash
set -euo pipefail

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
data_parent=$(dirname "$data_dir")
data_name=$(basename "$data_dir")
state_parent=$(dirname "$state_dir")
state_name=$(basename "$state_dir")

usage() {
    cat <<EOF
usage: ${0##*/} backup [ARCHIVE]
       ${0##*/} restore ARCHIVE

Back up and restore the OpenCode data and state directories:
  $data_dir
  $state_dir

The archive is a tar.gz of the data directory and, when present, the state
directory. The script stops the OpenCode service automatically. Restore
extracts over the existing directories.
EOF
}

stop_service() {
    if ! command -v opencode >/dev/null 2>&1; then
        echo 'opencode command not found; skipping service stop' >&2
        return
    fi
    opencode service stop >/dev/null 2>&1 || true
}

case "${1:-}" in
    backup)
        archive=${2:-"opencode-backup-$(date +%Y%m%d-%H%M%S).tar.gz"}
        [ -d "$data_dir" ] || { echo "no data directory: $data_dir" >&2; exit 1; }
        stop_service
        if [ -d "$state_dir" ]; then
            # Store state under a separate top-level path without copying it.
            stage=$(mktemp -d)
            trap 'rm -rf -- "$stage"' EXIT
            ln -s "$state_parent" "$stage/state"
            tar -czf "$archive" \
                -C "$data_parent" "$data_name" \
                -C "$stage" "state/$state_name"
        else
            tar -czf "$archive" -C "$data_parent" "$data_name"
        fi
        echo "Created $archive"
        ;;
    restore)
        archive=${2:-}
        [ -n "$archive" ] || { usage >&2; exit 1; }
        [ -f "$archive" ] || { echo "archive not found: $archive" >&2; exit 1; }
        stop_service
        mkdir -p "$data_parent"
        tar -xzf "$archive" -C "$data_parent" "$data_name"
        echo "Restored $data_dir"
        if tar -tzf "$archive" "state/$state_name" >/dev/null 2>&1; then
            mkdir -p "$state_parent"
            tar -xzf "$archive" -C "$state_parent" \
                --strip-components=1 "state/$state_name"
            echo "Restored $state_dir"
        fi
        ;;
    -h|--help|help|'')
        usage
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac
