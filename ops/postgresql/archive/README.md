# Local WAL archive capacity

The PostgreSQL 18 profile retains `archive_timeout=60s`. That interval bounds the
age of unarchived work; it also closes full-sized 16 MiB segment files when
traffic is sparse. Compression reduces their stored size without changing the
interval, WAL content or recovery sequence. High-entropy/busy WAL may compress
very little. This change is not a retention policy or an unlimited-capacity claim.

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

No live deployment is performed by editing these files. After independent review,
the named maintainer must preserve the current cluster/identity and all subsequent
writes, install the read-only archive helper mount together with the matching
configuration, and verify a later natural archive plus a separate restore. The
current container predates the helper mount: a configuration reload alone cannot
install a missing mount. Preserve the existing volume and pinned image when the
maintainer schedules its replacement. Do not run a fresh initdb, reset a volume,
disable archiving, or lengthen the interval as a capacity workaround.

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

Existing raw archives are kept. No automated prune, recompression of historical
files, disk cleanup or background schedule is included. Reclaiming any archive
requires a separate, evidenced decision covering every retained basebackup and
its continuous recovery range, verified independent transfer, and a successful
newer restore. An enlarged local disk and compression do not replace that work,
off-host copies, a named operator or ongoing capacity review.

The archive success/retry requirements and storage warning follow
[PostgreSQL 18 continuous archiving §25.3.1](https://www.postgresql.org/docs/18/continuous-archiving.html).
