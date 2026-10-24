import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { requirePrivateFile } from '../scripts/postgresql/runtime.ts';
import { applicationSchemas } from '../scripts/postgresql/permissions.ts';
import { checkedWorldDatabase } from '../scripts/world-core-database.ts';
import { prepareBehaviorSources } from '../scripts/behavior-prepare.ts';
import { prepareTownServices } from '../scripts/town-services-prepare.ts';
import { prepareFriendshipLifecycle } from '../scripts/friendships-prepare.ts';
import { migratePostgres, POSTGRES_SCHEMA_SIGNATURE } from '../apps/platform/infrastructure/postgresql/migrations.ts';
import { openPostgresStore, setPostgresWriteGate } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { openRuntimeStore } from '../apps/platform/infrastructure/postgresql/runtime-store.ts';
import { BEHAVIOR_PERMISSIONS_SQL } from '../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import { TOWN_PERMISSIONS_SQL } from '../apps/platform/infrastructure/postgresql/town-services-migration.ts';
import { bootstrapPlatformCatalog, verifyApplicationReadiness } from '../apps/platform/application/bootstrap.ts';
import { bootstrapWorld, verifyWorldReadiness } from '../apps/platform/application/world-service.ts';
import { bootstrapInteraction } from '../apps/platform/application/interaction-service.ts';
import { publishNpcServiceReaders } from '../apps/platform/application/perception-admin.ts';
import { publishCatalogInTransaction } from '../apps/platform/application/perception-catalog.ts';
import { AGENT_AUTONOMY_GUIDE, AGENT_HUMAN_VOICE_GUIDE } from '../apps/platform/application/agent-human-voice.ts';
import { CURRENT_HOURLY_AUTONOMY_GUIDE, CURRENT_HOURLY_HUMAN_GUIDE, HOURLY_HOST_GUIDE } from '../apps/platform/application/agent-hourly-participation-guide.ts';
import { catalogRepository } from '../apps/platform/domains/perception/repository.ts';
import { key, plain } from '../apps/platform/domains/perception/protocol.ts';
import { townV2Rules } from '../apps/platform/domains/world/town-v2.ts';

