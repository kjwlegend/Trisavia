import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadBackendConfig } from '../../apps/platform/configuration/backend-config.ts';

test('persistent identity survives restart and is not regenerated after damage or conflicts', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'm1-config-'));
  try {
    const first = loadBackendConfig({}, cwd);
    const second = loadBackendConfig({}, cwd);
    assert.equal(first.instanceId, second.instanceId);
    assert.equal(first.recoveryEpoch, second.recoveryEpoch);
    assert.ok(first.identityPath);
    assert.equal(statSync(first.identityPath).mode & 0o777, 0o600);
    const original = readFileSync(first.identityPath, 'utf8');
    assert.throws(() => loadBackendConfig({ M1_RECOVERY_EPOCH: 'different-epoch' }, cwd), /conflicts/);
    assert.equal(readFileSync(first.identityPath, 'utf8'), original);
    writeFileSync(first.identityPath, 'broken metadata');
    assert.throws(() => loadBackendConfig({}, cwd), /refusing to regenerate/);
    assert.equal(readFileSync(first.identityPath, 'utf8'), 'broken metadata');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects external binding, malformed ports and unsafe identity configuration', () => {
  assert.throws(() => loadBackendConfig({ M1_HOST: '0.0.0.0' }), /loopback/);
  for (const M1_PORT of ['abc', '-1', '65536', '1.5', '']) {
    assert.throws(() => loadBackendConfig({ M1_PORT }), /M1_PORT/);
  }
  assert.throws(() => loadBackendConfig({ M1_INSTANCE_ID: 'with spaces' }), /identifier/);
  const cwd = mkdtempSync(join(tmpdir(), 'm1-config-'));
  try {
    assert.throws(() => loadBackendConfig({ M1_DATABASE_PATH: 'same', M1_IDENTITY_PATH: 'same' }, cwd), /separate/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('memory databases require no identity file and accept explicit test identity', () => {
  const result = loadBackendConfig({
    M1_DATABASE_PATH: ':memory:', M1_INSTANCE_ID: 'test-instance', M1_RECOVERY_EPOCH: 'test-epoch', M1_PORT: '0',
  });
  assert.equal(result.identityPath, null);
  assert.equal(result.instanceId, 'test-instance');
  assert.equal(result.recoveryEpoch, 'test-epoch');
  assert.equal(result.port, 0);
});
