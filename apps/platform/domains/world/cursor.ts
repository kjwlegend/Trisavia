import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fail } from '../common/errors.ts';
interface Scope { instanceId: string; recoveryEpoch: string; worldId: string; agentId: string; limit: number }
/** Private per-service authenticated cursor. It contains no client-decodable Agent ID and expires on restart. */
export function createWorldCursor() {
  const secret = randomBytes(32);
  function aad(scope: Scope): Buffer { return Buffer.from(JSON.stringify([1, scope.instanceId, scope.recoveryEpoch, scope.worldId, scope.agentId, scope.limit])); }
  return {
    encode(afterAgentId: string, scope: Scope, now: number): string {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(aad(scope));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ afterAgentId, issuedAt: now, expiresAt: now + 300_000 }), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    },
    decode(token: string, scope: Scope, now: number): string {
      try {
        if (token.length > 2048 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Malformed');
        const parts = token.split('.'), iv = Buffer.from(parts[1]!, 'base64url'), tag = Buffer.from(parts[3]!, 'base64url');
        if (iv.length !== 12 || tag.length !== 16) throw new Error('Malformed');
        const cipher = createDecipheriv('aes-256-gcm', secret, iv); cipher.setAAD(aad(scope)); cipher.setAuthTag(tag);
        const body: unknown = JSON.parse(Buffer.concat([cipher.update(Buffer.from(parts[2]!, 'base64url')), cipher.final()]).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Malformed');
        const value = body as Record<string, unknown>;
        if (Object.keys(value).some(key => !['afterAgentId', 'issuedAt', 'expiresAt'].includes(key)) || typeof value.afterAgentId !== 'string'
          || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || now < (value.issuedAt as number) || now >= (value.expiresAt as number)) throw new Error('Expired');
        return value.afterAgentId;
      } catch { fail('world_cursor_invalid', 409, 'World cursor is no longer valid; start a new scene query'); }
    },
  };
}
