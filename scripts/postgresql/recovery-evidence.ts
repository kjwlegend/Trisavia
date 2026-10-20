import { canonicalDocument } from '../../apps/platform/domains/perception/protocol.ts';
import { applicationSchemas } from './permissions.ts';
import { sha256 } from './sqlite-snapshot.ts';
import { docker, type RuntimeConfig } from './runtime.ts';

/** Read-only, full-column physical reconciliation, including child tables and metadata. */
export async function recoveryEvidence(config: RuntimeConfig, database: string, container = `${config.project}-server`) {
  if (!/^connet_(?:rehearsal|test)[a-z0-9_]+$/.test(database)
    || container !== `${config.project}-server` && !new RegExp(`^${config.project}-restore-[a-f0-9-]{36}$`).test(container)) throw new Error('An isolated rehearsal database/container is required');
  async function sql(statement: string) {
    return docker(['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-Atq', '-f', '-'], { input: statement });
  }
  const names = (await sql(`SELECT table_schema||'.'||table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN (${applicationSchemas.map(name => `'${name}'`).join(',')}) ORDER BY table_schema,table_name;`)).trim().split('\n');
  if (!names.length || names.some(name => !/^[a-z_]+\.[a-z_]+$/.test(name))) throw new Error('The complete formal typed table set is required');
  const commands = names.map(name => `SELECT json_build_object('table','${name}','rowCount',count(*),'hashInput',COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text COLLATE "C"),'[]'::jsonb)::text)::text FROM ${name} row;`).join('\n');
  const physical = (await sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${commands}\nCOMMIT;`)).trim().split('\n').map(line => {
    const row = JSON.parse(line) as { table: string; rowCount: number; hashInput: string };
    return { table: row.table, rowCount: row.rowCount, allColumnsSha256: sha256(row.hashInput) };
  });
  if (physical.map(row => row.table).join(',') !== names.join(',')) throw new Error('Typed table fingerprint coverage is incomplete');
  const documents = (await sql("SELECT json_build_object('id',id,'version',version,'digest',digest,'documentText',document_text)::text FROM perception.documents ORDER BY id COLLATE \"C\";")).trim().split('\n').filter(Boolean).map(line => {
    const row = JSON.parse(line) as { id: string; version: number; digest: string; documentText: string };
    const canonical = sha256(canonicalDocument(JSON.parse(row.documentText)));
    if (canonical !== row.digest) throw new Error('A restored historical canonical document/digest does not match');
    return { id: row.id, version: Number(row.version), digest: row.digest, canonicalSha256: canonical, storedDocumentTextSha256: sha256(row.documentText) };
  });
  const identity = JSON.parse((await sql("SELECT json_build_object('instance_id',instance_id,'recovery_epoch',recovery_epoch,'writes_enabled',writes_enabled)::text FROM platform.instance_state WHERE singleton=1;")).trim()) as { instance_id: string; recovery_epoch: string; writes_enabled: boolean };
  return { tables: physical, documents, identity };
}
