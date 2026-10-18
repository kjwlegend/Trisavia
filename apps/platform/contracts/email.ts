export type EmailMode = 'experience' | 'resend';
/** Server-only configuration. Never serialize credentials in results or logs. */
export interface ResendEmailConfig { apiKey: string; from: string; publicOrigin: string; codeSecret: string }
export interface EmailConfig { mode: EmailMode; resend?: ResendEmailConfig }
export interface MailPayload { from: string; to: string[]; subject: string; text: string }
export type Delivery = { state: 'accepted'; providerId: string | null } | { state: 'unknown' | 'failed'; retryable: boolean };
