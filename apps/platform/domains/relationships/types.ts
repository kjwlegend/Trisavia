import type { RuntimeActor } from '../../contracts/runtime-store.ts';

export const FRIENDSHIP_POLICY_V1 = Object.freeze({ version: 1, invitationSeconds: 604800, maxMessageCodePoints: 120, initialIntimacy: 0, maxIntimacy: 100 });
export type FriendshipInvitationState = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export interface FriendshipInvitation {
  id: string; version: number; fromAgentId: string; toAgentId: string; message: string; state: FriendshipInvitationState;
  createdAt: number; deadline: number; respondedAt: number | null; friendshipId: string | null;
  sentBy: RuntimeActor; respondedBy: RuntimeActor | null; senderConfirmationId: string; responseConfirmationId: string | null;
  invalidationCode: string | null;
  sharedGeneration: number; participantGenerations: { from: number; to: number };
}
export interface Friendship {
  id: string; version: number; firstAgentId: string; secondAgentId: string; status: 'confirmed' | 'revoked';
  confirmedAt: number; firstConfirmationId: string; secondConfirmationId: string; intimacyScore: number;
}
/** Internal WS03 completion hook only. Never accepted as an external scoring command. */
export interface CompletedFeedbackFact {
  activityId: string; fromAgentId: string; toAgentId: string; invitationCreatedAt: number; completedAt: number;
}
export interface IntimacyFact extends CompletedFeedbackFact {
  friendshipId: string; sourceDomain: 'interaction'; scoreKind: 'text_feedback_completed'; delta: 0 | 1;
}
