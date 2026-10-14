import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../../apps/platform/app.ts';
import { openM1Store } from '../../apps/platform/infrastructure/relational/sqlite-store.ts';

const proof = () => `${randomUUID()}.${randomBytes(32).toString('base64url')}`;

test('factory protects parser/not-found responses and closes the in-memory app', async () => {
  const app = buildApp({ instanceId: 'test-instance', recoveryEpoch: 'test-epoch' });
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().instanceId, 'test-instance');
    const missing = await app.inject({ method: 'GET', url: '/not-a-route?secret=should-not-reflect' });
    assert.equal(missing.statusCode, 404);
    assert.ok(!missing.body.includes('should-not-reflect'));
    const invalid = await app.inject({
      method: 'POST', url: '/v1/registrations', headers: { 'content-type': 'application/json' },
      payload: '{"sensitive":"should-not-reflect"',
    });
    assert.equal(invalid.statusCode, 400);
    assert.ok(!invalid.body.includes('should-not-reflect'));
  } finally { await app.close(); }
});

test('factory persists API identity across close/reopen and fences an old open application', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm1-app-'));
  const databasePath = join(directory, 'm1.sqlite');
  const options = { databasePath, instanceId: 'test-instance', recoveryEpoch: 'first-epoch' };
  const runtimeToken = proof();
  let app = buildApp(options);
  try {
    const created = await app.inject({ method: 'POST', url: '/v1/registrations', payload: {
      operationId: randomUUID(), attemptId: randomUUID(), runtimeToken, continuationToken: proof(),
    } });
    assert.equal(created.statusCode, 200);
    const agentId = created.json().agentId;
    await app.close();
    app = buildApp(options);
    const self = await app.inject({ method: 'GET', url: '/v1/agent/self', headers: { authorization: `Bearer ${runtimeToken}` } });
    assert.equal(self.statusCode, 200);
    assert.equal(self.json().agentId, agentId);
    const newer = openM1Store({ ...options, recoveryEpoch: 'new-epoch' });
    newer.close();
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 503);
    const stale = await app.inject({ method: 'GET', url: '/v1/agent/self', headers: { authorization: `Bearer ${runtimeToken}` } });
    assert.notEqual(stale.statusCode, 200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persistent factory refuses implicit identity before opening a database', () => {
  assert.throws(() => buildApp({ databasePath: 'must-not-open.sqlite' }), /explicit/);
});
