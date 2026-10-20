import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { docker, readRuntime } from '../../scripts/postgresql/runtime.ts';

test('the existing browser server uses a fresh PG target and drains app pools before strict target disposal on SIGTERM', { timeout: 30_000 }, async () => {
  const runtimeFile = process.env.M1_POSTGRES_TEST_RUNTIME; if (!runtimeFile) throw new Error('Explicit isolated PostgreSQL runtime is required');
  const config = await readRuntime(runtimeFile), portProbe = createServer();
  await new Promise<void>((done, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', done); });
  const address = portProbe.address(); assert(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>((done, reject) => portProbe.close(error => error ? reject(error) : done()));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../scripts/e2e-server.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, M1_E2E_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', database = '', closed = false;
  child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  const exited = new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', code => { closed = true; done(code); }); });
  try {
    const deadline = Date.now() + 15_000;
    while (!database && !closed && Date.now() < deadline) {
      for (const line of stdout.split('\n')) { try { const row = JSON.parse(line); if (row.kind === 'isolated_e2e_ready') { assert.equal(row.origin, `http://127.0.0.1:${port}`); database = String(row.database); } } catch { /* Non-JSON test-runner diagnostics are not credentials. */ } }
      if (!database) await new Promise<void>(done => setTimeout(done, 25));
    }
    assert.match(database, /^connet_application_[a-f0-9]{32}$/, 'The child must report its newly owned target rather than reuse a real database');
    const health = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(health.status, 200); assert.equal((await health.json()).status, 'ok');
    child.kill('SIGTERM'); assert.equal(await exited, 0, 'Graceful shutdown waits for all application pools and fixture disposal');
    const remaining = await docker(['exec', `${config.project}-server`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc', `SELECT count(*) FROM pg_database WHERE datname='${database}'`]);
    assert.equal(remaining.trim(), '0'); assert.equal(/password|postgres(?:ql)?:\/\//i.test(stdout + stderr), false, 'Server diagnostics do not print credentials');
  } finally { if (!closed) { child.kill('SIGTERM'); await exited; } }
});
