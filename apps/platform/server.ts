import { buildApp } from './app.ts';
import { loadBackendConfig } from './configuration/backend-config.ts';

async function main(): Promise<void> {
  const config = loadBackendConfig();
  const app = buildApp(config);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(`M1 backend listening at ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void main().catch(() => {
  // Never print arbitrary errors containing request material, credentials or a database dump.
  console.error('M1 backend startup failed; check local configuration and instance metadata.');
  process.exitCode = 1;
});
