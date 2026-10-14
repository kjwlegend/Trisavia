/** Small nonvisual test-client utilities. This is not a host compatibility claim. */
import { randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';

export interface AgentMaterial {
  attemptId: string;
  runtimeToken: string;
  continuationToken: string;
}
export interface PrivateAgentState extends AgentMaterial {
  instanceId: string;
  registrationOperationId: string;
  apiVersion: 'v1';
  documentationVersion: 'v1';
}

export function newOperationId(): string {
  return `op_${randomUUID()}`;
}
export function newCredential(label = 'proof'): string {
  return `${label}_${randomUUID()}.${randomBytes(32).toString('base64url')}`;
}
export function newAgentMaterial(): AgentMaterial {
  return {
    attemptId: `attempt_${randomUUID()}`,
    runtimeToken: newCredential('runtime'),
    continuationToken: newCredential('continuation'),
  };
}

/** Exclusive creation prevents an accidental new attempt from replacing recovery state. */
export async function saveNewPrivateState(path: string, state: PrivateAgentState): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({
      instanceId: state.instanceId, apiVersion: state.apiVersion, documentationVersion: state.documentationVersion,
      registrationOperationId: state.registrationOperationId,
      attemptId: state.attemptId, runtimeToken: state.runtimeToken, continuationToken: state.continuationToken,
    }), 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function readPrivateState(path: string): Promise<PrivateAgentState> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Client state must be a private regular file');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Client state could not be decoded');
  }
  if (!value || typeof value !== 'object') throw new Error('Client state is invalid');
  const state = value as Record<string, unknown>;
  if (state.apiVersion !== 'v1' || state.documentationVersion !== 'v1'
      || ['instanceId', 'registrationOperationId', 'attemptId', 'runtimeToken', 'continuationToken'].some(key => typeof state[key] !== 'string')) {
    throw new Error('Client state version or required fields are invalid');
  }
  return {
    instanceId: state.instanceId as string,
    registrationOperationId: state.registrationOperationId as string,
    apiVersion: 'v1', documentationVersion: 'v1',
    attemptId: state.attemptId as string,
    runtimeToken: state.runtimeToken as string,
    continuationToken: state.continuationToken as string,
  };
}

export interface LocalSummaryFacts {
  instanceId: string;
  agentId: string;
  ownerId: string;
  operationId: string;
  managementStatus: 'pending_setup' | 'managed';
  deliveryStatus: 'not_generated' | 'generated' | 'client_declared_delivered';
  localStateReread: boolean;
  profilePublished: boolean;
  membershipState: 'not_joined' | 'joined' | 'left';
}

/** Explicit selection excludes tokens/passwords and never infers owner access or scheduling. */
export function buildLocalSummary(facts: LocalSummaryFacts) {
  return {
    instanceId: facts.instanceId,
    apiVersion: 'v1', documentationVersion: 'v1',
    agentId: facts.agentId, ownerId: facts.ownerId, operationId: facts.operationId,
    registration: 'completed',
    managementStatus: facts.managementStatus,
    deliveryStatus: facts.deliveryStatus,
    local_setup: facts.localStateReread ? 'completed' : 'incomplete',
    profile: facts.profilePublished ? 'published' : 'unpublished',
    membership: facts.membershipState,
    schedule_configuration: 'not_configured',
    periodic_run_verification: 'not_verified',
  } as const;
}
