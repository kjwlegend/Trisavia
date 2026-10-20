import type { JsonObject, M1ReadSession, M1Transaction, StoredRow } from '../../contracts/store.ts';
import { key, type ObjectRef } from '../perception/protocol.ts';
export interface MailboxMessage extends JsonObject {
    messageId: string;
    contentVersion: number;
    sourceId: string;
    sourceMessageKey: string;
    payloadHash: string;
    title: string;
    body: string;
    attachments: JsonObject[];
    sender: JsonObject;
    receivedAt: number;
}
export interface MailboxReceipt extends JsonObject {
    messageId: string;
    messageVersionId: string;
    agentId: string;
    active: boolean;
    receivedAt: number;
    ownerObservation: JsonObject;
    ownerObservationAudience: 'current_bound_owner' | null;
    confirmedContentVersion: number | null;
    confirmedAt: number | null;
    stateVersion: number;
}
export const mailboxMessageId = (sourceId: string, sourceMessageKey: string) => key({ sourceId, sourceMessageKey });
export const mailboxVersionId = (messageId: string, contentVersion: number) => key({ messageId, contentVersion });
export const mailboxReceiptId = (messageId: string, agentId: string) => key({ messageId, agentId });
export const mailboxRef = (messageId: string): ObjectRef => ({ moduleId: 'mailbox', type: 'mailbox.direct-message@1', id: messageId });
/** Optimistic row versions also advance on confirmation; read proofs bind only delivery authority. */
export function mailboxReceiptAuthorizationVersion(row: StoredRow<MailboxReceipt>): string {
    const d = row.data;
    return key({ receiptId: row.id, messageId: d.messageId, messageVersionId: d.messageVersionId, agentId: d.agentId, active: d.active, receivedAt: d.receivedAt, ownerObservation: d.ownerObservation, ownerObservationAudience: d.ownerObservationAudience });
}
/** All original message and delivery/confirmation access goes through this domain repository. */
export function mailboxRepository(session: M1ReadSession) {
    return {
        countVersions: async (limit: number) => await session.count('mailbox_messages', {}, limit),
        countDeliveries: async (limit: number) => await session.count('mailbox_receipts', {}, limit),
        message: async (id: string) => await session.get<MailboxMessage>('mailbox_messages', id),
        receipt: async (messageId: string, agentId: string) => await session.get<MailboxReceipt>('mailbox_receipts', mailboxReceiptId(messageId, agentId)),
        receipts: async (agentId: string, limit: number) => await session.scan<MailboxReceipt>('mailbox_receipts', { agentId }, { limit }),
    };
}
export async function appendMailboxVersion(tx: M1Transaction, row: StoredRow<MailboxMessage>): Promise<void> { await tx.insert('mailbox_messages', row); }
export async function saveMailboxReceipt(tx: M1Transaction, row: StoredRow<MailboxReceipt>, previous?: StoredRow<MailboxReceipt>): Promise<void> {
    if (previous) {
        if (!await tx.update('mailbox_receipts', row, previous.version))
            throw new Error('Mailbox receipt changed');
    }
    else
        await tx.insert('mailbox_receipts', row);
}
