import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { migrateDatabase } from './migrations.ts';
import {
  M1_TABLES, StorageError,
  type ExactFilters, type JsonObject, type M1ReadSession, type M1Store,
  type M1Table, type M1Transaction, type OpenM1StoreOptions, type StoredRow,
} from '../../contracts/store.ts';

const tableNames: ReadonlySet<string> = new Set(M1_TABLES);

function boundedLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_001) throw new StorageError('invalid_usage', 'Invalid bounded read limit');
}

function filterSql(filters: ExactFilters): { sql: string; values: SQLInputValue[] } {
  objectJson(filters);
  const clauses: string[] = [], values: SQLInputValue[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new StorageError('invalid_usage', 'Exact filters require scalars');
    const path = (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `$.${key}` : `$.${JSON.stringify(key)}`).replaceAll("'", "''");
    const type = value === null ? "= 'null'" : typeof value === 'boolean' ? `= '${value ? 'true' : 'false'}'` : typeof value === 'number' ? "IN ('integer', 'real')" : "= 'text'";
    clauses.push(`json_type(data, '${path}') ${type} AND json_extract(data, '${path}') IS ?`);
    values.push(typeof value === 'boolean' ? Number(value) : value);
  }
  return { sql: clauses.join(' AND ') || '1', values };
}

function sqliteError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_SQLITE_ERROR') {
    const primaryCode = Number('errcode' in error ? error.errcode : 0) & 0xff;
    if (primaryCode === 19) return new StorageError('constraint', 'Storage constraint rejected the change', { cause: error });
    if (primaryCode === 5 || primaryCode === 6) return new StorageError('busy', 'Storage is busy; retry the same operation', { cause: error });
    return new StorageError('invalid_usage', 'Database operation failed', { cause: error });
  }
  return error;
}

function checkedJson(value: unknown, ancestors = new Set<unknown>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new StorageError('invalid_usage', 'Expected JSON data');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) throw new StorageError('invalid_usage', 'Expected a plain JSON object');
  ancestors.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) checkedJson(entry, ancestors);
  ancestors.delete(value);
}

function objectJson(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('invalid_usage', 'Expected a JSON object');
  }
  checkedJson(value);
  return JSON.stringify(value);
}

function checkId(id: string): void {
  if (typeof id !== 'string' || !id.length) throw new StorageError('invalid_usage', 'Expected a nonempty row ID');
}

function checkVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new StorageError('invalid_usage', 'Expected a positive safe version');
}

function assertSynchronous<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') &&
      typeof (value as { then?: unknown }).then === 'function') {
    // Observe rejection from an accidental async callback, without allowing it to commit.
    void Promise.resolve(value).catch(() => undefined);
    throw new StorageError('invalid_usage', 'Storage callbacks must be synchronous');
  }
  return value;
}

function decode<T extends JsonObject>(row: Record<string, unknown>): StoredRow<T> {
  return { id: row.id as string, version: row.version as number, data: JSON.parse(row.data as string) as T };
}

export class SqliteStore implements M1Store {
  readonly instanceId: string;
  readonly recoveryEpoch: string;
  readonly #database: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #activeScope = false;
  #closed = false;

