#!/bin/sh
# Reads either historical raw archives or the new deterministic gzip format.
set -eu
umask 077
fail() { printf 'postgresql_restore_failed: %s\n' "$1" >&2; exit 1; }
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || fail arguments
name=$1
destination=$2
archive=$3
segment_bytes=${4:-16777216}
printf '%s\n' "$name" | grep -Eq '^([0-9A-F]{24}(\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)$' || fail filename
case "$segment_bytes" in ''|*[!0-9]*) fail segment_size;; esac
[ "$segment_bytes" -ge 1048576 ] && [ "$segment_bytes" -le 1073741824 ] && [ "$((segment_bytes & (segment_bytes - 1)))" -eq 0 ] || fail segment_size
[ -d "$archive" ] && [ ! -L "$archive" ] || fail archive_directory
parent=$(dirname -- "$destination")
[ "$(cd "$parent" && pwd -P)" != "$(cd "$archive" && pwd -P)" ] || fail destination_directory
raw=$archive/$name
compressed=$archive/$name.gz
temporary=$(mktemp "$parent/.wal-restore.tmp.XXXXXXXX") || fail temporary_file
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
if [ -e "$compressed" ] || [ -L "$compressed" ]; then
  [ -f "$compressed" ] && [ ! -L "$compressed" ] || fail gzip_type
  gzip -cd "$compressed" > "$temporary" 2>/dev/null || fail gzip_integrity
  if [ -e "$raw" ] || [ -L "$raw" ]; then
    [ -f "$raw" ] && [ ! -L "$raw" ] || fail raw_type
    cmp -s "$raw" "$temporary" || fail representation_conflict
  fi
elif [ -e "$raw" ] || [ -L "$raw" ]; then
  [ -f "$raw" ] && [ ! -L "$raw" ] || fail raw_type
  cat "$raw" > "$temporary" || fail raw_read
else
  fail missing
fi
if printf '%s\n' "$name" | grep -Eq '^[0-9A-F]{24}$'; then
  [ "$(wc -c < "$temporary")" -eq "$segment_bytes" ] || fail segment_size
fi
sync "$temporary" || fail temporary_sync
mv -f -- "$temporary" "$destination" || fail publication
sync "$parent" || fail destination_sync
