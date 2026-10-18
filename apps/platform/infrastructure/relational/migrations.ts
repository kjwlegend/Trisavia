import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../../contracts/store.ts';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const tables = [
  'agents', 'owners', 'credentials', 'bindings', 'registrations',
  'profiles', 'memberships', 'operations', 'facts',
] as const;

const references: Partial<Record<(typeof tables)[number], string>> = {
  credentials: `,
    agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED REFERENCES agents(id),
    owner_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.ownerId')) STORED REFERENCES owners(id),
    CHECK(json_type(data, '$.fingerprint') IS 'text' AND length(json_extract(data, '$.fingerprint')) > 0)
  `,
  bindings: `,
    agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
    owner_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.ownerId')) STORED NOT NULL REFERENCES owners(id),
    CHECK(COALESCE(json_type(data, '$.active') IN ('true', 'false'), 0))
  `,
  registrations: `,
    agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED REFERENCES agents(id),
    owner_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.ownerId')) STORED REFERENCES owners(id),
    runtime_credential_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.runtimeCredentialId')) STORED REFERENCES credentials(id),
    continuation_credential_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.continuationCredentialId')) STORED REFERENCES credentials(id)
  `,
  profiles: `,
    agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL UNIQUE REFERENCES agents(id)
  `,
  memberships: `,
    agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
    world_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.worldId')) STORED NOT NULL,
    UNIQUE(agent_id, world_id)
  `,
  operations: `,
    CHECK(json_type(data, '$.scope') IS 'text' AND length(json_extract(data, '$.scope')) > 0),
    CHECK(json_type(data, '$.action') IS 'text' AND length(json_extract(data, '$.action')) > 0),
    CHECK(json_type(data, '$.operationId') IS 'text' AND length(json_extract(data, '$.operationId')) > 0),
    CHECK(json_type(data, '$.epoch') IS 'text' AND length(json_extract(data, '$.epoch')) > 0)
  `,
};

export const migrations: readonly Migration[] = [{
  version: 1,
  name: 'm1_entity_storage',
  sql: `
    CREATE TABLE instance_state (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
      instance_id TEXT NOT NULL CHECK(length(instance_id) > 0),
      recovery_epoch TEXT NOT NULL CHECK(length(recovery_epoch) > 0)
    ) STRICT;
  ` + tables.map((table) => `
    CREATE TABLE ${table} (
      id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
      version INTEGER NOT NULL CHECK(version > 0),
      data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')
      ${references[table] ?? ''}
    ) STRICT;
  `).join('\n') + `
    CREATE UNIQUE INDEX credentials_fingerprint_unique ON credentials(json_extract(data, '$.fingerprint'));
    CREATE UNIQUE INDEX bindings_active_agent_unique ON bindings(agent_id) WHERE json_extract(data, '$.active') = 1;
    CREATE INDEX bindings_owner_index ON bindings(owner_id);
    CREATE UNIQUE INDEX operations_command_unique ON operations(
      json_extract(data, '$.scope'), json_extract(data, '$.action'),
      json_extract(data, '$.operationId'), json_extract(data, '$.epoch')
    );
  `,
}, {
  version: 2,
  name: 'm1_owner_accounts',
  // Application normalization supplies the NFKC/ASCII keys. SQLite, not a prior
  // availability lookup, is the final arbiter across concurrent connections.
  sql: `
    CREATE UNIQUE INDEX owners_username_key_unique ON owners(json_extract(data, '$.usernameKey'))
      WHERE json_extract(data, '$.usernameKey') IS NOT NULL;
    CREATE UNIQUE INDEX owners_email_key_unique ON owners(json_extract(data, '$.emailKey'))
      WHERE json_extract(data, '$.emailKey') IS NOT NULL;
  `,
}, {
  version: 3,
  name: 'm1_owner_recovery_assistance',
  sql: `
    CREATE TABLE recovery_requests (
      id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
      version INTEGER NOT NULL CHECK(version > 0),
      data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
      owner_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.ownerId')) STORED NOT NULL REFERENCES owners(id),
      context_credential_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.contextCredentialId')) STORED NOT NULL UNIQUE REFERENCES credentials(id),
      CHECK(COALESCE(json_extract(data, '$.status') IN ('pending', 'completed', 'cancelled'), 0)),
      CHECK(context_credential_id = id)
    ) STRICT;
    CREATE INDEX recovery_requests_agent_index ON recovery_requests(agent_id);
  `,
}];

function checksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex');
}

/** Migrations are ordered, checksummed, and applied in one exclusive write scope. */
export function migrateDatabase(
  database: DatabaseSync,
  definitions: readonly Migration[] = migrations,
): void {
  for (const [index, migration] of definitions.entries()) {
    if (migration.version !== index + 1 || !migration.name || !migration.sql.trim()) {
      throw new StorageError('invalid_usage', 'Invalid migration sequence');
    }
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const applied = database.prepare(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    ).all();
    for (const [index, row] of applied.entries()) {
      const expected = definitions[index];
      if (!expected || row.version !== expected.version || row.name !== expected.name ||
          row.checksum !== checksum(expected)) {
        throw new StorageError('conflict', 'Database migration history does not match this application');
      }
    }

    const record = database.prepare(
      'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    );
    for (const migration of definitions.slice(applied.length)) {
      database.exec(migration.sql);
      record.run(migration.version, migration.name, checksum(migration), new Date().toISOString());
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}