  constructor(options: OpenM1StoreOptions) {
    const timeout = options.busyTimeoutMs ?? 250;
    if (typeof options.databasePath !== 'string' || !options.databasePath.length ||
        typeof options.instanceId !== 'string' || !options.instanceId.length ||
        typeof options.recoveryEpoch !== 'string' || !options.recoveryEpoch.length ||
        !Number.isSafeInteger(timeout) || timeout < 0) {
      throw new StorageError('invalid_usage', 'Invalid SQLite store options');
    }
    this.instanceId = options.instanceId;
    this.recoveryEpoch = options.recoveryEpoch;
    try {
      this.#database = new DatabaseSync(options.databasePath, {
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        timeout,
      });
    } catch (error) {
      throw sqliteError(error);
    }
    try {
      this.#database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      migrateDatabase(this.#database);
      this.#database.exec('BEGIN IMMEDIATE');
      try {
        const existing = this.#database.prepare('SELECT instance_id FROM instance_state WHERE singleton = 1').get();
        if (existing && existing.instance_id !== this.instanceId) {
          throw new StorageError('conflict', 'Database belongs to another instance');
        }
        if (!existing) {
          this.#database.prepare('INSERT INTO instance_state(singleton, instance_id, recovery_epoch) VALUES (1, ?, ?)')
            .run(this.instanceId, this.recoveryEpoch);
        } else {
          // The caller supplies the authority boundary; this is only its persisted configuration.
          this.#database.prepare('UPDATE instance_state SET recovery_epoch = ? WHERE singleton = 1')
            .run(this.recoveryEpoch);
        }
        this.#database.exec('COMMIT');
      } catch (error) {
        if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      this.#database.close();
      throw sqliteError(error);
    }
  }

  read<T>(work: (session: M1ReadSession) => T): T {
    return this.#scope(false, work);
  }

  transaction<T>(work: (session: M1Transaction) => T): T {
    return this.#scope(true, work);
  }

  close(): void {
    if (this.#activeScope) throw new StorageError('invalid_usage', 'Cannot close an active storage scope');
    if (!this.#closed) {
      this.#database.close();
      this.#statements.clear();
      this.#closed = true;
    }
  }

  #statement(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.#database.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  #run(sql: string, ...parameters: SQLInputValue[]) {
    try { return this.#statement(sql).run(...parameters); } catch (error) { throw sqliteError(error); }
  }

  #get(sql: string, ...parameters: SQLInputValue[]) {
    try { return this.#statement(sql).get(...parameters); } catch (error) { throw sqliteError(error); }
  }

  #all(sql: string, ...parameters: SQLInputValue[]) {
    try { return this.#statement(sql).all(...parameters); } catch (error) { throw sqliteError(error); }
  }

  #scope<T>(write: boolean, work: (session: M1Transaction) => T): T {
    if (this.#closed) throw new StorageError('closed', 'Storage is closed');
    if (this.#activeScope) throw new StorageError('invalid_usage', 'Nested storage scopes are unsupported');
    if (typeof work !== 'function') throw new StorageError('invalid_usage', 'Expected a storage callback');
    this.#activeScope = true;
    let usable = true;
    const tableName = (table: M1Table): string => {
      if (!usable) throw new StorageError('closed', 'Storage session is no longer active');
      if (!tableNames.has(table)) throw new StorageError('invalid_usage', 'Unknown storage table');
      return table;
    };
    const session: M1Transaction = {
      get: <T extends JsonObject = JsonObject>(table: M1Table, id: string) => {
        const name = tableName(table);
        checkId(id);
        const row = this.#get(`SELECT id, version, data FROM ${name} WHERE id = ?`, id);
        return row ? decode<T>(row) : undefined;
      },
      find: <T extends JsonObject = JsonObject>(table: M1Table, filters: ExactFilters = {}) => {
        const name = tableName(table);
        const normalized = JSON.parse(objectJson(filters)) as JsonObject;
        if (Object.values(normalized).some((value) => typeof value === 'object' && value !== null)) {
          throw new StorageError('invalid_usage', 'Exact filters require scalar JSON values');
        }
        // Exact top-level JSON matching avoids interpolating client field names into SQL.
        return this.#all(`SELECT id, version, data FROM ${name} ORDER BY id`)
          .map((row) => decode<T>(row)).filter((row) => Object.entries(normalized).every(([key, value]) =>
            Object.hasOwn(row.data, key) && isDeepStrictEqual(row.data[key], value)));
      },
      scan: <T extends JsonObject = JsonObject>(table: M1Table, filters: ExactFilters, options: { limit: number; afterId?: string }) => {
        const name = tableName(table), where = filterSql(filters);
        boundedLimit(options.limit);
        if (options.afterId !== undefined && typeof options.afterId !== 'string') throw new StorageError('invalid_usage', 'Invalid keyset position');
        return this.#all(`SELECT id, version, data FROM ${name} WHERE ${where.sql} AND id > ? ORDER BY id LIMIT ?`,
          ...where.values, options.afterId ?? '', options.limit).map(row => decode<T>(row));
      },
      count: (table, filters, limit) => {
        const name = tableName(table), where = filterSql(filters); boundedLimit(limit);
        return Number(this.#get(`SELECT count(*) AS total FROM (SELECT 1 FROM ${name} WHERE ${where.sql} LIMIT ?)`, ...where.values, limit)?.total ?? 0);
      },
      insert: (table, row) => {
        const name = tableName(table);
        if (!write) throw new StorageError('invalid_usage', 'Read sessions cannot write');
        checkId(row.id);
        checkVersion(row.version);
        this.#run(`INSERT INTO ${name}(id, version, data) VALUES (?, ?, ?)`,
          row.id, row.version, objectJson(row.data),
        );
      },
      update: (table, row, expectedVersion) => {
        const name = tableName(table);
        if (!write) throw new StorageError('invalid_usage', 'Read sessions cannot write');
        checkId(row.id);
        checkVersion(expectedVersion);
        checkVersion(row.version);
        if (row.version !== expectedVersion + 1) throw new StorageError('invalid_usage', 'Update must advance one version');
        const result = this.#run(`UPDATE ${name} SET version = ?, data = ? WHERE id = ? AND version = ?`,
          row.version, objectJson(row.data), row.id, expectedVersion,
        );
        return result.changes === 1;
      },
      remove: (table, id, expectedVersion) => {
        const name = tableName(table);
        if (!write) throw new StorageError('invalid_usage', 'Read sessions cannot write');
        checkId(id); checkVersion(expectedVersion);
        return this.#run(`DELETE FROM ${name} WHERE id = ? AND version = ?`, id, expectedVersion).changes === 1;
      },
    };
    try {
      this.#database.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      const instance = this.#get('SELECT instance_id, recovery_epoch FROM instance_state WHERE singleton = 1');
      if (!instance || instance.instance_id !== this.instanceId || instance.recovery_epoch !== this.recoveryEpoch) {
        throw new StorageError('conflict', 'Store instance or recovery epoch changed; reopen with current configuration');
      }
      const exposed = write ? session : { get: session.get, find: session.find, scan: session.scan, count: session.count };
      const result = assertSynchronous(work(exposed as M1Transaction));
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw sqliteError(error);
    } finally {
      usable = false;
      this.#activeScope = false;
    }
  }
}

export function openM1Store(options: OpenM1StoreOptions): M1Store {
  return new SqliteStore(options);
}
