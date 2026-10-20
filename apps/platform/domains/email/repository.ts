import type { JsonObject, M1ReadSession, StoredRow } from '../../contracts/store.ts';
import { writeRows, type Scalar, type Page } from '../common/repository.ts';
/** email owns mail_jobs; callers choose named queries, never table names or free filters. */
export function mailJobRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('mail_jobs', id),
        findByPurpose: async <T extends JsonObject = JsonObject>(purpose: Scalar) => await session.find<T>('mail_jobs', { purpose }),
        insert: async (row: StoredRow) => await writeRows(session).insert('mail_jobs', row),
        findByOperationIdAndOwnerKeyAndPurpose: async <T extends JsonObject = JsonObject>(operationId: Scalar, ownerKey: Scalar, purpose: Scalar) => await session.find<T>('mail_jobs', { operationId, ownerKey, purpose }),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('mail_jobs', row, expectedVersion),
    };
}
