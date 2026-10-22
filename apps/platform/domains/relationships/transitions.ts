import type { RuntimeActor } from '../../contracts/runtime-store.ts';
import { fail } from '../common/errors.ts';
import { FRIENDSHIP_POLICY_V1, type Friendship, type FriendshipInvitation } from './types.ts';

function identifier(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.includes('\0')) fail('invalid_request', 400, 'Invalid friendship identity'); return value;
}
function time(value: number): number { if (!Number.isSafeInteger(value) || value < 0) fail('invalid_request', 400, 'Invalid friendship time'); return value; }
function generation(value: number, minimum: number): void { if (!Number.isSafeInteger(value) || value < minimum) fail('invalid_request', 400, 'Invalid friendship generation'); }
function actor(value: RuntimeActor, effectiveAgentId: string): void {
  identifier(value.id); if (!['agent', 'owner'].includes(value.kind) || value.kind === 'agent' && value.id !== effectiveAgentId) fail('target_not_accessible', 404, 'Friendship is not accessible');
}
export function canonicalFriendshipPair(first: string, second: string): [string, string] {
  identifier(first); identifier(second); if (first === second) fail('invalid_request', 400, 'A friendship requires another Agent'); return first < second ? [first, second] : [second, first];
}
export function makeFriendshipInvitation(input: { id: string; fromAgentId: string; toAgentId: string; message: unknown; sentBy: RuntimeActor; senderConfirmationId: string; sharedGeneration: number; participantGenerations: { from: number; to: number }; now: number }): FriendshipInvitation {
  canonicalFriendshipPair(input.fromAgentId, input.toAgentId); identifier(input.id); identifier(input.senderConfirmationId); actor(input.sentBy, input.fromAgentId); time(input.now);
  generation(input.sharedGeneration, 0); generation(input.participantGenerations.from, 1); generation(input.participantGenerations.to, 1);
  const message = input.message ?? '';
  if (typeof message !== 'string' || [...message].length > FRIENDSHIP_POLICY_V1.maxMessageCodePoints || message.includes('\0')) fail('invalid_request', 400, 'The friendship message exceeds 120 code points');
  const deadline = input.now + FRIENDSHIP_POLICY_V1.invitationSeconds * 1000; time(deadline);
  return { id: input.id, version: 1, fromAgentId: input.fromAgentId, toAgentId: input.toAgentId, message, state: 'pending', createdAt: input.now, deadline, respondedAt: null, friendshipId: null,
    sentBy: { ...input.sentBy }, respondedBy: null, senderConfirmationId: input.senderConfirmationId, responseConfirmationId: null, invalidationCode: null, sharedGeneration: input.sharedGeneration, participantGenerations: { ...input.participantGenerations } };
}
interface Response { effectiveAgentId: string; actor: RuntimeActor; confirmationId: string; now: number }
function pending(invitation: FriendshipInvitation, input: Response, expectedActor: string): void {
  actor(input.actor, input.effectiveAgentId); identifier(input.confirmationId); time(input.now);
  if (input.effectiveAgentId !== expectedActor) fail('target_not_accessible', 404, 'Friendship is not accessible');
  if (input.now >= invitation.deadline) fail('friendship_expired', 410, 'The friendship invitation expired');
  if (invitation.state !== 'pending') fail('friendship_state_conflict', 409, 'The friendship invitation is no longer pending');
  if (input.now < invitation.createdAt) fail('invalid_request', 400, 'Friendship time moved backwards');
}
function responded(invitation: FriendshipInvitation, input: Response, state: 'accepted' | 'declined' | 'cancelled'): FriendshipInvitation {
  return { ...invitation, version: invitation.version + 1, state, respondedAt: input.now, respondedBy: { ...input.actor }, responseConfirmationId: input.confirmationId };
}
export function acceptFriendshipInvitation(invitation: FriendshipInvitation, input: Response & { friendshipId: string }): { invitation: FriendshipInvitation; friendship: Friendship } {
  pending(invitation, input, invitation.toAgentId); identifier(input.friendshipId);
  const [firstAgentId, secondAgentId] = canonicalFriendshipPair(invitation.fromAgentId, invitation.toAgentId);
  const senderProof = invitation.id + ':send:' + invitation.senderConfirmationId, responseProof = invitation.id + ':accept:' + input.confirmationId;
  return { invitation: { ...responded(invitation, input, 'accepted'), friendshipId: input.friendshipId }, friendship: { id: input.friendshipId, version: 1, firstAgentId, secondAgentId, status: 'confirmed', confirmedAt: input.now,
    firstConfirmationId: firstAgentId === invitation.fromAgentId ? senderProof : responseProof, secondConfirmationId: secondAgentId === invitation.toAgentId ? responseProof : senderProof, intimacyScore: FRIENDSHIP_POLICY_V1.initialIntimacy } };
}
export function declineFriendshipInvitation(invitation: FriendshipInvitation, input: Response): FriendshipInvitation { pending(invitation, input, invitation.toAgentId); return responded(invitation, input, 'declined'); }
export function cancelFriendshipInvitation(invitation: FriendshipInvitation, input: Response): FriendshipInvitation { pending(invitation, input, invitation.fromAgentId); return responded(invitation, input, 'cancelled'); }
export function expireFriendshipInvitation(invitation: FriendshipInvitation, now: number): FriendshipInvitation {
  time(now); return invitation.state === 'pending' && now >= invitation.deadline ? { ...invitation, version: invitation.version + 1, state: 'expired', respondedAt: now } : invitation;
}
export function invalidateFriendshipInvitation(invitation: FriendshipInvitation, input: { now: number; code?: string }): FriendshipInvitation {
  time(input.now); if(invitation.state!=='pending') return invitation;
  const code=input.code??'qualification_changed'; if(!/^[a-z][a-z0-9_]{0,99}$/.test(code))fail('invalid_request',400,'Invalid friendship invalidation');
  return { ...invitation,version:invitation.version+1,state:'cancelled',respondedAt:input.now,respondedBy:{kind:'system',id:'relationships-invalidation'},responseConfirmationId:null,invalidationCode:code };
}
