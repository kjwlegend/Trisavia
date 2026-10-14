import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A fresh database for browser tests, never the user's persistent local instance.
const directory = mkdtempSync(join(tmpdir(), 'agents-era-e2e-'));
const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/platform/server.ts', import.meta.url))], {
  env: {
    ...process.env, M1_HOST: '127.0.0.1', M1_PORT: '8897',
    M1_DATABASE_PATH: join(directory, 'test.sqlite'),
    M1_IDENTITY_PATH: join(directory, 'identity.json'),
    M1_INSTANCE_ID: 'm1-e2e', M1_RECOVERY_EPOCH: 'm1-e2e-epoch',
  },
  stdio: 'inherit',
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { child.kill(signal); });
child.once('error', () => {
  rmSync(directory, { recursive: true, force: true });
  console.error('Browser test service could not start.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
