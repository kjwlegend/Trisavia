/** The deliberately small persistence port for the first M1 backend candidate. */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export const M1_TABLES = [
  'agents', 'owners', 'credentials', 'bindings', 'registrations',
  'profiles', 'memberships', 'operations', 'facts', 'recovery_requests',
] as const;
export type M1Table = (typeof M1_TABLES)[number];

export interface StoredRow<T extends JsonObject = JsonObject> {
  id: string;
  version: number;
  data: T;
}
export type ExactFilters = Record<string, string | number | boolean | null>;

export interface M1ReadSession {
  get<T extends JsonObject = JsonObject>(table: M1Table, id: string): StoredRow<T> | undefined;
  find<T extends JsonObject = JsonObject>(table: M1Table, filters?: ExactFilters): StoredRow<T>[];
}
export interface M1Transaction extends M1ReadSession {
  insert(table: M1Table, row: StoredRow): void;
  /** row.version must equal expectedVersion + 1; false means the old version did not match. */
  update(table: M1Table, row: StoredRow, expectedVersion: number): boolean;
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
export type StorageErrorCode = 'constraint' | 'conflict' | 'busy' | 'closed' | 'invalid_usage';
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}
