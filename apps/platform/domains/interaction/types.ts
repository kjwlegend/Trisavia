export interface ArtifactRef { artifactId: string; revision: number }
export interface ArtifactRevision {
  artifactId: string;
  revision: number;
  version: number;
  authorAgentId: string;
  title: string;
  body: string;
  createdAt: number;
  withdrawnAt: number | null;
}
export interface FeedbackConfiguration {
  templateId: 'text_feedback';
  templateVersion: number;
  configVersion: number;
  invitationSeconds: number;
  feedbackSeconds: number;
  acknowledgementSeconds: number;
  maxArtifactCodePoints: number;
  maxTitleCodePoints: number;
  maxIntentCodePoints: number;
  maxFeedbackCodePoints: number;
  maxReasonCodePoints: number;
}
export const TEXT_FEEDBACK_V1: Readonly<FeedbackConfiguration> = Object.freeze({
  templateId: 'text_feedback', templateVersion: 1, configVersion: 1,
  invitationSeconds: 604800, feedbackSeconds: 604800, acknowledgementSeconds: 604800,
  maxArtifactCodePoints: 4000, maxTitleCodePoints: 80, maxIntentCodePoints: 300,
  maxFeedbackCodePoints: 2000, maxReasonCodePoints: 300,
});
export type InvitationState = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'unavailable';
export interface InteractionInvitation {
  id: string;
  version: number;
  worldId: string;
  fromAgentId: string;
  toAgentId: string;
  artifact: ArtifactRef;
  intent: string;
  configuration: FeedbackConfiguration;
  sharedGeneration: number;
  state: InvitationState;
  createdAt: number;
  deadline: number;
  respondedAt: number | null;
  activityId: string | null;
  reason: string | null;
}
export type ActivityState = 'waiting_feedback' | 'waiting_ack' | 'closed' | 'cancelled' | 'expired' | 'unavailable';
export type FeedbackOutcome = 'received_confirmed' | 'submitted_unconfirmed' | 'no_feedback';
export interface FeedbackActivity {
  id: string;
  version: number;
  invitationId: string;
  state: ActivityState;
  outcome: FeedbackOutcome;
  acceptedAt: number;
  feedbackDeadline: number;
  acknowledgementDeadline: number | null;
  feedbackId: string | null;
  endedAt: number | null;
  endedByAgentId: string | null;
  reason: string | null;
}
export interface FeedbackContribution {
  id: string;
  activityId: string;
  authorAgentId: string;
  version: number;
  body: string;
  submittedAt: number;
  withdrawnAt: number | null;
}
/** Canonically ordered stable Agent pair; unblocking never rewinds sharedGeneration. */
export interface InteractionPairPolicy {
  firstAgentId: string;
  secondAgentId: string;
  version: number;
  blockedByAgentIds: string[];
  sharedGeneration: number;
  updatedAt: number;
}
export type InteractionAction = 'interaction.artifact.create' | 'interaction.artifact.withdraw'
  | 'interaction.invitation.send' | 'interaction.invitation.accept' | 'interaction.invitation.decline' | 'interaction.invitation.withdraw'
  | 'interaction.activity.submit_feedback' | 'interaction.activity.close' | 'interaction.activity.leave'
  | 'interaction.feedback.withdraw' | 'interaction.policy.block' | 'interaction.policy.unblock';
export type InteractionDecisionStage = 'invitation_response' | 'feedback' | 'acknowledgement';
export interface InteractionDecisionIntent {
  deduplicationKey: string;
  agentId: string;
  stage: InteractionDecisionStage;
  target: { kind: 'invitation' | 'activity'; id: string; version: number };
  worldId: string;
  templateVersion: number;
  configVersion: number;
  deadline: number;
  allowedActions: string[];
  contextRefs: { kind: 'invitation' | 'artifact' | 'activity'; id: string; version: number }[];
}
export interface InteractionExpiryIntent {
  kind: 'interaction.invitation.expire' | 'interaction.activity.expire';
  targetId: string;
  expectedVersion: number;
  dueAt: number;
}
export interface InteractionFact {
  kind: string;
  invitationId?: string;
  activityId?: string;
  artifactId?: string;
  agentIds: string[];
  objectVersion: number;
  at: number;
  outcome?: FeedbackOutcome;
}
