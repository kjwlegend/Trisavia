import type { M1Transaction, StoredRow } from '../contracts/store.ts';
import { fail } from '../domains/common/errors.ts';
import { plain } from '../domains/perception/protocol.ts';
import { catalogRepository } from '../domains/perception/repository.ts';

export const OWNER_NOTIFICATION_COLLECTION_QUERY_ID = 'owner-collection-query:direct-mail:ws02@1';
const sourceReference = 'ws02-notifications-collection-query@1';
const sourceAdministrator = 'platform:mailbox-notifications';
const layers = ['existence', 'summary', 'body', 'attachments'] as const;
/** Versioned source-owned declaration, also published in the exact module guides. */
export const OWNER_NOTIFICATION_COLLECTION_QUERY = Object.freeze({
    id: OWNER_NOTIFICATION_COLLECTION_QUERY_ID, declarationVersion: 1, sourceId: 'direct-mail', sourceReference,
    declaredBy: { moduleId: 'mailbox', sourceAdministrator, version: 1 }, audience: 'current_bound_owner',
    channel: 'inbox', categoryId: 'notifications', operations: ['list'], subject: 'currently-bound-selected-agent',
    objectIds: [], objectLayersGranted: false, activePolicyRequired: true,
});

export async function ownerNotificationCollectionDeclaration(tx: M1Transaction) {
    const row = await catalogRepository(tx).get(OWNER_NOTIFICATION_COLLECTION_QUERY_ID);
    return row && isQueryOnlyDeclaration(row) ? { ...OWNER_NOTIFICATION_COLLECTION_QUERY, active: row.data.active!, policyVersion: row.version } : undefined;
}

function isQueryOnlyDeclaration(row: StoredRow): boolean {
    return row.data.kind === 'owner_observation_policy' && row.data.sourceId === 'direct-mail' &&
        row.data.sourceReference === sourceReference && row.data.sourceAdministrator === sourceAdministrator &&
        row.data.audience === 'current_bound_owner' && Array.isArray(row.data.objectIds) && row.data.objectIds.length === 0 &&
        layers.every(layer => plain(row.data.layers)[layer] === false) &&
        plain(row.data.declaredBy).kind === 'administrator';
}

/** This source permits querying the currently authorized collection, never any object's existence or content. */
export async function mayQueryOwnerNotifications(tx: M1Transaction): Promise<boolean> {
    const row = await catalogRepository(tx).get(OWNER_NOTIFICATION_COLLECTION_QUERY_ID);
    return !!row && row.data.active === true && isQueryOnlyDeclaration(row);
}

/** Explicit bootstrap/maintenance only. Reuse the typed policy store, with no object IDs or object-layer permissions. */
export async function declareOwnerNotificationCollectionQuery(tx: M1Transaction, actorId: string, stamp: number): Promise<{ created: boolean; policy: StoredRow }> {
    const existing = await catalogRepository(tx).get(OWNER_NOTIFICATION_COLLECTION_QUERY_ID);
    if (existing) {
        if (!isQueryOnlyDeclaration(existing)) fail('version_conflict', 409, 'The notification collection-query declaration differs');
        // Revocation belongs to the source. Publication never revives it.
        return { created: false, policy: existing };
    }
    const policy: StoredRow = { id: OWNER_NOTIFICATION_COLLECTION_QUERY_ID, version: 1, data: {
        kind: 'owner_observation_policy', sourceId: 'direct-mail', sourceReference, sourceAdministrator,
        audience: 'current_bound_owner', objectIds: [], active: true,
        layers: { existence: false, summary: false, body: false, attachments: false },
        declaredBy: { kind: 'administrator', id: actorId }, declaredAt: stamp,
    } };
    await catalogRepository(tx).insert(policy);
    return { created: true, policy };
}
