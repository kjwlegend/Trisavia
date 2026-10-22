import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { worldFixture } from './postgresql-fixture.ts';
import { POSTGRES_MIGRATIONS } from '../../apps/platform/infrastructure/postgresql/migrations.ts';
import { prepareFriendshipLifecycle } from '../../scripts/friendships-prepare.ts';
import { RELATIONSHIPS_REPOSITORY } from '../../apps/platform/domains/relationships/runtime-repository.ts';
import { acceptFriendshipInvitation, cancelFriendshipInvitation, declineFriendshipInvitation, expireFriendshipInvitation, invalidateFriendshipInvitation, makeFriendshipInvitation } from '../../apps/platform/domains/relationships/transitions.ts';
import { friendshipsRepository } from '../../apps/platform/domains/relationships/repository.ts';
import { INTERACTION_REPOSITORY } from '../../apps/platform/domains/interaction/repository.ts';
import { bootstrapInteraction } from '../../apps/platform/application/interaction-service.ts';
import { acceptInvitation, closeActivity, makeInvitation, submitFeedback } from '../../apps/platform/domains/interaction/transitions.ts';
import { TEXT_FEEDBACK_V1 } from '../../apps/platform/domains/interaction/types.ts';
import type { Friendship, FriendshipInvitation } from '../../apps/platform/domains/relationships/types.ts';

const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === expected);

