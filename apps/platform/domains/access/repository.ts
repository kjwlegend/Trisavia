import type { JsonObject, M1ReadSession, StoredRow } from '../../contracts/store.ts';
import { writeRows, type Scalar, type Page } from '../common/repository.ts';
/** access owns agents; callers choose named queries, never table names or free filters. */
export function agentRepository(session: M1ReadSession) {
    return {
        countAll: async (limit: number) => await session.count('agents', {}, limit),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('agents', row, expectedVersion),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('agents', id),
        findAll: async <T extends JsonObject = JsonObject>() => await session.find<T>('agents', {}),
        insert: async (row: StoredRow) => await writeRows(session).insert('agents', row),
        pageAll: async <T extends JsonObject = JsonObject>(options: Page) => await session.scan<T>('agents', {}, options),
    };
}
/** access owns owners; callers choose named queries, never table names or free filters. */
export function humanAccountRepository(session: M1ReadSession) {
    return {
        countAll: async (limit: number) => await session.count('owners', {}, limit),
        existsByUsernameKey: async (usernameKey: string) => await session.count('owners', { usernameKey }, 1) > 0,
        existsByEmailKey: async (emailKey: string) => await session.count('owners', { emailKey }, 1) > 0,
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('owners', id),
        findByUsernameKey: async <T extends JsonObject = JsonObject>(usernameKey: Scalar) => await session.find<T>('owners', { usernameKey }),
        findByEmailKey: async <T extends JsonObject = JsonObject>(emailKey: Scalar) => await session.find<T>('owners', { emailKey }),
        findAll: async <T extends JsonObject = JsonObject>() => await session.find<T>('owners', {}),
        insert: async (row: StoredRow) => await writeRows(session).insert('owners', row),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('owners', row, expectedVersion),
    };
}
/** access owns credentials; callers choose named queries, never table names or free filters. */
export function credentialRepository(session: M1ReadSession) {
    return {
        existsByFingerprint: async (fingerprint: string) => await session.count('credentials', { fingerprint }, 1) > 0,
        countActiveInvites: async (ownerId: string, after: number, limit: number) => await session.quotaCount({ kind: 'active_invites', ownerId, after, limit }),
        findByAgentId: async <T extends JsonObject = JsonObject>(agentId: Scalar) => await session.find<T>('credentials', { agentId }),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('credentials', id),
        findByActiveAndKindAndOwnerId: async <T extends JsonObject = JsonObject>(active: Scalar, kind: Scalar, ownerId: Scalar) => await session.find<T>('credentials', { active, kind, ownerId }),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('credentials', row, expectedVersion),
        findByOwnerId: async <T extends JsonObject = JsonObject>(ownerId: Scalar) => await session.find<T>('credentials', { ownerId }),
        findByActiveAndOwnerId: async <T extends JsonObject = JsonObject>(active: Scalar, ownerId: Scalar) => await session.find<T>('credentials', { active, ownerId }),
        findByFingerprint: async <T extends JsonObject = JsonObject>(fingerprint: Scalar) => await session.find<T>('credentials', { fingerprint }),
        insert: async (row: StoredRow) => await writeRows(session).insert('credentials', row),
        findByKindAndOwnerId: async <T extends JsonObject = JsonObject>(kind: Scalar, ownerId: Scalar) => await session.find<T>('credentials', { kind, ownerId }),
    };
}
/** access owns bindings; callers choose named queries, never table names or free filters. */
export function managementBindingRepository(session: M1ReadSession) {
    return {
        countActiveByOwnerId: async (ownerId: string, limit: number) => await session.count('bindings', { active: true, ownerId }, limit),
        existsActiveByAgentId: async (agentId: string) => await session.count('bindings', { active: true, agentId }, 1) > 0,
        existsActiveByAgentIdAndOwnerId: async (agentId: string, ownerId: string) => await session.count('bindings', { active: true, agentId, ownerId }, 1) > 0,
        findByActiveAndAgentId: async <T extends JsonObject = JsonObject>(active: Scalar, agentId: Scalar) => await session.find<T>('bindings', { active, agentId }),
        insert: async (row: StoredRow) => await writeRows(session).insert('bindings', row),
        findByActiveAndAgentIdAndOwnerId: async <T extends JsonObject = JsonObject>(active: Scalar, agentId: Scalar, ownerId: Scalar) => await session.find<T>('bindings', { active, agentId, ownerId }),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('bindings', id),
        findByActiveAndOwnerId: async <T extends JsonObject = JsonObject>(active: Scalar, ownerId: Scalar) => await session.find<T>('bindings', { active, ownerId }),
        pageByActiveAndAgentIdAndOwnerId: async <T extends JsonObject = JsonObject>(active: Scalar, agentId: Scalar, ownerId: Scalar, options: Page) => await session.scan<T>('bindings', { active, agentId, ownerId }, options),
        pageByActiveAndAgentId: async <T extends JsonObject = JsonObject>(active: Scalar, agentId: Scalar, options: Page) => await session.scan<T>('bindings', { active, agentId }, options),
    };
}
/** access owns registrations; callers choose named queries, never table names or free filters. */
export function registrationRepository(session: M1ReadSession) {
    return {
        findByAgentId: async <T extends JsonObject = JsonObject>(agentId: Scalar) => await session.find<T>('registrations', { agentId }),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('registrations', row, expectedVersion),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('registrations', id),
        insert: async (row: StoredRow) => await writeRows(session).insert('registrations', row),
    };
}
/** access owns memberships; callers choose named queries, never table names or free filters. */
export function membershipRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('memberships', id),
        insert: async (row: StoredRow) => await writeRows(session).insert('memberships', row),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('memberships', row, expectedVersion),
    };
}
/** access owns recovery_requests; callers choose named queries, never table names or free filters. */
export function recoveryRequestRepository(session: M1ReadSession) {
    return {
        hasCurrentPending: async (agentId: string, epoch: string, after: number) => await session.quotaCount({ kind: 'pending_recovery', agentId, epoch, after, limit: 1 }) > 0,
        countRecent: async (since: number, limit: number, scope: { ownerId?: string; sourceKey?: string } = {}) => await session.quotaCount({ kind: 'recovery_requests_recent', since, limit, ...scope }),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('recovery_requests', id),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('recovery_requests', row, expectedVersion),
        findByOwnerId: async <T extends JsonObject = JsonObject>(ownerId: Scalar) => await session.find<T>('recovery_requests', { ownerId }),
        findByAgentId: async <T extends JsonObject = JsonObject>(agentId: Scalar) => await session.find<T>('recovery_requests', { agentId }),
        findAll: async <T extends JsonObject = JsonObject>() => await session.find<T>('recovery_requests', {}),
        insert: async (row: StoredRow) => await writeRows(session).insert('recovery_requests', row),
    };
}
/** access owns email_attempts; callers choose named queries, never table names or free filters. */
export function emailAttemptRepository(session: M1ReadSession) {
    return {
        countRecent: async (since: number, limit: number, sourceKeys?: string[]) => await session.quotaCount({ kind: 'email_attempts_recent', since, limit, ...(sourceKeys === undefined ? {} : { sourceKeys }) }),
        existsByRequestId: async (requestId: string) => await session.count('email_attempts', { requestId }, 1) > 0,
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('email_attempts', id),
        findAll: async <T extends JsonObject = JsonObject>() => await session.find<T>('email_attempts', {}),
        insert: async (row: StoredRow) => await writeRows(session).insert('email_attempts', row),
        findByRequestId: async <T extends JsonObject = JsonObject>(requestId: Scalar) => await session.find<T>('email_attempts', { requestId }),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('email_attempts', row, expectedVersion),
    };
}
