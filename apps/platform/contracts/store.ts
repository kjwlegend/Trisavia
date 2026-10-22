/** Internal asynchronous persistence/codec seam; application use cases access named domain repositories. */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export const M1_TABLES = [
  'agents', 'owners', 'credentials', 'bindings', 'registrations',
  'profiles', 'memberships', 'operations', 'facts', 'recovery_requests', 'email_attempts', 'mail_jobs',
  'wallet_accounts', 'mailbox_messages', 'mailbox_receipts',
  'friendships',
  'perception_objects', 'perception_grants', 'perception_states', 'perception_sessions', 'perception_access', 'perception_catalog',
] as const;
export type M1Table = (typeof M1_TABLES)[number];

export interface StoredRow<T extends JsonObject = JsonObject> {
  id: string;
  version: number;
  data: T;
}
export type ExactFilters = Record<string, string | number | boolean | null>;
/** Internal bounded retention query, accepted only for the matching perception source. */
export interface RetentionCutoff {
  field: 'expiresAt' | 'recordedAt';
  at: number;
  inclusive: boolean;
}
/** Internal fixed domain quota queries. Return at most limit, never source rows or mail payloads. */
export type QuotaCountQuery =
  | { kind: 'email_attempts_recent'; since: number; sourceKeys?: string[]; limit: number }
  | { kind: 'code_mail_recent'; since: number; related?: { ownerKey: string; emailKey: string }; sourceKeys?: string[]; limit: number }
  | { kind: 'recovery_requests_recent'; since: number; ownerId?: string; sourceKey?: string; limit: number }
  | { kind: 'pending_recovery'; agentId: string; epoch: string; after: number; limit: 1 }
  | { kind: 'active_invites'; ownerId: string; after: number; limit: number };

export interface M1ReadSession {
  get<T extends JsonObject = JsonObject>(table: M1Table, id: string): Promise<StoredRow<T> | undefined>;
  find<T extends JsonObject = JsonObject>(table: M1Table, filters?: ExactFilters): Promise<StoredRow<T>[]>;
  /** Bounded keyset reads with source filtering performed by PostgreSQL. */
  scan<T extends JsonObject = JsonObject>(table: M1Table, filters: ExactFilters, options: { limit: number; afterId?: string; cutoff?: RetentionCutoff }): Promise<StoredRow<T>[]>;
  count(table: M1Table, filters: ExactFilters, limit: number): Promise<number>;
  quotaCount(query: QuotaCountQuery): Promise<number>;
}
export interface M1Transaction extends M1ReadSession {
  insert(table: M1Table, row: StoredRow): Promise<void>;
  /** row.version must equal expectedVersion + 1; false means the old version did not match. */
  update(table: M1Table, row: StoredRow, expectedVersion: number): Promise<boolean>;
  remove(table: M1Table, id: string, expectedVersion: number): Promise<boolean>;
}
export interface M1Store {
  readonly instanceId: string;
  readonly recoveryEpoch: string;
  /** Short read-only RR transaction. The callback and every storage operation must be awaited. */
  read<T>(work: (session: M1ReadSession) => Promise<T>): Promise<T>;
  /** Whole callbacks may retry on serialization/deadlock only; never perform external effects inside. */
  transaction<T>(work: (session: M1Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type StorageErrorCode = 'constraint' | 'conflict' | 'busy' | 'closed' | 'invalid_usage' | 'unavailable' | 'unknown_commit';
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}
