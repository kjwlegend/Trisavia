import type { JsonObject, M1Transaction, StoredRow } from '../../contracts/store.ts';
import { fail } from '../common/errors.ts';
export function meteredRead(tx: M1Transaction, limits: {
        maxScannedRows: number;
        deadlineMs: number;
    }, prepared?: {
        started: number;
        sourceRow?: StoredRow;
    }) {
        const started = prepared?.started ?? Date.now(), cache = new Map<string, StoredRow | undefined>();
        let scanned = prepared ? 1 : 0;
        // A designated detail object consumes one logical row; cache its physical source for duplicate references.
        if (prepared?.sourceRow)
            cache.set(`perception_objects:${prepared.sourceRow.id}`, prepared.sourceRow);
        const tracked = new Set(['profiles', 'memberships', 'perception_objects', 'perception_grants', 'perception_states', 'mailbox_messages', 'mailbox_receipts']);
        const check = () => {
            if (Date.now() - started > limits.deadlineMs)
                fail('budget_too_small', 422, 'Read preparation exceeded the deadline');
        };
        const reserve = (count: number) => {
            check();
            if (scanned + count > limits.maxScannedRows)
                fail('budget_too_small', 422, 'Read source row budget is exhausted');
        };
        const reader: M1Transaction = {
            get: async <T extends JsonObject>(table: Parameters<M1Transaction['get']>[0], id: string) => {
                check();
                if (!tracked.has(table))
                    return await tx.get<T>(table, id);
                const ck = `${table}:${id}`;
                if (cache.has(ck))
                    return cache.get(ck) as StoredRow<T> | undefined;
                reserve(1);
                const row = await tx.get<T>(table, id);
                scanned++;
                cache.set(ck, row);
                check();
                return row;
            },
            scan: async <T extends JsonObject>(table: Parameters<M1Transaction['scan']>[0], filters: Parameters<M1Transaction['scan']>[1], options: Parameters<M1Transaction['scan']>[2]) => {
                check();
                if (!tracked.has(table))
                    return await tx.scan<T>(table, filters, options);
                if (scanned >= limits.maxScannedRows)
                    fail('budget_too_small', 422, 'Read source row budget is exhausted');
                // Never issue a source scan whose permitted result size exceeds what remains.
                const limit = Math.min(options.limit, limits.maxScannedRows - scanned), rows = await tx.scan<T>(table, filters, { ...options, limit });
                scanned += rows.length;
                for (const row of rows)
                    cache.set(`${table}:${row.id}`, row);
                check();
                // A clamped full page cannot prove exhaustion for the original scan request.
                if (limit < options.limit && rows.length === limit)
                    fail('budget_too_small', 422, 'Read source row budget cannot prove selection completion');
                return rows;
            },
            find: tx.find.bind(tx), count: tx.count.bind(tx), insert: tx.insert.bind(tx), update: tx.update.bind(tx), remove: tx.remove.bind(tx),
        };
        return { reader, check };
    }