/** Fresh server maintenance only. Never resets, seeds residents, starts the application or opens its final write gate. */
export async function initializeUat(directory: string, database: string) {
  if (!isAbsolute(directory)) throw new Error('An absolute private directory is required');
  checkedWorldDatabase(database);
  const migrationFile = join(directory, 'migration-database-url'), applicationFile = join(directory, 'application-database-url');
  const connectionString = (await requirePrivateFile(migrationFile)).trim(), applicationUrl = (await requirePrivateFile(applicationFile)).trim();
  for (const value of [connectionString, applicationUrl]) if (/[?#\u0000-\u0020\u007f]/u.test(value)) throw new Error('Maintenance URLs cannot contain query, fragment or control characters');
  const migration = new URL(connectionString), application = new URL(applicationUrl);
  for (const url of [migration, application]) if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || url.hostname !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(url.port) || Number(url.port) > 65535 || decodeURIComponent(url.pathname.slice(1)) !== database) throw new Error('Explicit loopback database pairing required');
  if (migration.username !== 'connet_migrator' || application.username !== 'connet_app' || migration.port !== application.port) throw new Error('Dedicated maintenance/application roles required');
  const maintenance = new Pool({ connectionString, max: 1 });
  try {
    const check = (await maintenance.query("SELECT current_database() AS database,pg_get_userbyid(datdba) AS owner,(SELECT count(*)::int FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')) AS tables FROM pg_database WHERE datname=current_database()")).rows[0];
    if (check?.database !== database || check.owner !== 'connet_migrator' || check.tables !== 0) throw new Error('A newly created empty dedicated database is required');
  } finally { await maintenance.end(); }
  const identity = { instanceId: 'instance_' + randomUUID(), recoveryEpoch: 'epoch_' + randomUUID() }, identityFile = join(directory, 'identity.json');
  await writeFile(identityFile, JSON.stringify({ version: 1, ...identity }) + '\n', { mode: 0o600, flag: 'wx' });
  const options = { connectionString, ...identity };
  await migratePostgres(options);
  const permissions = new Pool({ connectionString, max: 1 }), old = applicationSchemas.join(','), added = 'runtime,world,interaction,decision,behavior';
  try {
    // Same grants as world-core-prepare; remote provisioning does not impersonate its Colima-only runtime.
    await permissions.query(`BEGIN;
      REVOKE ALL ON SCHEMA ${old},${added} FROM connet_app;
      GRANT USAGE ON SCHEMA ${old},${added} TO connet_app;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${old} TO connet_app;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${added} TO connet_app;
      REVOKE ALL ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state FROM connet_app;
      GRANT SELECT ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state TO connet_app;
      GRANT UPDATE(write_generation) ON platform.instance_state TO connet_app;
      REVOKE ALL ON runtime.event_clock FROM connet_app;GRANT SELECT,UPDATE(position) ON runtime.event_clock TO connet_app;
      ${BEHAVIOR_PERMISSIONS_SQL}
      ${TOWN_PERMISSIONS_SQL}
      COMMIT;`);
  } finally { await permissions.end(); }
  const appOptions = { ...identity, connectionString: applicationUrl }, legacy = await openPostgresStore(appOptions), runtime = await openRuntimeStore(appOptions);
  try {
    await setPostgresWriteGate(options, { enabled: true });
    const bytes = await readFile(new URL('../apps/web/public/world-map-v2.json', import.meta.url));
    await bootstrapPlatformCatalog(legacy);
    await runtime.transaction(async context => {
      await bootstrapWorld(context, townV2Rules(JSON.parse(bytes.toString()), createHash('sha256').update(bytes).digest('hex')));
      await bootstrapInteraction(context);
      if (await context.tasks.currentGeneration('decision') === 0) await context.tasks.advanceGeneration('decision', 0);
    });
  } finally { await setPostgresWriteGate(options, { enabled: false }); await legacy.close(); await runtime.close(); }
  await prepareBehaviorSources(migrationFile, identityFile, database, { activate: true });
  await prepareTownServices(migrationFile, identityFile, database, { activate: true });
  const publication = await openPostgresStore(appOptions);
  try {
    await setPostgresWriteGate(options, { enabled: true });
    await publishNpcServiceReaders(publication, { actorId: 'uat-bootstrap', operationId: 'uat-npc-readers-v1', expectedInstanceId: identity.instanceId, expectedRecoveryEpoch: identity.recoveryEpoch, expectedCatalogRevision: 'catalog-fresh-paper-hud-1', revision: 'catalog-npc-services-1', expectedGuideVersion: 3, guideVersion: 4 });
    await publication.transaction(async tx => {
      const repository = catalogRepository(tx), current = await repository.get('current'), document = plain((await repository.get('guide:world:4'))?.data.document);
      if (current?.data.catalogRevision !== 'catalog-npc-services-1' || current.data.schemaVersion !== 6 || current.data.guideVersion !== 4 || typeof document.text !== 'string') throw new Error('Exact fresh NPC guide4 predecessor required');
      for (const oldText of [AGENT_AUTONOMY_GUIDE, AGENT_HUMAN_VOICE_GUIDE]) if (document.text.split(oldText).length !== 2) throw new Error('Expected exactly one frozen guidance segment');
      for (const moduleId of ['perception', 'world', 'profiles', 'items', 'inventory', 'mailbox', 'wallet']) if (plain((await repository.get(`guide:${moduleId}:4`))?.data.document).text !== document.text || await repository.get(`guide:${moduleId}:5`)) throw new Error('Fresh exact guide set differs');
      const guideText = document.text.replace(AGENT_AUTONOMY_GUIDE, CURRENT_HOURLY_AUTONOMY_GUIDE).replace(AGENT_HUMAN_VOICE_GUIDE, CURRENT_HOURLY_HUMAN_GUIDE) + '\n' + HOURLY_HOST_GUIDE;
      await publishCatalogInTransaction(tx, { revision: 'catalog-uat-current-1', guideVersion: 5, guideText });
      const after = (await repository.get('current'))!;
      if (key(after.data.sourceStates) !== key(current.data.sourceStates) || key(after.data.seedObjectIds) !== key(current.data.seedObjectIds) || after.data.schemaVersion !== 6) throw new Error('Guide-only publication changed source state');
    });
  } finally { await setPostgresWriteGate(options, { enabled: false }); await publication.close(); }
  await prepareFriendshipLifecycle(migrationFile, identityFile, database);
  const readyLegacy = await openPostgresStore(appOptions), readyRuntime = await openRuntimeStore(appOptions);
  try { await verifyApplicationReadiness(readyLegacy); await readyRuntime.read(context => verifyWorldReadiness(context)); }
  finally { await readyLegacy.close(); await readyRuntime.close(); }
  return { database, instanceId: identity.instanceId, schemaSignature: POSTGRES_SCHEMA_SIGNATURE, schemaVersion: 6, catalogRevision: 'catalog-uat-current-1', guideVersion: 5, writeGate: false, seededResidents: false, ready: true };
}

if (import.meta.main) {
  const [directory, database, ...extra] = process.argv.slice(2);
  if (!directory || !database || extra.length) throw new Error('Usage: initialize-uat.ts ABSOLUTE_PRIVATE_DIRECTORY EMPTY_WORLD_DATABASE');
  initializeUat(resolve(directory), database).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Fresh UAT initialization failed; retain the dedicated target and inspect privately.'); process.exitCode = 1; });
}
