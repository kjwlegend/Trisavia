import { Pool } from 'pg';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requirePrivateFile } from './postgresql/runtime.ts';
import { checkedWorldDatabase } from './world-core-database.ts';
import { migratePostgres, POSTGRES_SCHEMA_SIGNATURE } from '../apps/platform/infrastructure/postgresql/migrations.ts';
import { FRIENDSHIPS_LIFECYCLE_PERMISSIONS_SQL } from '../apps/platform/infrastructure/postgresql/friendships-migration.ts';

/** Maintenance only. Run last, after generic grants and any legacy Owner-read preparation. No business seed. */
export async function prepareFriendshipLifecycle(connectionFile: string, identityFile: string, expectedDatabase: string) {
  if (!isAbsolute(connectionFile) || !isAbsolute(identityFile)) throw new Error('Absolute paired private files are required');
  checkedWorldDatabase(expectedDatabase);
  const connectionString = (await requirePrivateFile(connectionFile)).trim(), url = new URL(connectionString), identity = JSON.parse(await requirePrivateFile(identityFile)) as { version: number; instanceId: string; recoveryEpoch: string };
  if (url.hostname !== '127.0.0.1' || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase || identity.version !== 1 || typeof identity.instanceId !== 'string' || typeof identity.recoveryEpoch !== 'string' || !identity.instanceId || !identity.recoveryEpoch) throw new Error('The World database or paired identity differs');
  await migratePostgres({ connectionString, instanceId: identity.instanceId, recoveryEpoch: identity.recoveryEpoch });
  const pool = new Pool({ connectionString, max: 1 }), client = await pool.connect();
  try {
    await client.query('BEGIN');
    const paired = (await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR SHARE')).rows[0];
    if (paired?.instance_id !== identity.instanceId || paired?.recovery_epoch !== identity.recoveryEpoch) throw new Error('World identity changed');
    await client.query(FRIENDSHIPS_LIFECYCLE_PERMISSIONS_SQL);
    const p = (await client.query("SELECT has_table_privilege('connet_app','relationships.friendships','INSERT') AS relation_insert,has_column_privilege('connet_app','relationships.friendships','intimacy_score','UPDATE') AS score_update,has_table_privilege('connet_app','relationships.friendships','UPDATE,DELETE,TRUNCATE') AS relation_broad_write,has_table_privilege('connet_app','relationships.friendship_invitations','SELECT,INSERT,UPDATE') AS request_write,has_table_privilege('connet_app','relationships.friendship_invitations','DELETE,TRUNCATE') AS request_delete,has_table_privilege('connet_app','relationships.intimacy_facts','INSERT') AS fact_insert,has_table_privilege('connet_app','relationships.intimacy_facts','UPDATE,DELETE,TRUNCATE') AS fact_mutate,has_schema_privilege('connet_app','relationships','CREATE') AS schema_create")).rows[0];
    if (!p?.relation_insert || !p.score_update || !p.request_write || !p.fact_insert || p.relation_broad_write || p.request_delete || p.fact_mutate || p.schema_create) throw new Error('Friendship lifecycle privileges differ');
    await client.query('COMMIT');
    return { database: expectedDatabase, schemaSignature: POSTGRES_SCHEMA_SIGNATURE, friendshipsVersion: 2, rulePolicyVersion: 1, applicationDelete: false, sourceHistoryMutable: false, seeded: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [connectionFile, identityFile, database, ...extra] = process.argv.slice(2);
  (async () => { if (!connectionFile || !identityFile || !database || extra.length) throw new Error('Usage: friendships-prepare.ts PRIVATE_MIGRATION_CONNECTION_FILE PAIRED_IDENTITY_FILE EXPECTED_WORLD_DATABASE'); return prepareFriendshipLifecycle(connectionFile, identityFile, database); })().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(() => { process.stderr.write('friendships_prepare_failed; retain the paired target and retry the same source.\n'); process.exitCode = 1; });
}
