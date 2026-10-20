import assert from 'node:assert/strict';
import test from 'node:test';
import { worldFixture } from './postgresql-fixture.ts';
import { bootstrapWorld } from '../../apps/platform/application/world-service.ts';
import { bootstrapInteraction } from '../../apps/platform/application/interaction-service.ts';
import { INTERACTION_REPOSITORY } from '../../apps/platform/domains/interaction/repository.ts';
import { TEXT_FEEDBACK_V1, type InteractionInvitation } from '../../apps/platform/domains/interaction/types.ts';
import { makeInvitation } from '../../apps/platform/domains/interaction/transitions.ts';

test('real PG invitation list preserves ID order, pagination and per-row configuration without concurrent-client warnings', async t => {
  const f = await worldFixture(); t.after(f.dispose);
  const a = await f.register(), b = await f.register(), c = await f.register();
  const secondConfiguration = { ...TEXT_FEEDBACK_V1, configVersion: 2, invitationSeconds: 604799 };
  const expected: InteractionInvitation[] = [];
  await f.runtime.transaction(async context => {
    await bootstrapWorld(context); await bootstrapInteraction(context);
    const repository = context.repository(INTERACTION_REPOSITORY);
    await repository.initializeConfiguration(secondConfiguration);
    for (const [id, from, to, configuration] of [
      ['z-last', a, b, TEXT_FEEDBACK_V1], ['a-first', b, a, secondConfiguration],
      ['m-middle', a, c, TEXT_FEEDBACK_V1], ['b-unrelated', b, c, secondConfiguration],
    ] as const) {
      const artifact = { artifactId: 'artifact-' + id, revision: 1, version: 1, authorAgentId: from.agentId,
        title: 'Synthetic title', body: 'Synthetic fixed text', createdAt: context.now(), withdrawnAt: null };
      await repository.saveArtifact(artifact, null);
      const pair = await repository.lockPair(from.agentId, to.agentId);
      const invitation = makeInvitation({ id, worldId: 'default', actorId: from.agentId, recipientId: to.agentId,
        artifact, intent: 'Synthetic list test', configuration: { ...configuration }, sharedGeneration: pair.sharedGeneration,
        participantGenerations: { from: 1, to: 1 }, now: context.now() });
      await repository.saveInvitation(invitation, null);
      if (from.agentId === a.agentId || to.agentId === a.agentId) expected.push(invitation);
    }
  });
  expected.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const warnings: Error[] = [];
  const warning = (value: Error) => {
    if (/Calling client\.query\(\).*already executing a query/.test(value.message)) warnings.push(value);
  };
  process.on('warning', warning); t.after(() => { process.removeListener('warning', warning); });
  await f.runtime.read(async context => {
    const repository = context.repository(INTERACTION_REPOSITORY);
    assert.deepEqual(await repository.listInvitations(a.agentId, { limit: 100 }), expected);
    const first = await repository.listInvitations(a.agentId, { limit: 2 });
    assert.deepEqual(first, expected.slice(0, 2));
    assert.deepEqual(await repository.listInvitations(a.agentId, { afterId: first.at(-1)!.id, limit: 2 }), expected.slice(2));
    assert.deepEqual(await repository.listInvitations(a.agentId, { afterId: 'z-last', limit: 2 }), []);
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(warnings.length, 0, 'list decoding must not query concurrently on its guarded PG client');
});
