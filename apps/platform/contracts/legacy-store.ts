/** Frozen synchronous port for offline SQLite conversion and historical baseline tooling only. */
import type { ExactFilters, JsonObject, M1Table, StoredRow } from './store.ts';
export { M1_TABLES, StorageError } from './store.ts';
export type { JsonValue, JsonObject, StoredRow, M1Table, ExactFilters, StorageErrorCode } from './store.ts';

export interface M1ReadSession {
  get<T extends JsonObject = JsonObject>(table: M1Table, id: string): StoredRow<T> | undefined;
  find<T extends JsonObject = JsonObject>(table: M1Table, filters?: ExactFilters): StoredRow<T>[];
  /** Bounded, indexed keyset reads; unlike legacy find, filtering happens in SQLite. */
  scan<T extends JsonObject = JsonObject>(table: M1Table, filters: ExactFilters, options: { limit: number; afterId?: string }): StoredRow<T>[];
  count(table: M1Table, filters: ExactFilters, limit: number): number;
}
export interface M1Transaction extends M1ReadSession {
  insert(table: M1Table, row: StoredRow): void;
  /** row.version must equal expectedVersion + 1; false means the old version did not match. */
  update(table: M1Table, row: StoredRow, expectedVersion: number): boolean;
  remove(table: M1Table, id: string, expectedVersion: number): boolean;
}
export interface M1Store {
  readonly instanceId: string;
  readonly recoveryEpoch: string;
  /** Callbacks are synchronous. A promise/thenable callback must be rejected. */
  read<T>(work: (session: M1ReadSession) => T): T;
  transaction<T>(work: (session: M1Transaction) => T): T;
  close(): void;
}
export interface OpenM1StoreOptions {
  databasePath: string;
  instanceId: string;
  recoveryEpoch: string;
  busyTimeoutMs?: number;
}