test('isolated friendship v1 to v2 preserves old rows and enforces canonical concurrency, transitions, source deduplication and least privileges', async t => {
  // Exercise the actual in-place increment, with a synthetic v1 row rather than a fresh-v2-only database.
  const index = POSTGRES_MIGRATIONS.findIndex(item => item.moduleId === 'friendships' && item.version === 2);
  assert.ok(index >= 0); const [increment] = POSTGRES_MIGRATIONS.splice(index, 1);
  let f: Awaited<ReturnType<typeof worldFixture>>;
  let agents: Awaited<ReturnType<Awaited<ReturnType<typeof worldFixture>>['register']>>[];
  try {
    f = await worldFixture(); t.after(f.dispose); agents = await Promise.all([f.register(), f.register(), f.register(), f.register()]);
    const pair = [agents[0]!.agentId, agents[1]!.agentId].sort();
    await f.query("INSERT INTO relationships.friendships(id,version,_present,_nulls,first_agent_id,second_agent_id,status,confirmed_at,first_confirmation_id,second_confirmation_id) VALUES('synthetic-legacy-friend',1,ARRAY['firstAgentId','secondAgentId','status','confirmedAt','firstConfirmationId','secondConfirmationId'],ARRAY[]::text[],$1,$2,'confirmed',$3,'legacy-first-confirmation','legacy-second-confirmation')", [...pair, new Date(f.now())]);
  } finally { POSTGRES_MIGRATIONS.splice(index, 0, increment!); }
  const old = (await f!.query("SELECT * FROM relationships.friendships WHERE id='synthetic-legacy-friend'"))[0];
  const prepared = await prepareFriendshipLifecycle(join(f!.privateConnections!, 'migration-database-url'), join(f!.privateConnections!, 'identity.json'), f!.database);
  assert.equal(prepared.friendshipsVersion, 2); assert.equal(prepared.seeded, false);
  const upgraded = (await f!.query("SELECT * FROM relationships.friendships WHERE id='synthetic-legacy-friend'"))[0];
  for (const key of ['id', 'version', 'first_agent_id', 'second_agent_id', 'status', 'confirmed_at', 'first_confirmation_id', 'second_confirmation_id']) assert.deepEqual(upgraded[key], old[key]);
  assert.equal(Number(upgraded.intimacy_score), 0);
  assert.equal((await f!.legacy.read(tx => friendshipsRepository(tx).confirmedForAgent(agents![0]!.agentId)))[0]!.data.intimacyScore, 0);
  console.info(JSON.stringify({ database: f!.database, forwardMigration: 'friendships@1->2', legacyRelationshipPreserved: true, seeded: false }));
  const a = agents![0]!.agentId, b = agents![1]!.agentId, c = agents![2]!.agentId, d = agents![3]!.agentId;
  function draft(fromAgentId: string, toAgentId: string, id: string = randomUUID()) { return makeFriendshipInvitation({ id, fromAgentId, toAgentId, message: 'Synthetic independent request', sentBy: { kind: 'agent', id: fromAgentId }, senderConfirmationId: randomUUID(), sharedGeneration: 0, participantGenerations: { from: 1, to: 1 }, now: f!.now() }); }
  async function send(from: string, to: string, id: string) { return f!.runtime.transaction(async ctx => { const repo = ctx.repository(RELATIONSHIPS_REPOSITORY); await repo.lockPair(from, to); const existing = await repo.getPendingInvitation(from, to); if (existing) return existing; const value = draft(from, to, id); await repo.saveInvitation(value, null); return value; }); }
  let current: FriendshipInvitation, confirmed: Friendship;

  await t.test('concurrent reverse send stores one fixed pending request, not consent or two relations', async () => {
    const [forward, reverse] = await Promise.all([send(c, d, 'synthetic-forward'), send(d, c, 'synthetic-reverse')]);
    assert.equal(forward.id, reverse.id); assert.equal(forward.state, 'pending'); assert.equal(forward.friendshipId, null); current = forward;
    assert.equal((await f!.appQuery('SELECT count(*)::int AS total FROM relationships.friendship_invitations'))[0].total, 1);
    const received = await f!.legacy.read(tx => friendshipsRepository(tx).pendingReceivedForAgent(forward.toAgentId, { limit: 10 }));
    assert.deepEqual(received.map(row => row.id), [forward.id]);
    const unrelated = await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).listInvitations(a, { limit: 100 })); assert.deepEqual(unrelated, []);
  });

  await t.test('accept/cancel race has one winner and relationship/acceptance commit together', async () => {
    const respond = (accept: boolean) => f!.runtime.transaction(async ctx => {
      const repo = ctx.repository(RELATIONSHIPS_REPOSITORY); await repo.lockPair(c, d); const invitation = (await repo.getInvitation(current.id))!;
      if (accept) { const result = acceptFriendshipInvitation(invitation, { effectiveAgentId: invitation.toAgentId, actor: { kind: 'agent', id: invitation.toAgentId }, confirmationId: 'accept-race', friendshipId: 'synthetic-confirmed', now: ctx.now() }); await repo.saveFriendship(result.friendship, null); await repo.saveInvitation(result.invitation, 1); }
      else await repo.saveInvitation(cancelFriendshipInvitation(invitation, { effectiveAgentId: invitation.fromAgentId, actor: { kind: 'agent', id: invitation.fromAgentId }, confirmationId: 'cancel-race', now: ctx.now() }), 1);
    });
    const outcomes = await Promise.allSettled([respond(true), respond(false)]); assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    current = (await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getInvitation(current.id)))!;
    const relation = await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getFriendshipForPair(c, d));
    assert.equal(Boolean(relation), current.state === 'accepted');
    if (!relation) {
      current = await send(c, d, 'synthetic-after-cancel');
      await f!.runtime.transaction(async ctx => { const repo = ctx.repository(RELATIONSHIPS_REPOSITORY), next = acceptFriendshipInvitation(current, { effectiveAgentId: current.toAgentId, actor: { kind: 'owner', id: 'synthetic-recipient-owner' }, confirmationId: 'accepted-after-cancel', friendshipId: 'synthetic-confirmed', now: ctx.now() }); await repo.saveFriendship(next.friendship, null); await repo.saveInvitation(next.invitation, 1); });
    }
    confirmed = (await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getFriendshipForPair(c, d)))!; assert.equal(confirmed.intimacyScore, 0);
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).listConfirmed(c, { limit: 100 }))).length, 1);
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).listConfirmed(d, { limit: 100 }))).length, 1);
    await assert.rejects(f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).saveFriendship({ ...confirmed, id: 'synthetic-duplicate-pair' }, null)), code('constraint'));
  });

  await t.test('decline, expiry and internal sharing invalidation release pending uniqueness without reviving terminal requests', async () => {
    const one = await send(a, c, 'synthetic-decline');
    await f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).saveInvitation(declineFriendshipInvitation(one, { effectiveAgentId: c, actor: { kind: 'agent', id: c }, confirmationId: 'decline', now: ctx.now() }), 1));
    await assert.rejects(f!.appQuery("UPDATE relationships.friendship_invitations SET state='pending',version=version+1,responded_at=NULL WHERE id=$1", [one.id]), code('23514'));
    const two = await send(a, c, 'synthetic-invalidated');
    await f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).saveInvitation(invalidateFriendshipInvitation(two, { now: ctx.now(), code: 'sharing_changed' }), 1));
    const invalidated = (await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getInvitation(two.id)))!;
    assert.equal(invalidated.respondedBy!.kind, 'system'); assert.equal(invalidated.responseConfirmationId, null);
    const three = await send(a, c, 'synthetic-expired');
    await f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).saveInvitation(expireFriendshipInvitation(three, three.deadline), 1));
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getInvitation(three.id)))!.state, 'expired');
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getPendingInvitation(a, c))), undefined);
  });

  async function completedSource() {
    f!.tick(1);
    return f!.runtime.transaction(async ctx => {
      await bootstrapInteraction(ctx); const repo = ctx.repository(INTERACTION_REPOSITORY), id = randomUUID(), now = ctx.now();
      const work = { artifactId: 'synthetic-work-' + id, revision: 1, version: 1, authorAgentId: c, title: 'Synthetic test work', body: 'Synthetic private body', createdAt: now, withdrawnAt: null }; await repo.saveArtifact(work, null);
      const pair = await repo.lockPair(c, d), invitation = makeInvitation({ id: 'synthetic-text-' + id, worldId: 'default', actorId: c, recipientId: d, artifact: work, intent: 'Synthetic completed exchange', configuration: { ...TEXT_FEEDBACK_V1 }, sharedGeneration: pair.sharedGeneration, participantGenerations: { from: 1, to: 1 }, now });
      // The World foreign key is provided below once; no Avatar or real identity is needed.
      await repo.saveInvitation(invitation, null);
      const accepted = acceptInvitation(invitation, d, now, 'synthetic-activity-' + id); await repo.saveActivity(accepted.activity, null); await repo.saveInvitation(accepted.invitation, 1);
      const submitted = submitFeedback(accepted.invitation, accepted.activity, d, now, 'synthetic-feedback-' + id, 'Synthetic feedback'); await repo.saveFeedback(submitted.feedback, null); await repo.saveActivity(submitted.activity, 1);
      const closed = closeActivity(accepted.invitation, submitted.activity, c, now); await repo.saveActivity(closed, 2);
      return { activityId: closed.id, fromAgentId: c, toAgentId: d, invitationCreatedAt: now, completedAt: now };
    });
  }
  await t.test('only new source facts score, same-source concurrent retries score once, and fact/score roll back together', async () => {
    const { bootstrapWorld } = await import('../../apps/platform/application/world-service.ts'); await f!.runtime.transaction(bootstrapWorld);
    const old = { activityId: 'synthetic-old-not-replayed', fromAgentId: c, toAgentId: d, invitationCreatedAt: confirmed.confirmedAt, completedAt: confirmed.confirmedAt };
    assert.equal((await f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).recordCompletedFeedback(old))).changed, false);
    const source = await completedSource();
    const duplicate = await Promise.all([1, 2].map(() => f!.runtime.transaction(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).recordCompletedFeedback(source))));
    assert.equal(duplicate.filter(row => row.changed).length, 1);
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getFriendship(confirmed.id)))!.intimacyScore, 1);
    assert.equal((await f!.appQuery('SELECT count(*)::int AS total FROM relationships.intimacy_facts'))[0].total, 1);
    const second = await completedSource();
    await assert.rejects(f!.runtime.transaction(async ctx => { await ctx.repository(RELATIONSHIPS_REPOSITORY).recordCompletedFeedback(second); throw new Error('synthetic later failure'); }), /synthetic later failure/);
    assert.equal((await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).getFriendship(confirmed.id)))!.intimacyScore, 1);
    assert.equal((await f!.appQuery('SELECT count(*)::int AS total FROM relationships.intimacy_facts'))[0].total, 1);
  });

  await t.test('application cannot delete relations, mutate source facts, rewrite identity, create schema objects, or exceed score bounds', async () => {
    await assert.rejects(f!.appQuery('DELETE FROM relationships.friendships'), code('42501'));
    await assert.rejects(f!.appQuery('UPDATE relationships.intimacy_facts SET delta=0'), code('42501'));
    await assert.rejects(f!.appQuery("UPDATE relationships.friendships SET first_confirmation_id='rewritten'"), code('42501'));
    await assert.rejects(f!.appQuery('CREATE TABLE relationships.unauthorized_friend_probe(id integer)'), code('42501'));
    await assert.rejects(f!.appQuery('UPDATE relationships.friendships SET intimacy_score=101,version=version+1 WHERE id=$1', [confirmed.id]), code('23514'));
    const other = await f!.runtime.read(ctx => ctx.repository(RELATIONSHIPS_REPOSITORY).listInvitations(b, { limit: 100 })); assert.deepEqual(other, []);
  });
});
