import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildLocalSummary, newAgentMaterial, newOperationId, readPrivateState, saveNewPrivateState } from '../../scripts/m1-client.ts';

test('local client saves private continuation material before use and cannot replace an existing attempt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-client-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const original = { ...newAgentMaterial(), registrationOperationId: newOperationId(), instanceId: 'synthetic-instance', apiVersion: 'v1', documentationVersion: 'v1' } as const;
  await saveNewPrivateState(path, original);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const reopened = await readPrivateState(path);
  assert(reopened.runtimeToken === original.runtimeToken, 'Reopened runtime proof must match');
  assert(reopened.continuationToken === original.continuationToken, 'Reopened continuation proof must match');
  assert.notEqual(reopened.runtimeToken.split('.')[0], reopened.continuationToken.split('.')[0]);
  await assert.rejects(saveNewPrivateState(path, { ...original, ...newAgentMaterial() }), { code: 'EEXIST' });
  assert((await readPrivateState(path)).attemptId === original.attemptId, 'A rejected replacement must preserve the attempt');
});

test('local summary excludes private proofs and separates configuration from periodic evidence', () => {
  const material = newAgentMaterial();
  const summary = buildLocalSummary({
    ...material, instanceId: 'synthetic-instance', agentId: 'synthetic-agent', ownerId: 'synthetic-owner',
    operationId: 'synthetic-operation', managementStatus: 'pending_setup', deliveryStatus: 'not_generated', localStateReread: true,
    profilePublished: false, membershipState: 'not_joined',
  });
  assert.equal(summary.registration, 'completed');
  assert.equal(summary.local_setup, 'completed');
  assert.equal(summary.schedule_configuration, 'not_configured');
  assert.equal(summary.periodic_run_verification, 'not_verified');
  assert.equal(summary.managementStatus, 'pending_setup');
  assert(!JSON.stringify(summary).includes(material.runtimeToken.split('.')[1]!), 'Summary must omit runtime proof');
  assert(!JSON.stringify(summary).includes(material.continuationToken.split('.')[1]!), 'Summary must omit continuation proof');
  assert.equal(buildLocalSummary({ instanceId: 'i', agentId: 'a', ownerId: 'o', operationId: 'op',
    managementStatus: 'pending_setup', deliveryStatus: 'not_generated', localStateReread: false, profilePublished: false,
    membershipState: 'not_joined' }).local_setup, 'incomplete');
});

test('local client rejects a public state file and incompatible documentation version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-client-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  await saveNewPrivateState(path, { ...newAgentMaterial(), registrationOperationId: newOperationId(), instanceId: 'synthetic-instance', apiVersion: 'v1', documentationVersion: 'v1' });
  await chmod(path, 0o644);
  await assert.rejects(readPrivateState(path), /private regular file/);
  await chmod(path, 0o600);
  await writeFile(path, '{"apiVersion":"v1","documentationVersion":"unsupported"}', { mode: 0o600 });
  await assert.rejects(readPrivateState(path), /version or required fields/);
});
