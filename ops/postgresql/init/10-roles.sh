#!/bin/sh
set -eu
# Docker's entrypoint executes this as the postgres OS user. Never enable xtrace.
mkdir -p /var/lib/postgresql/wal-archive
chmod 700 /var/lib/postgresql/wal-archive
export CONNET_MIGRATION_PASSWORD="$(cat /run/secrets/migration-password)"
export CONNET_APPLICATION_PASSWORD="$(cat /run/secrets/application-password)"
export CONNET_BACKUP_PASSWORD="$(cat /run/secrets/backup-password)"
psql -X -v ON_ERROR_STOP=1 --username postgres --dbname postgres <<'SQL'
\getenv migration_password CONNET_MIGRATION_PASSWORD
\getenv application_password CONNET_APPLICATION_PASSWORD
\getenv backup_password CONNET_BACKUP_PASSWORD
CREATE ROLE connet_migrator LOGIN PASSWORD :'migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE connet_app LOGIN PASSWORD :'application_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE connet_backup LOGIN REPLICATION PASSWORD :'backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT pg_read_all_data TO connet_backup;
CREATE DATABASE connet OWNER connet_migrator TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8';
REVOKE ALL ON DATABASE connet FROM PUBLIC;
GRANT CONNECT ON DATABASE connet TO connet_app;
GRANT CONNECT ON DATABASE connet TO connet_backup;
ALTER ROLE connet_app SET search_path TO pg_catalog;
ALTER ROLE connet_migrator SET search_path TO pg_catalog;
\connect connet
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset CONNET_MIGRATION_PASSWORD CONNET_APPLICATION_PASSWORD CONNET_BACKUP_PASSWORD
