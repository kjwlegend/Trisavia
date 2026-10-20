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
}, {
  version: 4,
  name: 'm1_email_onboarding',
  sql: `
    CREATE TABLE email_attempts (
      id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
      version INTEGER NOT NULL CHECK(version > 0),
      data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      browser_credential_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.browserCredentialId')) STORED NOT NULL UNIQUE REFERENCES credentials(id),
      CHECK(COALESCE(json_extract(data, '$.purpose') IN ('registration', 'recovery'), 0))
    ) STRICT;
    CREATE UNIQUE INDEX email_attempts_recovery_request_unique ON email_attempts(json_extract(data, '$.requestId'))
      WHERE json_extract(data, '$.purpose') = 'recovery';
    CREATE TABLE mail_jobs (
      id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
      version INTEGER NOT NULL CHECK(version > 0),
      data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')
    ) STRICT;
    CREATE UNIQUE INDEX mail_jobs_idempotency_unique ON mail_jobs(json_extract(data, '$.idempotencyKey'));
    CREATE INDEX mail_jobs_owner_index ON mail_jobs(json_extract(data, '$.ownerKey'));
  `,
}, {
  version: 5,
  name: 'ws02_manual_perception',
  sql: `
    CREATE TABLE perception_objects (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')) STRICT;
    CREATE TABLE perception_grants (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
      object_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.objectId')) STORED NOT NULL REFERENCES perception_objects(id)) STRICT;
    CREATE UNIQUE INDEX perception_grants_unique ON perception_grants(agent_id, object_id, json_extract(data, '$.kind'));
    CREATE TABLE perception_states (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
      object_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.objectId')) STORED NOT NULL REFERENCES perception_objects(id), UNIQUE(agent_id, object_id)) STRICT;
    CREATE TABLE perception_sessions (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')) STRICT;
    CREATE TABLE perception_access (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')) STRICT;
    CREATE TABLE perception_catalog (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object')) STRICT;
    CREATE INDEX perception_objects_category ON perception_objects(json_extract(data, '$.categoryId'), id);
    CREATE INDEX perception_grants_actor ON perception_grants(json_extract(data, '$.agentId'), json_extract(data, '$.kind'), id);
    CREATE INDEX perception_states_actor ON perception_states(agent_id);
    CREATE INDEX perception_sessions_actor ON perception_sessions(json_extract(data, '$.actorId'), id);
    CREATE INDEX perception_access_actor ON perception_access(json_extract(data, '$.agentId'), id);
    CREATE INDEX perception_access_audience ON perception_access(json_extract(data, '$.humanAudienceOwnerId'), id);
  `,
}, {
  version: 6,
  name: 'ws02_wallet_and_original_mailbox',
  sql: `
    CREATE TABLE wallet_accounts (
      id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
      currency_code TEXT GENERATED ALWAYS AS (json_extract(data, '$.currencyCode')) STORED NOT NULL,
      CHECK(currency_code = 'star_coin'), CHECK(id = 'star_coin:' || agent_id),
      CHECK(json_type(data, '$.currencyName') IS 'text' AND length(json_extract(data, '$.currencyName')) BETWEEN 1 AND 100),
      CHECK(json_type(data, '$.scale') IS 'integer' AND json_extract(data, '$.scale') IS 0),
      CHECK(json_type(data, '$.balance') IS 'integer' AND json_extract(data, '$.balance') BETWEEN 0 AND 9007199254740991),
      CHECK(json_type(data, '$.initializedAt') IS 'integer' AND json_extract(data, '$.initializedAt') >= 0),
      CHECK(COALESCE(json_extract(data, '$.initializationSource') IN ('migration','registration'),0)),
      UNIQUE(agent_id, currency_code)
    ) STRICT;
    INSERT INTO wallet_accounts(id,version,data)
      SELECT 'star_coin:' || id,1,json_object('agentId',id,'currencyCode','star_coin','currencyName','星币','scale',0,'balance',0,'initializedAt',CAST(strftime('%s','now') AS INTEGER)*1000,'initializationSource','migration') FROM agents;
    CREATE TABLE mailbox_messages (
      id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version = 1), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      logical_message_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.messageId')) STORED NOT NULL,
      source_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.sourceId')) STORED NOT NULL,
      source_message_key TEXT GENERATED ALWAYS AS (json_extract(data, '$.sourceMessageKey')) STORED NOT NULL,
      content_version INTEGER GENERATED ALWAYS AS (json_extract(data, '$.contentVersion')) STORED NOT NULL CHECK(content_version > 0 AND content_version <= 9007199254740991),
      sender_agent_id TEXT GENERATED ALWAYS AS (CASE WHEN json_extract(data,'$.sender.kind') = 'agent' THEN json_extract(data,'$.sender.ref.id') ELSE NULL END) STORED REFERENCES agents(id),
      CHECK(json_type(data,'$.contentVersion') IS 'integer'),
      CHECK(json_type(data, '$.title') IS 'text' AND length(json_extract(data, '$.title')) BETWEEN 1 AND 180),
      CHECK(json_type(data, '$.body') IS 'text' AND length(json_extract(data, '$.body')) <= 100000),
      CHECK(json_type(data, '$.attachments') IS 'array'),
      CHECK(COALESCE(json_extract(data, '$.sender.kind') IN ('human','agent'),0)),
      CHECK(json_type(data, '$.sender.ref') IS 'object' AND json_type(data, '$.sender.displayName') IS 'text'),
      UNIQUE(source_id, source_message_key, content_version), UNIQUE(id, logical_message_id)
    ) STRICT;
    CREATE TRIGGER mailbox_messages_immutable BEFORE UPDATE ON mailbox_messages BEGIN SELECT RAISE(ABORT,'Original mailbox content versions are immutable'); END;
    CREATE TABLE mailbox_receipts (
      id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
      message_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.messageId')) STORED NOT NULL,
      message_version_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.messageVersionId')) STORED NOT NULL,
      agent_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.agentId')) STORED NOT NULL REFERENCES agents(id),
      CHECK(COALESCE(json_type(data, '$.active') IN ('true','false'),0)),
      CHECK(json_type(data, '$.ownerObservation') IS 'object'),
      CHECK(json_type(data, '$.stateVersion') IS 'integer' AND json_extract(data, '$.stateVersion') >= 0),
      CHECK(json_type(data, '$.confirmedAt') IS 'null' OR (json_type(data, '$.confirmedAt') IS 'integer' AND json_extract(data,'$.confirmedAt') >= 0)),
      CHECK(json_type(data, '$.confirmedContentVersion') IS 'null' OR (json_type(data, '$.confirmedContentVersion') IS 'integer' AND json_extract(data, '$.confirmedContentVersion') > 0)),
      FOREIGN KEY(message_version_id,message_id) REFERENCES mailbox_messages(id,logical_message_id), UNIQUE(message_id, agent_id)
    ) STRICT;
    CREATE INDEX mailbox_receipts_recipient ON mailbox_receipts(json_extract(data, '$.agentId'),id);
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
