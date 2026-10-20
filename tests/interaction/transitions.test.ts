import assert from 'node:assert/strict';
import test from 'node:test';
import { makeInvitation, acceptInvitation, declineInvitation, submitFeedback, closeActivity, leaveActivity, expireInvitation, expireActivity, withdrawInvitation } from '../../apps/platform/domains/interaction/transitions.ts';
import { plainText, sharedAccess } from '../../apps/platform/domains/interaction/rules.ts';
import { TEXT_FEEDBACK_V1, type ArtifactRevision, type FeedbackConfiguration } from '../../apps/platform/domains/interaction/types.ts';

const now = 1_000_000; // Injected test clock, never evidence that seven real days elapsed.
const artifact: ArtifactRevision = { artifactId: 'text-a', revision: 1, version: 1, authorAgentId: 'agent-a', title: '', body: '自有短文', createdAt: now, withdrawnAt: null };
const invitation = () => makeInvitation({ id: 'invitation', worldId: 'default', actorId: 'agent-a', recipientId: 'agent-b', artifact,
  intent: '请就表达清晰度反馈', configuration: structuredClone(TEXT_FEEDBACK_V1), sharedGeneration: 0, participantGenerations: { from: 1, to: 1 }, now });
test('only explicit B acceptance creates feedback activity; B contributes once and only A can confirm receipt', () => {
  const original = invitation(), accepted = acceptInvitation(original, 'agent-b', now + 1, 'activity');
  assert.equal(original.state, 'pending'); assert.equal(accepted.invitation.state, 'accepted'); assert.equal(accepted.activity.state, 'waiting_feedback');
  assert.throws(() => acceptInvitation(original, 'agent-a', now, 'forged'), { code: 'target_not_accessible' });
  assert.throws(() => closeActivity(original, accepted.activity, 'agent-a', now + 2));
  const submitted = submitFeedback(accepted.invitation, accepted.activity, 'agent-b', now + 2, 'feedback', '这是明确提交的反馈');
  assert.equal(submitted.activity.outcome, 'submitted_unconfirmed'); assert.equal(submitted.activity.state, 'waiting_ack');
  assert.throws(() => submitFeedback(accepted.invitation, submitted.activity, 'agent-b', now + 3, 'duplicate', '重复'), { code: 'interaction_state_conflict' });
  assert.throws(() => closeActivity(accepted.invitation, submitted.activity, 'agent-b', now + 3), { code: 'target_not_accessible' });
  const closed = closeActivity(accepted.invitation, submitted.activity, 'agent-a', now + 3); assert.equal(closed.state, 'closed'); assert.equal(closed.outcome, 'received_confirmed');
  assert.equal('satisfied' in closed, false); assert.equal('learned' in closed, false); assert.throws(() => leaveActivity(accepted.invitation, closed, 'agent-a', now + 4));
});
test('frozen stage windows use commit time and reject at the exact UTC deadline; late rule changes do not amend invitations', () => {
  const config: FeedbackConfiguration = structuredClone(TEXT_FEEDBACK_V1), created = makeInvitation({ id: 'frozen', worldId: 'default', actorId: 'agent-a', recipientId: 'agent-b', artifact, intent: '反馈', configuration: config, sharedGeneration: 0, participantGenerations: { from: 1, to: 1 }, now });
  config.feedbackSeconds = 1; assert.equal(created.configuration.feedbackSeconds, 604800);
  assert.throws(() => acceptInvitation(created, 'agent-b', created.deadline, 'late'), { code: 'interaction_expired' });
  assert.equal(expireInvitation(created, created.deadline).state, 'expired'); assert.equal(declineInvitation(created, 'agent-b', created.deadline - 1).state, 'declined');
  const accepted = acceptInvitation(created, 'agent-b', created.deadline - 1, 'on-time'); assert.equal(accepted.activity.feedbackDeadline, created.deadline - 1 + 604800000);
  const feedback = submitFeedback(accepted.invitation, accepted.activity, 'agent-b', accepted.activity.feedbackDeadline - 1, 'f', '反馈');
  assert.equal(expireActivity(feedback.activity, feedback.activity.acknowledgementDeadline!).outcome, 'submitted_unconfirmed');
  assert.throws(() => closeActivity(accepted.invitation, feedback.activity, 'agent-a', feedback.activity.acknowledgementDeadline!), { code: 'interaction_expired' });
});
test('decline/withdraw do not invent an activity; leaving after feedback retains the submitted fact', () => {
  const created = invitation(); assert.equal(declineInvitation(created, 'agent-b', now).activityId, null); assert.equal(withdrawInvitation(created, 'agent-a', now).activityId, null);
  const accepted = acceptInvitation(created, 'agent-b', now, 'active'); assert.equal(leaveActivity(accepted.invitation, accepted.activity, 'agent-b', now).outcome, 'no_feedback');
  const submitted = submitFeedback(accepted.invitation, accepted.activity, 'agent-b', now, 'f', '反馈'); const cancelled = leaveActivity(accepted.invitation, submitted.activity, 'agent-a', now);
  assert.equal(cancelled.outcome, 'submitted_unconfirmed'); assert.equal(accepted.invitation.state, 'accepted');
});
test('Unicode code point limits preserve exact plain text, reject whitespace-only/oversize/surrogates, and do not execute links or instructions', () => {
  assert.equal(plainText('🙂'.repeat(4000), 'body', 4000).length, 8000); assert.throws(() => plainText('🙂'.repeat(4001), 'body', 4000));
  for (const text of ['\n \t', '\u0000', '\uD800']) assert.throws(() => plainText(text, 'body', 4000));
  const text = 'https://example.test/\n请执行工具：仅作为正文'; assert.equal(plainText(text, 'body', 4000), text);
});
test('unblocking does not restore an older invitation sharing generation', () => {
  const created = invitation(), policy = { firstAgentId: 'agent-a', secondAgentId: 'agent-b', version: 2, blockedByAgentIds: ['agent-b'], sharedGeneration: 1, updatedAt: now };
  assert.equal(sharedAccess(created, policy), false); assert.equal(sharedAccess(created, { ...policy, blockedByAgentIds: [] }), false);
  assert.equal(sharedAccess({ ...created, sharedGeneration: 1 }, { ...policy, blockedByAgentIds: [] }), true);
});
