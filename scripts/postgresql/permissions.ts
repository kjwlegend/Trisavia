import {PUBLIC_IDENTIFIERS_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/public-identifiers-migration.ts';
import { pathToFileURL } from 'node:url';
import { docker, readRuntime, type RuntimeConfig } from './runtime.ts';
import { checkedIsolatedDatabase } from './database.ts';

export const applicationSchemas = ['iam', 'profiles', 'platform', 'email', 'wallet', 'mailbox', 'rules', 'items', 'notifications', 'announcements', 'spaces', 'events', 'inventory', 'perception'] as const;
export async function grantApplicationPermissions(config: RuntimeConfig, database: string, cutover = false): Promise<void> {
  if (database !== 'connet' || !cutover) checkedIsolatedDatabase(database);
  const schemas = applicationSchemas.join(',');
  const sql = `BEGIN;\nREVOKE ALL ON SCHEMA ${schemas} FROM connet_app;\nGRANT USAGE ON SCHEMA ${schemas} TO connet_app;\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schemas} TO connet_app;
REVOKE ALL ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state FROM connet_app;
GRANT SELECT ON platform.module_migrations,platform.legacy_schema_migrations,platform.instance_state TO connet_app;
GRANT UPDATE(write_generation) ON platform.instance_state TO connet_app;\n${PUBLIC_IDENTIFIERS_PERMISSIONS_SQL}\nCOMMIT;\n`;
  await docker(['exec', '-i', `${config.project}-server`, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], { input: sql });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, database, cutover, ...extra] = process.argv.slice(2);
  (async () => { if (!file || !database || extra.length || cutover !== undefined && cutover !== '--cutover') throw new Error('Usage: permissions.ts RUNTIME_JSON DATABASE [--cutover]');
    await grantApplicationPermissions(await readRuntime(file), database, cutover === '--cutover'); return { database, runtimeRole: 'connet_app', schemaUsage: true, ddl: false, maintenanceMetadataWrite: false };
  })().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(() => { process.stderr.write('postgresql_application_permissions_failed\n'); process.exitCode = 1; });
}
