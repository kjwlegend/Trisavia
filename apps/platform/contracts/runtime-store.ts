import type { JsonObject } from './store.ts';

export type RuntimeSource = 'external_agent' | 'rules' | 'owner' | 'system';
export interface RuntimeActor { kind: 'agent' | 'owner' | 'system'; id: string }
export interface CommandKey {
  domain: string; action: string; commandId: string; principal: RuntimeActor; recoveryEpoch: string;
}
export interface CommandReceipt {
  key: CommandKey; requestHash: string; outcome: 'committed' | 'rejected' | 'conflict' | 'expired';
  result: JsonObject; eventIds: string[]; committedAt: number;
}
export interface CommandReceiptReader { get(key: CommandKey): Promise<CommandReceipt | undefined> }
export interface CommandReceiptRepository extends CommandReceiptReader { insert(receipt: CommandReceipt): Promise<void> }

export interface RuntimeEventDraft {
  eventId: string; domain: string; kind: string; schemaVersion: number;
  subject: { type: string; id: string; version: number }; worldId?: string;
  actor: RuntimeActor; source: RuntimeSource; occurredAt: number;
  causationId: string; correlationId: string;
  audience: { kind: 'public' | 'agents' | 'private'; agentIds: string[] };
  /** Versioned fact details and references; domains own private-content retention. */
  payload: JsonObject;
}
export interface RuntimeEvent extends RuntimeEventDraft { position: number; committedAt: number }
export interface RuntimeEventReader {
  get(eventId: string): Promise<RuntimeEvent | undefined>;
  /** Internal ordered facts, never a public all-platform incremental checkpoint. */
  list(input: { domain?: string; subjectId?: string; worldId?: string; afterPosition?: number; limit: number }): Promise<RuntimeEvent[]>;
}
export interface RuntimeEventRepository extends RuntimeEventReader { append(event: RuntimeEventDraft): Promise<RuntimeEvent> }

export interface WorkLease {
  id: string; token: string; workerId: string; fence: number; generation: number; expiresAt: number;
}
export type WorkState = 'pending' | 'leased' | 'completed' | 'failed' | 'cancelled';
export interface LeaseClaim {
  now: number; workerId: string; leaseMs: number; limit: number;
}
export interface RuntimeTaskDraft {
  taskId: string; domain: string; kind: string; handlerVersion: number; dedupeKey: string;
  target: { type: string; id: string; version: number };
  timeKind: 'utc'; dueAt: number; generation: number; maxAttempts: number;
  payloadVersion: number; payload: JsonObject;
}
export interface RuntimeTask extends RuntimeTaskDraft {
  version: number; state: WorkState; attempts: number; fence: number; lease: WorkLease | null;
  lastErrorCode: string | null; completedAt: number | null;
}
export interface RuntimeTaskReader {
  get(taskId: string): Promise<RuntimeTask | undefined>;
  list(input: { domain?: string; targetId?: string; state?: WorkState; afterId?: string; limit: number }): Promise<RuntimeTask[]>;
  currentGeneration(domain: string): Promise<number>;
}
export interface RuntimeTaskRepository extends RuntimeTaskReader {
  /** Explicit lifecycle operation. expected=0 initializes a new domain at 1. */
  advanceGeneration(domain: string, expected: number): Promise<number>;
  schedule(task: RuntimeTaskDraft): Promise<RuntimeTask>;
  claimDue(input: LeaseClaim & { kinds?: string[] }): Promise<RuntimeTask[]>;
  assertLease(lease: WorkLease, now: number): Promise<RuntimeTask>;
  complete(lease: WorkLease, now: number): Promise<void>;
  retry(lease: WorkLease, input: { now: number; dueAt: number; errorCode: string }): Promise<void>;
  cancel(taskId: string, expectedVersion: number, now: number): Promise<boolean>;
}

export interface OutboxDraft {
  outboxId: string; eventId: string; consumerId: string; dedupeKey: string;
  generation: number; dueAt: number; maxAttempts: number;
}
export interface OutboxEntry extends OutboxDraft {
  version: number; state: WorkState; attempts: number; fence: number; lease: WorkLease | null;
  lastErrorCode: string | null; completedAt: number | null;
}
export interface OutboxReader {
  get(outboxId: string): Promise<OutboxEntry | undefined>;
  list(input: { consumerId?: string; state?: WorkState; afterId?: string; limit: number }): Promise<OutboxEntry[]>;
}
export interface OutboxRepository extends OutboxReader {
  enqueue(entry: OutboxDraft): Promise<OutboxEntry>;
  claimDue(input: LeaseClaim & { consumerId: string }): Promise<OutboxEntry[]>;
  assertLease(lease: WorkLease, now: number): Promise<OutboxEntry>;
  /** Delivery completion is neither an Agent content confirmation nor business acceptance. */
  complete(lease: WorkLease, now: number): Promise<void>;
  retry(lease: WorkLease, input: { now: number; dueAt: number; errorCode: string }): Promise<void>;
  cancel(outboxId: string, expectedVersion: number, now: number): Promise<boolean>;
}

declare const repositoryTypes: unique symbol;
/** Domain owners declare a typed port; only infrastructure registers its same-client adapter. */
export interface RuntimeRepositoryPort<Reader, Writer extends Reader = Reader> {
  readonly name: string;
  readonly [repositoryTypes]?: { reader: Reader; writer: Writer };
}
export function defineRuntimeRepository<Reader, Writer extends Reader = Reader>(name: string): RuntimeRepositoryPort<Reader, Writer> {
  if (!/^[a-z][a-z0-9_.-]{0,95}$/.test(name)) throw new TypeError('Invalid runtime repository name');
  return Object.freeze({ name });
}
export interface RuntimeReadContext {
  readonly instanceId: string; readonly recoveryEpoch: string;
  now(): number;
  repository<R, W extends R>(port: RuntimeRepositoryPort<R, W>): R;
  readonly commands: CommandReceiptReader; readonly events: RuntimeEventReader;
  readonly tasks: RuntimeTaskReader; readonly outbox: OutboxReader;
}
export interface RuntimeTransaction extends RuntimeReadContext {
  repository<R, W extends R>(port: RuntimeRepositoryPort<R, W>): W;
  readonly commands: CommandReceiptRepository; readonly events: RuntimeEventRepository;
  readonly tasks: RuntimeTaskRepository; readonly outbox: OutboxRepository;
}
export interface RuntimeStore {
  readonly instanceId: string; readonly recoveryEpoch: string;
  read<T>(work: (context: RuntimeReadContext) => Promise<T>): Promise<T>;
  transaction<T>(work: (context: RuntimeTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
/** Cross-domain target submission participates in its caller's transaction. No nested transaction or network. */
export interface RuntimeCommandParticipant<Input, Output extends JsonObject = JsonObject> {
  readonly domain: string; readonly action: string;
  execute(context: RuntimeTransaction, key: CommandKey, input: Input): Promise<Output>;
}
export type RuntimeErrorCode = 'command_conflict' | 'version_conflict' | 'lease_lost' | 'invalid_usage' | 'task_failed';
export class RuntimeError extends Error {
  constructor(readonly code: RuntimeErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = 'RuntimeError'; }
}
