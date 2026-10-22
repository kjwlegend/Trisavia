# Optional local WAL archives

Local development defaults to `archive_mode=off`: PostgreSQL still writes its
active WAL for crash recovery, but does not make continuous archive copies. The
archive helper remains configured for explicit use. `archive_timeout=0` also
disables periodic forced segment switches. An explicitly enabled timeout can
close full-sized 16 MiB segments even under sparse traffic. High-entropy WAL may
compress very little.

`archiveWal` and `backupRuntime` build archive-backed backup sets. With effective
archiving off they fail immediately with `archive_disabled`, before creating
output directories, copying files, switching WAL, or waiting for an archiver.
They do not silently create a partial backup or temporarily enable archiving.
For lightweight development use independent per-database logical dumps with the
matching identity/configuration. No continuous point-in-time recovery is claimed.
An independently planned streaming basebackup can be self-contained, but that is
not a separate mode offered by these two archive-backed functions.

The 2026-10-22 development authorization permits TD to remove current historical
WAL archives and clearly attributable redundant archive-only copies. That replaces
the earlier archive-retention restriction. Cleanup is a separate TD operation;
this package deletes no archives. Preserve business databases, identities and
active `PGDATA/pg_wal`. A backup missing required archived segments no longer
provides the corresponding historical recovery range.

`command.sh SOURCE NAME DIRECTORY [SEGMENT_BYTES]` accepts the existing raw file
or a gzip file only after an exact content comparison and durable sync. A
different/truncated file fails without overwriting or removing it. New gzip data
is verified and synced in a private temporary file, then published with an atomic
non-replacing hard link and directory sync. Only its own temporary file is
removed. These scripts require the PostgreSQL Debian image's gzip, cmp, mktemp,
hard links and GNU sync. The optional segment size defaults to this profile's
16 MiB; a non-default initdb segment size must be supplied consistently.
The TypeScript backup transfer/capacity checks remain scoped to this profile's
16 MiB segments; extend those checks before using a non-default cluster.

`restore.sh NAME DESTINATION DIRECTORY [SEGMENT_BYTES]` reads raw or gzip data,
checks complete segment size/gzip integrity and rejects disagreeing dual
representations. It publishes a validated restore file atomically. Missing or
invalid archives return nonzero; validation/decompression failure does not replace
the destination. A post-publication directory-sync error still reports failure
although the complete replacement may already be visible; the retry is safe.
Historical raw-only physical backups remain supported. `backup.ts archive`
verifies transferred artifacts, ignores only this archiver's in-flight temporary
names, and extends the existing private backup manifest when more WAL is added.
The manifest keeps PostgreSQL's logical `name`; `archiveFile` identifies the
actual raw or `.gz` artifact. Raw and stored-content hashes are distinct.
New backups use `connet-pg-physical-backup-v2`. Extending a historical v1 manifest
with gzip upgrades its format to v2; the old restorer therefore rejects it rather
than silently ending recovery at the last raw segment. The new restorer accepts
legacy raw-only v1 and mixed/raw/gzip v2.

## Existing development cluster: disable without replacing the container

Editing this profile does not change a running server. During the TD maintenance
window, drain the existing business applications, retain only a small private
copy/hash of the existing `PGDATA/postgresql.auto.conf`, and record the current
effective setting. Do not copy the historical archive or entire disk for this
change. Using the original PostgreSQL operator connection, outside a transaction:

```sql
ALTER SYSTEM SET archive_mode = 'off';
ALTER SYSTEM SET archive_timeout = '0';
```

Normally restart the **same container**, allowing a clean shutdown (for example,
`docker --context colima-agents-era-pg restart --time 60 CURRENT_PG_ID`). A reload
does not apply this startup setting. Preserve the original image, data directory,
volume, private pairings, business facts and application versions. Do not create
a replacement container, edit old frozen bind files, initdb, migrate or restore an
old database. Confirm `SHOW archive_mode` returns `off` and `SHOW archive_timeout`
returns `0` after readiness, then
resume the applications using their existing configuration. If a command-line
override prevents the new setting from taking effect, report that specific
dependency rather than editing unrelated settings. TD performs the separately
authorized archive cleanup after confirming continuous archiving is off; this
does not authorize deleting `PGDATA/pg_wal` or database/identity backup material.

## Explicit opt-in and existing backups

Compressed archiving/restoration tools remain available when explicitly needed.
Opting in requires a deliberate `archive_mode=on` startup/restart, the configured
read-only helper mount and a writable archive directory; the dedicated recovery
fixture opts in with its own explicit 60-second timeout only for its disposable
container. The shared development default makes no archive-age/RPO promise.
Do not turn it on in the
shared cluster merely to run a test or work around `archive_disabled`. Restoration
from retained raw/gzip backups does not itself require archiving on at the source.

An explicit metadata-only check is:

```sh
node scripts/postgresql/archive-capacity.ts PRIVATE_RUNTIME_JSON
```

It reports shared-filesystem free bytes, archive/pg_wal sizes, raw/gzip counts and
truncated raw segments. The archive scan stops after 10,000 entries and reports
incompleteness. Free space at or below max(10%, 2 GiB) warns; at or below
max(5%, 512 MiB), or a truncated raw archive, is critical. Warning/critical or an
unavailable observation exits 2. It does not inspect WAL records, monitor in the
background, check `pg_stat_archiver`, decide recyclability or delete anything.
The maintainer must also check archiver progress/failures and respond to pressure;
a successful sample is not evidence of continuous monitoring.

No automated prune, historical recompression, disk cleanup or background schedule
is included. This operator check remains optional; it does not re-enable archives
or require a new large copy before the authorized development cleanup.

The archive success/retry requirements and storage warning follow
[PostgreSQL 18 continuous archiving §25.3.1](https://www.postgresql.org/docs/18/continuous-archiving.html).
The mode is a startup setting; see [PG18 WAL configuration](https://www.postgresql.org/docs/18/runtime-config-wal.html).
Forced-switch handling is in [PG18 CheckArchiveTimeout](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/postmaster/checkpointer.c).
