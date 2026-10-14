#!/usr/bin/env bash
set -euo pipefail
umask 077
repo=$(git rev-parse --show-toplevel)
revision=$(git -C "$repo" rev-parse --verify "${1:-HEAD}^{commit}")
output=${2:?Usage: build-release.sh revision absolute-output.tar.gz}
[[ "$output" = /* ]] || { echo 'Output must be an absolute path.' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
# Archive only committed runtime, public protocol docs and operations files.
# Never copy a worktree, node_modules, local databases or test fixtures.
git -C "$repo" archive "$revision" apps docs/access/v1 scripts/m1-agent.ts package.json package-lock.json ops | tar -x -C "$stage"
printf '%s\n' "$revision" > "$stage/REVISION"
mkdir -p "$(dirname "$output")"
tar -czf "$output" -C "$stage" .
printf 'revision=%s\n' "$revision"
shasum -a 256 "$output"
