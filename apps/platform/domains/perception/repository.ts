import type { JsonObject, M1ReadSession, StoredRow } from '../../contracts/store.ts';
import { writeRows, type Scalar, type Page } from '../common/repository.ts';
/** Read projection over legacy reference aliases. PostgreSQL resolves each object to its authoritative source domain. */
export function contentRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_objects', id),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('perception_objects', row, expectedVersion),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_objects', row),
        pageByCategoryId: async <T extends JsonObject = JsonObject>(categoryId: Scalar, options: Page) => await session.scan<T>('perception_objects', { categoryId }, options),
    };
}
/** perception owns perception_grants; callers choose named queries, never table names or free filters. */
export function sourceGrantRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_grants', id),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_grants', row),
        pageByAgentId: async <T extends JsonObject = JsonObject>(agentId: Scalar, options: Page) => await session.scan<T>('perception_grants', { agentId }, options),
        pageByAgentIdAndKind: async <T extends JsonObject = JsonObject>(agentId: Scalar, kind: Scalar, options: Page) => await session.scan<T>('perception_grants', { agentId, kind }, options),
    };
}
/** perception owns perception_states; callers choose named queries, never table names or free filters. */
export function notificationStateRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_states', id),
        countByAgentId: async <T extends JsonObject = JsonObject>(agentId: Scalar, limit: number) => await session.count('perception_states', { agentId }, limit),
        countAll: async <T extends JsonObject = JsonObject>(limit: number) => await session.count('perception_states', {}, limit),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('perception_states', row, expectedVersion),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_states', row),
    };
}
/** perception owns perception_sessions; callers choose named queries, never table names or free filters. */
export function readSessionRepository(session: M1ReadSession) {
    return {
        pageAll: async <T extends JsonObject = JsonObject>(options: Page) => await session.scan<T>('perception_sessions', {}, options),
        remove: async (id: string, expectedVersion: number) => await writeRows(session).remove('perception_sessions', id, expectedVersion),
        countByActorId: async <T extends JsonObject = JsonObject>(actorId: Scalar, limit: number) => await session.count('perception_sessions', { actorId }, limit),
        countAll: async <T extends JsonObject = JsonObject>(limit: number) => await session.count('perception_sessions', {}, limit),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_sessions', row),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_sessions', id),
    };
}
/** perception owns perception_access; callers choose named queries, never table names or free filters. */
export function accessFactRepository(session: M1ReadSession) {
    return {
        pageAll: async <T extends JsonObject = JsonObject>(options: Page) => await session.scan<T>('perception_access', {}, options),
        remove: async (id: string, expectedVersion: number) => await writeRows(session).remove('perception_access', id, expectedVersion),
        countByHumanAudienceOwnerId: async (humanAudienceOwnerId: Scalar, limit: number) => await session.count('perception_access', { humanAudienceOwnerId }, limit),
        countByAgentId: async (agentId: Scalar, limit: number) => await session.count('perception_access', { agentId }, limit),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_access', row),
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_access', id),
        countAll: async <T extends JsonObject = JsonObject>(limit: number) => await session.count('perception_access', {}, limit),
        pageByAgentIdAndHumanAudienceOwnerId: async <T extends JsonObject = JsonObject>(agentId: Scalar, humanAudienceOwnerId: Scalar, options: Page) => await session.scan<T>('perception_access', { agentId, humanAudienceOwnerId }, options),
    };
}
/** perception owns perception_catalog; callers choose named queries, never table names or free filters. */
export function catalogRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('perception_catalog', id),
        countByKind: async <T extends JsonObject = JsonObject>(kind: Scalar, limit: number) => await session.count('perception_catalog', { kind }, limit),
        insert: async (row: StoredRow) => await writeRows(session).insert('perception_catalog', row),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('perception_catalog', row, expectedVersion),
    };
}
