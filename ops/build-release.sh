#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -eq 2 ]] || { echo 'Usage: build-release.sh revision absolute-output.tar.gz' >&2; exit 1; }
repo=$(git rev-parse --show-toplevel)
revision=$(git -C "$repo" rev-parse --verify --end-of-options "$1^{commit}")
output=$2
[[ "$output" = /* ]] || { echo 'Output must be an absolute path.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Node 24 is required to build a production release."); process.exit(1); }'
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
# Build only an immutable Git archive. Never consume a worktree dist or dependency directory.
git -C "$repo" archive "$revision" apps docs/workstreams/ws03-interaction/life-journal-v1/event-expression-map.json docs/access/v1 scripts/build-web.mjs scripts/web-build scripts/m1-agent.ts scripts/world-core-prepare.ts scripts/world-core-database.ts scripts/behavior-prepare.ts scripts/friendships-prepare.ts scripts/town-services-prepare.ts scripts/new-resident-guide.ts scripts/public-identifiers-prepare.ts scripts/life-prepare.ts scripts/life-b-prepare.ts scripts/life-c-prepare.ts scripts/npc-life-prepare.ts scripts/world-expressions-prepare.ts scripts/world-expansion-prepare.ts scripts/agent-runtime-prepare.ts scripts/avatar-assets-prepare.ts scripts/agent-recurring-guide.ts scripts/agent-profile-guide.ts scripts/publish-world-announcement.ts scripts/ws02-admin-target.ts scripts/postgresql/runtime.ts scripts/postgresql/permissions.ts scripts/postgresql/database.ts package.json package-lock.json ops | tar -x -C "$stage"
(cd "$stage" && npm ci --include=dev --no-audit --no-fund && npm run build:web)
node --input-type=module - "$stage" <<'JS'
import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const {loadProductionWebAssets}=await import(pathToFileURL(root+'/apps/platform/transport/http/web-assets.ts').href);
const result=loadProductionWebAssets(root,root+'/dist/web');
console.log('Validated production web assets: '+result.assets.size);
JS
# Dependencies were used only to construct the public build and are never shipped.
rm -rf -- "$stage/node_modules"
printf '%s\n' "$revision" > "$stage/REVISION"
epoch=$(git -C "$repo" show -s --format=%ct "$revision")
mkdir -p "$(dirname "$output")"
python3 - "$stage" "$output" "$epoch" <<'PY'
import gzip, os, pathlib, tarfile, sys
root=pathlib.Path(sys.argv[1])
output=pathlib.Path(sys.argv[2])
epoch=int(sys.argv[3])
temporary=output.with_name(output.name+'.partial-'+str(os.getpid()))
try:
    paths=[root]+sorted(root.rglob('*'),key=lambda p:p.relative_to(root).as_posix())
    for path in paths:
        if any(part in ('node_modules','.git') for part in path.relative_to(root).parts):
            raise RuntimeError('Private or dependency directory cannot enter a release')
        if path.is_symlink():
            target=os.readlink(path)
            if os.path.isabs(target) or not path.resolve().is_relative_to(root.resolve()):
                raise RuntimeError('Release symlink leaves its archived source')
    with temporary.open('xb') as raw, gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as packed, tarfile.open(fileobj=packed,mode='w',format=tarfile.PAX_FORMAT) as archive:
        for path in paths:
            item=archive.gettarinfo(str(path),arcname='.' if path==root else path.relative_to(root).as_posix())
            item.uid=item.gid=0
            item.uname=item.gname=''
            item.mtime=epoch
            item.pax_headers={}
            item.mode=0o755 if item.isdir() or item.isfile() and path.stat().st_mode & 0o111 else 0o644
            if item.isfile():
                with path.open('rb') as content:
                    archive.addfile(item,content)
            else:
                archive.addfile(item)
    os.replace(temporary,output)
finally:
    if temporary.exists():
        temporary.unlink()
PY
printf 'revision=%s\n' "$revision"
shasum -a 256 "$output"
