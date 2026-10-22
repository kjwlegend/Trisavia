import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';

const webRoot = fileURLToPath(new URL('../../../web/public/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
};
async function file(reply: FastifyReply, path: string, type: string) {
  try { return reply.type(type).send(await readFile(path)); }
  catch { return reply.code(404).send({ error: { code: 'not_found', message: 'Resource not found' } }); }
}

export function registerSiteRoutes(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return payload;
  });
  for (const [route, name] of [['/', 'index.html'], ['/owner', 'index.html'], ['/residents/:agentId', 'resident.html']] as const) {
    app.get(route, (_request, reply) => file(reply, resolve(webRoot, name), mime['.html']!));
  }
  app.get('/world-map-v2.json', (_request, reply) => file(reply, resolve(webRoot, 'world-map-v2.json'), mime['.json']!));
  app.get('/favicon.ico', (_request, reply) => reply.code(204).send());
  app.get('/assets/*', async (request, reply) => {
    const name = (request.params as { '*': string })['*'];
    const type = mime[extname(name)];
    if (!type || extname(name) === '.html') return reply.code(404).send({ error: { code: 'not_found', message: 'Resource not found' } });
    try {
      const base = await realpath(webRoot);
      const path = await realpath(resolve(base, name));
      if (!path.startsWith(base + sep)) throw new Error('Invalid asset path');
      return file(reply, path, type);
    } catch { return reply.code(404).send({ error: { code: 'not_found', message: 'Resource not found' } }); }
  });
  for (const name of ['entry.md', 'http-api.md', 'local-setup.md', 'prompt.md']) {
    app.get(`/agent/${name}`, (_request, reply) => file(reply, resolve(repoRoot, 'docs/access/v1', name), 'text/markdown; charset=utf-8'));
  }
  app.get('/agent/m1-agent.ts', (_request, reply) => file(reply, resolve(repoRoot, 'scripts/m1-agent.ts'), 'text/plain; charset=utf-8'));
}
