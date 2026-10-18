import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto';
import type { MailPayload } from '../../contracts/email.ts';
export const emailCode = () => randomInt(0, 100_000_000).toString().padStart(8, '0');
export function emailDigest(secret: string, ...parts: string[]): string {
  return createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
}
function key(secret: string): Buffer { return Buffer.from(emailDigest(secret, 'mail-intent-encryption-v1'), 'hex'); }
/** An unknown delivery must retain exactly its original body without retaining a plaintext code. */
export function sealMail(secret: string, payload: MailPayload): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}
export function openMail(secret: string, sealed: string): MailPayload {
  const parts = sealed.split('.'); if (parts.length !== 3) throw new Error('Invalid durable mail intent');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(parts[0]!, 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[1]!, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString('utf8')) as MailPayload;
}
