import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { M1_TABLES, type StoredRow } from '../../apps/platform/contracts/store.ts';
import type { LegacySnapshot } from '../../apps/platform/infrastructure/postgresql/legacy-codec.ts';
import { migrations } from '../../apps/platform/infrastructure/relational/migrations.ts';
import { canonicalDocument } from '../../apps/platform/domains/perception/protocol.ts';
import { requirePrivateFile } from './runtime.ts';

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
/** Independent comparison encoding, not a replacement for either historical hash algorithm. */
export function comparisonJson(value: unknown): string {
  const sorted = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sorted) : entry !== null && typeof entry === 'object'
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, sorted((entry as Record<string, unknown>)[key])])) : entry;
  return JSON.stringify(sorted(value));
}
export function parseUniqueJson(input: string): unknown {
  const result: unknown = JSON.parse(input); let offset = 0;
  const space = () => { while (/\s/.test(input[offset] ?? '') && offset < input.length) offset++; };
  function string(): string { const start = offset++; while (offset < input.length) { const character = input[offset++]; if (character === '\\') offset++; else if (character === '"') return JSON.parse(input.slice(start, offset)) as string; } throw new Error('Invalid JSON string'); }
  function walk(depth: number): void {
    if (depth > 512) throw new Error('Source JSON exceeds safe inspection depth'); space();
    if (input[offset] === '{') { offset++; space(); const keys = new Set<string>(); if (input[offset] === '}') { offset++; return; }
      for (;;) { space(); const key = string(); if (keys.has(key)) throw new Error('Duplicate source JSON key'); keys.add(key); space(); offset++; walk(depth + 1); space(); if (input[offset++] === '}') return; }
    }
    if (input[offset] === '[') { offset++; space(); if (input[offset] === ']') { offset++; return; } for (;;) { walk(depth + 1); space(); if (input[offset++] === ']') return; } }
    if (input[offset] === '"') { string(); return; }
    while (offset < input.length && !/[\s,}\]]/.test(input[offset]!)) offset++;
  }
  walk(0); return result;
}
export interface SourceRowEvidence { id: string; version: number; sourceJsonSha256: string; semanticSha256: string }
export async function readSqliteSnapshot(databasePath: string, identityPath: string): Promise<{
  snapshot: LegacySnapshot; evidence: { databaseSha256: string; identitySha256: string; tables: Record<string, SourceRowEvidence[]> };
}> {
  const identityText = await requirePrivateFile(identityPath), identity = parseUniqueJson(identityText) as Record<string, unknown>;
  if (identity.version !== 1 || typeof identity.instanceId !== 'string' || typeof identity.recoveryEpoch !== 'string') throw new Error('A paired version1 identity file is required');
  const sourceBytes = await readFile(databasePath), before = sha256(sourceBytes), database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA query_only=ON; BEGIN');
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const expected = ['instance_state', 'schema_migrations', ...M1_TABLES].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('The exact frozen schema6 source table set is required');
    if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Source SQLite integrity check failed');
    const instance = database.prepare('SELECT instance_id,recovery_epoch FROM instance_state WHERE singleton=1').get();
    if (instance?.instance_id !== identity.instanceId || instance.recovery_epoch !== identity.recoveryEpoch || database.prepare('SELECT count(*) n FROM instance_state').get()?.n !== 1) throw new Error('Source database and identity do not match');
    const history = database.prepare('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version').all();
    if (history.length !== 6 || history.some((row, index) => row.version !== index + 1 || row.name !== migrations[index]?.name || row.checksum !== sha256(migrations[index]!.sql) || typeof row.applied_at !== 'string')) throw new Error('Source schema1–6 checksums do not match the frozen SQLite migrations');
    const tables = {} as LegacySnapshot['tables'], evidence: Record<string, SourceRowEvidence[]> = {};
    for (const table of M1_TABLES) {
      tables[table] = []; evidence[table] = [];
      for (const record of database.prepare(`SELECT id,version,CAST(data AS BLOB) raw_data FROM ${table} ORDER BY id COLLATE BINARY`).all()) {
        if (typeof record.id !== 'string' || !Number.isSafeInteger(record.version) || Number(record.version) < 1 || !(record.raw_data instanceof Uint8Array)) throw new Error('Invalid source row envelope');
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(record.raw_data), data = parseUniqueJson(raw);
        if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Source data must be a JSON object');
        const row = { id: record.id, version: Number(record.version), data } as StoredRow; tables[table].push(row);
        evidence[table]!.push({ id: row.id, version: row.version, sourceJsonSha256: sha256(record.raw_data), semanticSha256: sha256(comparisonJson(row)) });
      }
    }
    database.exec('COMMIT');
    if (sha256(await readFile(databasePath)) !== before || await readFile(identityPath, 'utf8') !== identityText) throw new Error('Source changed while preparing the read-only snapshot');
    return { snapshot: { instance: { instance_id: identity.instanceId, recovery_epoch: identity.recoveryEpoch }, migrations: history as unknown as LegacySnapshot['migrations'], tables },
      evidence: { databaseSha256: before, identitySha256: sha256(identityText), tables: evidence } };
  } finally { database.close(); }
}

export function compareSnapshots(source: LegacySnapshot, target: LegacySnapshot): { matched: boolean; differences: { table: string; id: string; reason: string }[]; counts: Record<string, number> } {
  const differences: { table: string; id: string; reason: string }[] = [], counts: Record<string, number> = {};
  for (const [table, left, right] of [['instance_state', source.instance, target.instance], ['schema_migrations', source.migrations, target.migrations]] as const) {
    if (comparisonJson(left) !== comparisonJson(right)) differences.push({ table, id: '', reason: 'metadata_mismatch' });
  }
  for (const table of M1_TABLES) {
    const from = new Map(source.tables[table].map(row => [row.id, row])), to = new Map(target.tables[table].map(row => [row.id, row])); counts[table] = from.size;
    for (const [id, row] of from) if (!to.has(id) || comparisonJson(row) !== comparisonJson(to.get(id))) differences.push({ table, id, reason: to.has(id) ? 'row_mismatch' : 'missing_row' });
    for (const id of to.keys()) if (!from.has(id)) differences.push({ table, id, reason: 'unexpected_row' });
  }
  return { matched: differences.length === 0, differences, counts };
}
export function historicalDocumentEvidence(snapshot: LegacySnapshot): { id: string; version: number; digest: string; canonicalSha256: string }[] {
  return snapshot.tables.perception_catalog.filter(row => /^(guide|schema):/.test(row.id)).map(row => {
    if (typeof row.data.digest !== 'string' || row.data.document === null || typeof row.data.document !== 'object') throw new Error('Historical document is missing its exact digest/content');
    const canonicalSha256 = sha256(canonicalDocument(row.data.document));
    if (canonicalSha256 !== row.data.digest) throw new Error('Historical document digest does not match its original canonical algorithm');
    return { id: row.id, version: row.version, digest: row.data.digest, canonicalSha256 };
  });
}
