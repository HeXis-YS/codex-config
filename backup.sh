#!/usr/bin/env bash
set -euo pipefail

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
data_parent=$(dirname "$data_dir")
data_name=$(basename "$data_dir")

usage() {
    cat <<EOF
usage: ${0##*/} backup [ARCHIVE]
       ${0##*/} restore ARCHIVE

Back up and restore the OpenCode data directory:
  $data_dir

The archive is a tar.gz of that directory. The script stops the OpenCode
service automatically. Restore extracts over the existing directory.
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
        tar -czf "$archive" -C "$data_parent" "$data_name"
        echo "Created $archive"
        ;;
    restore)
        archive=${2:-}
        [ -n "$archive" ] || { usage >&2; exit 1; }
        [ -f "$archive" ] || { echo "archive not found: $archive" >&2; exit 1; }
        stop_service
        mkdir -p "$data_parent"
        tar -xzf "$archive" -C "$data_parent"
        echo "Restored $data_dir"
        ;;
    -h|--help|help|'')
        usage
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac
