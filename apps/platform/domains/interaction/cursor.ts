import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fail } from '../common/errors.ts';

interface Scope { instanceId: string; recoveryEpoch: string; agentId: string; limit: number }
/** Authenticated private continuation, scoped to this service lifetime and the current caller. Not a snapshot. */
export function createInteractionCursor() {
  const secret = randomBytes(32);
  const aad = (scope: Scope) => Buffer.from(JSON.stringify(['interaction.current', 1, scope.instanceId, scope.recoveryEpoch, scope.agentId, scope.limit]));
  return {
    encode(afterId: string, scope: Scope, now: number): string {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(aad(scope));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ afterId, issuedAt: now, expiresAt: now + 300_000 }), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    },
    decode(token: string, scope: Scope, now: number): string {
      try {
        if (token.length > 2048 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Malformed');
        const parts = token.split('.'), iv = Buffer.from(parts[1]!, 'base64url'), tag = Buffer.from(parts[3]!, 'base64url');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('Malformed');
        const decipher = createDecipheriv('aes-256-gcm', secret, iv); decipher.setAAD(aad(scope)); decipher.setAuthTag(tag);
        const body: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Malformed');
        const value = body as Record<string, unknown>;
        if (Object.keys(value).some(key => !['afterId', 'issuedAt', 'expiresAt'].includes(key)) || typeof value.afterId !== 'string' || value.afterId.length < 1 || value.afterId.length > 128
          || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || now < (value.issuedAt as number) || now >= (value.expiresAt as number)) throw new Error('Expired');
        return value.afterId;
      } catch { fail('interaction_cursor_invalid', 409, 'Interaction cursor is no longer valid; start a new current-items query'); }
    },
  };
}
