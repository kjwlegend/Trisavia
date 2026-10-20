import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { setPostgresWriteGate } from '../../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { requirePrivateFile } from './runtime.ts';

export async function gate(args: string[]) {
  const [connectionFile, identityFile, state, ...extra] = args;
  if (!connectionFile || !identityFile || !['open', 'closed', 'status'].includes(state ?? '') || extra.length) throw new Error('Usage: gate.ts MAINTENANCE_URL_FILE PAIRED_IDENTITY open|closed|status');
  const identity = JSON.parse(await requirePrivateFile(identityFile)) as { version: number; instanceId: string; recoveryEpoch: string };
  if (identity.version !== 1 || !identity.instanceId || !identity.recoveryEpoch) throw new Error('A paired identity is required');
  const options = { connectionString: (await requirePrivateFile(connectionFile)).trim(), instanceId: identity.instanceId, recoveryEpoch: identity.recoveryEpoch };
  if (state !== 'status') await setPostgresWriteGate(options, { enabled: state === 'open' });
  const pool = new Pool({ connectionString: options.connectionString, max: 1 });
  try { const row = (await pool.query('SELECT instance_id,recovery_epoch,writes_enabled,write_generation FROM platform.instance_state WHERE singleton=1')).rows[0];
    if (row?.instance_id !== identity.instanceId || row?.recovery_epoch !== identity.recoveryEpoch) throw new Error('Database and identity mismatch');
    return { identityMatched: true, writesEnabled: row.writes_enabled as boolean, writeGeneration: String(row.write_generation) };
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) gate(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
  .catch(() => { process.stderr.write('postgresql_gate_failed: no identity or proof was printed\n'); process.exitCode = 1; });
