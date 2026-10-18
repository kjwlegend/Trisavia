import type { EmailConfig, ResendEmailConfig, MailPayload, Delivery } from '../../contracts/email.ts';
export type { EmailConfig, EmailMode, ResendEmailConfig, MailPayload, Delivery } from '../../contracts/email.ts';

/** Partial or invalid configuration disables only email, never password/backup access. */
function loadResendConfig(env: NodeJS.ProcessEnv): ResendEmailConfig | undefined {
  const apiKey = env.RESEND_API_KEY?.trim(), from = env.M1_EMAIL_FROM?.trim();
  const publicOrigin = env.M1_PUBLIC_ORIGIN?.trim(), codeSecret = env.M1_EMAIL_CODE_SECRET;
  if (!apiKey || !from || !publicOrigin || !codeSecret || Buffer.byteLength(codeSecret) < 32 || /[\r\n]/u.test(from)) return undefined;
  try {
    const url = new URL(publicOrigin);
    if (url.origin !== publicOrigin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) return undefined;
    if (!/^[^<>\s]+@[^<>\s]+$/u.test(from) && !/^[^<>\r\n]+ <[^<>\s]+@[^<>\s]+>$/u.test(from)) return undefined;
  } catch { return undefined; }
  return { apiKey, from, publicOrigin, codeSecret };
}

/** Experience is explicit. An absent mode selects real mail; an unknown mode never enables it. */
export function loadEmailConfig(env: NodeJS.ProcessEnv): EmailConfig | undefined {
  const mode = env.M1_EMAIL_MODE ?? 'resend';
  if (mode !== 'experience' && mode !== 'resend') return undefined;
  const resend = loadResendConfig(env);
  return { mode, ...(resend ? { resend } : {}) };
}

/** One bounded attempt. Only explicit continuation retries the identical durable body/key. */
export async function sendResend(config: ResendEmailConfig, payload: MailPayload, idempotencyKey: string): Promise<Delivery> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const providerId = body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : null;
      return providerId ? { state: 'accepted', providerId } : { state: 'unknown', retryable: true };
    }
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      const name = body && typeof body === 'object' && 'name' in body ? body.name : null;
      return { state: name === 'invalid_idempotent_request' ? 'failed' : 'unknown', retryable: name !== 'invalid_idempotent_request' };
    }
    // A rate response may be a daily quota rather than a short window. Do not loop.
    if (response.status === 429) return { state: 'failed', retryable: false };
    return response.status >= 500 ? { state: 'unknown', retryable: true } : { state: 'failed', retryable: false };
  } catch { return { state: 'unknown', retryable: true }; }
}
