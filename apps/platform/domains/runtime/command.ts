import { createHash } from 'node:crypto';
import { RuntimeError, type CommandKey, type CommandReceipt, type RuntimeTransaction } from '../../contracts/runtime-store.ts';
import type { JsonObject, JsonValue } from '../../contracts/store.ts';

export interface CommandResult {
  outcome?: CommandReceipt['outcome']; result: JsonObject; eventIds: string[];
}
export interface CommandRejection { outcome: 'rejected' | 'conflict' | 'expired'; result: JsonObject }
export interface RuntimeCommandOptions {
  key: CommandKey; requestHash: string;
  /** Runs even for replay. Must recheck current authentication and result visibility. */
  authorize(context: RuntimeTransaction): Promise<void>;
  handle(context: RuntimeTransaction): Promise<CommandResult>;
  /** Only known business errors. Unclassified errors roll back the whole transaction. */
  classifyRejection?(error: unknown): CommandRejection | undefined;
}

function canonical(value: JsonValue, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new RuntimeError('invalid_usage', 'Expected finite, acyclic JSON');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return '[' + value.map(item => canonical(item, ancestors)).join(',') + ']';
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new RuntimeError('invalid_usage', 'Expected a JSON object');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key]!, ancestors)).join(',') + '}';
  } finally { ancestors.delete(value); }
}

/** Hash a validated, normalized request; raw private request bodies are not copied into audit facts. */
export function hashRuntimeRequest(request: JsonObject): string {
  return createHash('sha256').update(canonical(request, new Set())).digest('hex');
}

/** Caller owns the outer transaction. Target-domain participants reuse this context. */
export async function commitRuntimeCommandIn(context: RuntimeTransaction, options: RuntimeCommandOptions): Promise<CommandReceipt> {
  const { key, requestHash } = options;
  if (key.recoveryEpoch !== context.recoveryEpoch || !/^[a-f0-9]{64}$/.test(requestHash)) throw new RuntimeError('invalid_usage', 'Invalid command deployment or request digest');
  await options.authorize(context);
  const prior = await context.commands.get(key);
  if (prior) {
    if (prior.requestHash !== requestHash) throw new RuntimeError('command_conflict', 'Command identity already has a different request');
    return structuredClone(prior);
  }
  let result: CommandResult;
  try { result = await context.attempt(options.handle); }
  catch (error) {
    const rejected = options.classifyRejection?.(error);
    if (!rejected) throw error;
    result = { ...rejected, eventIds: [] };
  }
  canonical(result.result, new Set());
  if (!Array.isArray(result.eventIds) || result.eventIds.some(id => typeof id !== 'string' || !id.length) || new Set(result.eventIds).size !== result.eventIds.length) throw new RuntimeError('invalid_usage', 'Invalid command event references');
  const receipt: CommandReceipt = { key: structuredClone(key), requestHash, outcome: result.outcome ?? 'committed', result: structuredClone(result.result), eventIds: [...result.eventIds], committedAt: context.now() };
  await context.commands.insert(receipt);
  return structuredClone(receipt);
}
