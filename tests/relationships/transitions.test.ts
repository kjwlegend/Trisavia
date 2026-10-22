import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptFriendshipInvitation, cancelFriendshipInvitation, declineFriendshipInvitation, expireFriendshipInvitation, invalidateFriendshipInvitation, makeFriendshipInvitation } from '../../apps/platform/domains/relationships/transitions.ts';
import { coreFixture } from '../world/runtime-fixture.ts';

const input = () => ({ id: 'friend-request', fromAgentId: 'agent-a', toAgentId: 'agent-b', message: 'A short independent invitation', sentBy: { kind: 'agent' as const, id: 'agent-a' }, senderConfirmationId: 'send-command', sharedGeneration: 0, participantGenerations: { from: 1, to: 1 }, now: 1000 });
const response = () => ({ effectiveAgentId: 'agent-b', actor: { kind: 'agent' as const, id: 'agent-b' }, confirmationId: 'response-command', now: 2000 });

test('friend invitations are independent fixed 120-code-point messages with a seven-day UTC deadline and real actor provenance', () => {
  const value = makeFriendshipInvitation({ ...input(), message: '🌱'.repeat(120), sentBy: { kind: 'owner', id: 'owner-a' } });
  assert.equal([...value.message].length, 120); assert.equal(value.deadline, value.createdAt + 604800000); assert.deepEqual(value.sentBy, { kind: 'owner', id: 'owner-a' });
  assert.equal(value.state, 'pending'); assert.equal(value.friendshipId, null);
  assert.throws(() => makeFriendshipInvitation({ ...input(), message: '🌱'.repeat(121) }), { code: 'invalid_request' });
  assert.throws(() => makeFriendshipInvitation({ ...input(), toAgentId: 'agent-a' }), { code: 'invalid_request' });
  assert.throws(() => makeFriendshipInvitation({ ...input(), sentBy: { kind: 'agent', id: 'unrelated' } }), { code: 'target_not_accessible' });
});

test('only the recipient accepts/declines and only sender cancels; confirmation has one canonical zero-score relationship', () => {
  const request = makeFriendshipInvitation(input());
  assert.throws(() => acceptFriendshipInvitation(request, { ...response(), effectiveAgentId: 'agent-a', actor: { kind: 'agent', id: 'agent-a' }, friendshipId: 'friendship' }), { code: 'target_not_accessible' });
  assert.throws(() => cancelFriendshipInvitation(request, response()), { code: 'target_not_accessible' });
  const accepted = acceptFriendshipInvitation(request, { ...response(), actor: { kind: 'owner', id: 'owner-b' }, friendshipId: 'friendship' });
  assert.equal(accepted.invitation.state, 'accepted'); assert.deepEqual(accepted.invitation.respondedBy, { kind: 'owner', id: 'owner-b' });
  assert.equal(accepted.friendship.intimacyScore, 0); assert.deepEqual([accepted.friendship.firstAgentId, accepted.friendship.secondAgentId], ['agent-a', 'agent-b']);
  assert.notEqual(accepted.friendship.firstConfirmationId, accepted.friendship.secondConfirmationId);
  assert.throws(() => declineFriendshipInvitation(accepted.invitation, response()), { code: 'friendship_state_conflict' });
  assert.equal(declineFriendshipInvitation(request, response()).state, 'declined');
  assert.equal(cancelFriendshipInvitation(request, { ...response(), effectiveAgentId: 'agent-a', actor: { kind: 'agent', id: 'agent-a' } }).state, 'cancelled');
});

test('deadline boundary expires without faking a human response; revoked sharing cancels instead of pretending early expiry', () => {
  const request = makeFriendshipInvitation(input());
  assert.equal(expireFriendshipInvitation(request, request.deadline - 1), request);
  assert.throws(() => acceptFriendshipInvitation(request, { ...response(), now: request.deadline, friendshipId: 'friendship' }), { code: 'friendship_expired' });
  const expired = expireFriendshipInvitation(request, request.deadline); assert.equal(expired.state, 'expired'); assert.equal(expired.respondedBy, null);
  const cancelled = invalidateFriendshipInvitation(request, { now: 2000, code: 'sharing_changed' });
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.responseConfirmationId, null); assert.equal(cancelled.invalidationCode, 'sharing_changed');
  assert.deepEqual(cancelled.respondedBy, { kind: 'system', id: 'relationships-invalidation' });
  assert.throws(() => acceptFriendshipInvitation(cancelled, { ...response(), friendshipId: 'friendship' }), { code: 'friendship_state_conflict' });
});

test('trusted completion hook ignores pre-friendship exchanges, deduplicates source facts, and caps shared intimacy at 100', async () => {
  const f = coreFixture(), accepted = acceptFriendshipInvitation(makeFriendshipInvitation(input()), { ...response(), friendshipId: 'friendship' });
  await f.relationships.saveFriendship(accepted.friendship, null);
  const old = { activityId: 'old', fromAgentId: 'agent-a', toAgentId: 'agent-b', invitationCreatedAt: 2000, completedAt: 3000 };
  assert.equal((await f.relationships.recordCompletedFeedback(old)).changed, false); assert.equal(f.state.intimacyFacts.size, 0);
  const first = { ...old, activityId: 'first', invitationCreatedAt: 2001 };
  assert.equal((await f.relationships.recordCompletedFeedback(first)).friendship!.intimacyScore, 1);
  assert.equal((await f.relationships.recordCompletedFeedback(first)).changed, false);
  await assert.rejects(f.relationships.recordCompletedFeedback({ ...first, completedAt: 3001 }), { code: 'command_conflict' });
  for (let index = 0; index < 100; index++) await f.relationships.recordCompletedFeedback({ ...first, activityId: 'synthetic-completed-' + index });
  assert.equal((await f.relationships.getFriendship('friendship'))!.intimacyScore, 100);
  assert.equal((await f.relationships.recordCompletedFeedback({ ...first, activityId: 'cap' })).changed, false);
  assert.equal((await f.relationships.recordCompletedFeedback({ ...first, fromAgentId: 'agent-c', activityId: 'not-friends' })).friendship, null);
});
