/** Server-only configuration. Never serialize this object in results or logs. */
export interface EmailConfig { apiKey: string; from: string; publicOrigin: string; codeSecret: string }
export interface MailPayload { from: string; to: string[]; subject: string; text: string }
export type Delivery = { state: 'accepted'; providerId: string | null } | { state: 'unknown' | 'failed'; retryable: boolean };
