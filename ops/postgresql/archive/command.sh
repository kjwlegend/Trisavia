#!/bin/sh
# PostgreSQL 18 Debian image: gzip, cmp, mktemp, ln and GNU sync are required.
set -eu
umask 077
fail() { printf 'postgresql_archive_failed: %s\n' "$1" >&2; exit 1; }
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || fail arguments
source_file=$1
name=$2
archive=$3
segment_bytes=${4:-16777216}
printf '%s\n' "$name" | grep -Eq '^([0-9A-F]{24}(\.[0-9A-F]{8}\.backup)?|[0-9A-F]{8}\.history)$' || fail filename
case "$segment_bytes" in ''|*[!0-9]*) fail segment_size;; esac
[ "$segment_bytes" -ge 1048576 ] && [ "$segment_bytes" -le 1073741824 ] && [ "$((segment_bytes & (segment_bytes - 1)))" -eq 0 ] || fail segment_size
[ -d "$archive" ] && [ ! -L "$archive" ] || fail archive_directory
[ -f "$source_file" ] && [ ! -L "$source_file" ] || fail source_file
if printf '%s\n' "$name" | grep -Eq '^[0-9A-F]{24}$'; then
  [ "$(wc -c < "$source_file")" -eq "$segment_bytes" ] || fail source_segment_size
fi
raw=$archive/$name
compressed=$archive/$name.gz
existing() {
  found=false
  if [ -e "$raw" ] || [ -L "$raw" ]; then
    [ -f "$raw" ] && [ ! -L "$raw" ] || fail existing_raw_type
    cmp -s "$source_file" "$raw" || fail existing_raw_content
    sync "$raw" || fail existing_raw_sync
    found=true
  fi
  if [ -e "$compressed" ] || [ -L "$compressed" ]; then
    [ -f "$compressed" ] && [ ! -L "$compressed" ] || fail existing_gzip_type
    gzip -t "$compressed" 2>/dev/null || fail existing_gzip_integrity
    gzip -cd "$compressed" 2>/dev/null | cmp -s "$source_file" - || fail existing_gzip_content
    sync "$compressed" || fail existing_gzip_sync
    found=true
  fi
  if [ "$found" = true ]; then sync "$archive" || fail existing_directory_sync; return 0; fi
  return 1
}
if existing; then exit 0; fi
temporary=$(mktemp "$archive/.$name.tmp.XXXXXXXX") || fail temporary_file
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
gzip -n -c "$source_file" > "$temporary" || fail compression
gzip -t "$temporary" 2>/dev/null || fail compressed_integrity
gzip -cd "$temporary" 2>/dev/null | cmp -s "$source_file" - || fail compressed_content
sync "$temporary" || fail temporary_sync
# A hard link publishes the complete file atomically and cannot replace a
# concurrent/existing target. A retry verifies both representations again.
if ln "$temporary" "$compressed" 2>/dev/null; then
  # Also reject a destination that raced into being a directory/symlink. Some
  # ln implementations otherwise treat it as a directory and report success.
  if existing; then exit 0; fi
  fail published_target
else
  if existing; then exit 0; fi
  fail publication
fi
