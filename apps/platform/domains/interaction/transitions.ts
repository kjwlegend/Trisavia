import { fail } from '../common/errors.ts';
import { activityExpired, assertConfiguration, deadlineAt, invitationExpired, plainText } from './rules.ts';
import type { ArtifactRevision, FeedbackActivity, FeedbackConfiguration, FeedbackContribution, InteractionInvitation } from './types.ts';

export function makeInvitation(input: { id: string; worldId: string; actorId: string; recipientId: string; artifact: ArtifactRevision; intent: unknown; configuration: FeedbackConfiguration; sharedGeneration: number; participantGenerations: { from: number; to: number }; now: number }): InteractionInvitation {
  const { artifact, configuration: config } = input; assertConfiguration(config);
  if (!Number.isSafeInteger(input.participantGenerations.from) || input.participantGenerations.from < 1 || !Number.isSafeInteger(input.participantGenerations.to) || input.participantGenerations.to < 1) fail('invalid_request', 400, 'Invalid participation generation');
  if (input.actorId !== artifact.authorAgentId || artifact.withdrawnAt !== null) fail('target_not_accessible', 404, 'Target is not accessible');
  if (input.actorId === input.recipientId) fail('invalid_request', 400, 'The feedback recipient must be another Agent');
  return { id: input.id, version: 1, worldId: input.worldId, fromAgentId: input.actorId, toAgentId: input.recipientId,
    artifact: { artifactId: artifact.artifactId, revision: artifact.revision }, intent: plainText(input.intent, 'intent', config.maxIntentCodePoints),
    configuration: structuredClone(config), sharedGeneration: input.sharedGeneration, participantGenerations: { ...input.participantGenerations }, state: 'pending', createdAt: input.now,
    deadline: deadlineAt(input.now, config.invitationSeconds), respondedAt: null, activityId: null, reason: null };
}
function pending(invitation: InteractionInvitation, now: number): void {
  if (invitationExpired(invitation, now)) fail('interaction_expired', 410, 'The invitation deadline has passed');
  if (invitation.state !== 'pending') fail('interaction_state_conflict', 409, 'The invitation is no longer pending');
}
function active(activity: FeedbackActivity, now: number): void {
  if (activityExpired(activity, now)) fail('interaction_expired', 410, 'The activity stage deadline has passed');
  if (!['waiting_feedback', 'waiting_ack'].includes(activity.state)) fail('interaction_state_conflict', 409, 'The activity has ended');
}
function accepted(invitation: InteractionInvitation, activity: FeedbackActivity): void {
  if (activity.invitationId !== invitation.id || invitation.activityId !== activity.id) fail('target_not_accessible', 404, 'Target is not accessible');
  if (invitation.state !== 'accepted') fail('interaction_state_conflict', 409, 'The invitation has not been accepted');
}
export function acceptInvitation(invitation: InteractionInvitation, actorId: string, now: number, activityId: string): { invitation: InteractionInvitation; activity: FeedbackActivity } {
  if (actorId !== invitation.toAgentId) fail('target_not_accessible', 404, 'Target is not accessible'); pending(invitation, now);
  return { invitation: { ...invitation, version: invitation.version + 1, state: 'accepted', respondedAt: now, activityId },
    activity: { id: activityId, version: 1, invitationId: invitation.id, state: 'waiting_feedback', outcome: 'no_feedback', acceptedAt: now,
      feedbackDeadline: deadlineAt(now, invitation.configuration.feedbackSeconds), acknowledgementDeadline: null, feedbackId: null,
      endedAt: null, endedByAgentId: null, reason: null } };
}
export function declineInvitation(invitation: InteractionInvitation, actorId: string, now: number, reason?: unknown): InteractionInvitation {
  if (actorId !== invitation.toAgentId) fail('target_not_accessible', 404, 'Target is not accessible'); pending(invitation, now);
  return { ...invitation, version: invitation.version + 1, state: 'declined', respondedAt: now,
    reason: reason === undefined ? null : plainText(reason, 'reason', invitation.configuration.maxReasonCodePoints, false) };
}
export function withdrawInvitation(invitation: InteractionInvitation, actorId: string, now: number): InteractionInvitation {
  if (actorId !== invitation.fromAgentId) fail('target_not_accessible', 404, 'Target is not accessible'); pending(invitation, now);
  return { ...invitation, version: invitation.version + 1, state: 'withdrawn', respondedAt: now };
}
export function submitFeedback(invitation: InteractionInvitation, activity: FeedbackActivity, actorId: string, now: number, feedbackId: string, body: unknown): { activity: FeedbackActivity; feedback: FeedbackContribution } {
  if (actorId !== invitation.toAgentId) fail('target_not_accessible', 404, 'Target is not accessible'); accepted(invitation, activity); active(activity, now);
  if (activity.state !== 'waiting_feedback' || activity.feedbackId !== null) fail('interaction_state_conflict', 409, 'Feedback was already submitted');
  const feedback: FeedbackContribution = { id: feedbackId, activityId: activity.id, authorAgentId: actorId, version: 1,
    body: plainText(body, 'body', invitation.configuration.maxFeedbackCodePoints), submittedAt: now, withdrawnAt: null };
  return { feedback, activity: { ...activity, version: activity.version + 1, feedbackId, state: 'waiting_ack', outcome: 'submitted_unconfirmed', acknowledgementDeadline: deadlineAt(now, invitation.configuration.acknowledgementSeconds) } };
}
export function closeActivity(invitation: InteractionInvitation, activity: FeedbackActivity, actorId: string, now: number): FeedbackActivity {
  if (actorId !== invitation.fromAgentId) fail('target_not_accessible', 404, 'Target is not accessible'); accepted(invitation, activity); active(activity, now);
  if (activity.state !== 'waiting_ack' || !activity.feedbackId) fail('interaction_state_conflict', 409, 'Feedback is required before confirming receipt');
  return { ...activity, version: activity.version + 1, state: 'closed', outcome: 'received_confirmed', endedAt: now, endedByAgentId: actorId };
}
export function leaveActivity(invitation: InteractionInvitation, activity: FeedbackActivity, actorId: string, now: number, reason?: unknown): FeedbackActivity {
  if (![invitation.fromAgentId, invitation.toAgentId].includes(actorId)) fail('target_not_accessible', 404, 'Target is not accessible'); accepted(invitation, activity); active(activity, now);
  return { ...activity, version: activity.version + 1, state: 'cancelled', endedAt: now, endedByAgentId: actorId,
    reason: reason === undefined ? null : plainText(reason, 'reason', invitation.configuration.maxReasonCodePoints, false) };
}
export function expireInvitation(invitation: InteractionInvitation, now: number): InteractionInvitation {
  return invitationExpired(invitation, now) ? { ...invitation, version: invitation.version + 1, state: 'expired', respondedAt: now } : invitation;
}
export function expireActivity(activity: FeedbackActivity, now: number): FeedbackActivity {
  return activityExpired(activity, now) ? { ...activity, version: activity.version + 1, state: 'expired', endedAt: now } : activity;
}
