import type { JsonObject, M1ReadSession, StoredRow } from '../../contracts/store.ts';
import { writeRows, type Scalar, type Page } from '../common/repository.ts';
/** platform owns operations; callers choose named queries, never table names or free filters. */
export function operationRepository(session: M1ReadSession) {
    return {
        findByActionAndEpochAndOperationIdAndScope: async <T extends JsonObject = JsonObject>(action: Scalar, epoch: Scalar, operationId: Scalar, scope: Scalar) => await session.find<T>('operations', { action, epoch, operationId, scope }),
        insert: async (row: StoredRow) => await writeRows(session).insert('operations', row),
        pageByActionAndEpochAndOperationIdAndScope: async <T extends JsonObject = JsonObject>(action: Scalar, epoch: Scalar, operationId: Scalar, scope: Scalar, options: Page) => await session.scan<T>('operations', { action, epoch, operationId, scope }, options),
        countByAction: async <T extends JsonObject = JsonObject>(action: Scalar, limit: number) => await session.count('operations', { action }, limit),
        countByActionAndScope: async <T extends JsonObject = JsonObject>(action: Scalar, scope: Scalar, limit: number) => await session.count('operations', { action, scope }, limit),
    };
}
/** platform owns facts; callers choose named queries, never table names or free filters. */
export function factRepository(session: M1ReadSession) {
    return {
        insert: async (row: StoredRow) => await writeRows(session).insert('facts', row),
    };
}
