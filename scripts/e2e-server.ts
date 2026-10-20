import { buildApp } from '../apps/platform/app.ts';
import { loadEmailConfig } from '../apps/platform/infrastructure/email/resend.ts';
import { postgresFixture } from '../tests/api/postgresql-fixture.ts';

// Reuse the formal PG fixture; never inherit a user's application URL/identity.
const port = Number(process.env.M1_E2E_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [8789, 8799, 8801, 8787, 8846, 8897, 18892, 15432].includes(port)) throw new Error('An explicit disposable loopback E2E port is required');
const pg = await postgresFixture(), email = loadEmailConfig({ M1_EMAIL_MODE: 'experience' });
let app: Awaited<ReturnType<typeof buildApp>> | undefined, closing: Promise<void> | undefined;
function close(): Promise<void> {
  return closing ??= (async () => { try { await app?.close(); } finally { await pg.dispose(); } })();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void close().catch(() => { process.exitCode = 1; }); });
try {
  app = await buildApp({ ...pg.options, ...(email ? { email } : {}) });
  const origin = await app.listen({ host: '127.0.0.1', port });
  console.log(JSON.stringify({ kind: 'isolated_e2e_ready', origin, database: new URL(pg.options.connectionString).pathname.slice(1) }));
} catch {
  await close(); console.error('Isolated PostgreSQL browser test service could not start.'); process.exitCode = 1;
}
