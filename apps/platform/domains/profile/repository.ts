import type { JsonObject, M1ReadSession, StoredRow } from '../../contracts/store.ts';
import { writeRows, type Scalar, type Page } from '../common/repository.ts';
/** profile owns profiles; callers choose named queries, never table names or free filters. */
export function profileRepository(session: M1ReadSession) {
    return {
        get: async <T extends JsonObject = JsonObject>(id: string) => await session.get<T>('profiles', id),
        insert: async (row: StoredRow) => await writeRows(session).insert('profiles', row),
        replace: async (row: StoredRow, expectedVersion: number) => await writeRows(session).update('profiles', row, expectedVersion),
        pageAll: async <T extends JsonObject = JsonObject>(options: Page) => await session.scan<T>('profiles', {}, options),
    };
}
