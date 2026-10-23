import { defineRuntimeRepository } from '../../contracts/runtime-store.ts';
import type { CompletedFeedbackFact, Friendship, FriendshipInvitation } from './types.ts';
import type {InvitationPage,RelationshipPage} from './queries.ts';

export interface RelationshipsRepository {
  /** Canonical transaction lock. Application locks the WS03 pair first to serialize block/accept. */
  lockPair(firstAgentId: string, secondAgentId: string): Promise<void>;
  getFriendship(id: string): Promise<Friendship | undefined>;
  getFriendshipForPair(firstAgentId: string, secondAgentId: string): Promise<Friendship | undefined>;
  getPendingInvitation(firstAgentId: string, secondAgentId: string): Promise<FriendshipInvitation | undefined>;
  getInvitation(id: string): Promise<FriendshipInvitation | undefined>;
  saveInvitation(value: FriendshipInvitation, expectedVersion: number | null): Promise<void>;
  saveFriendship(value: Friendship, expectedVersion: number | null): Promise<void>;
  /** Candidates only: the service still checks every current public/member/pair/sharing permission. */
  listInvitations(agentId: string, options: InvitationPage): Promise<FriendshipInvitation[]>;
  listConfirmed(agentId: string, options: RelationshipPage): Promise<Friendship[]>;
  /** The trusted WS03 close hook uses this same transaction. No historical scan, nested store or source writes. */
  recordCompletedFeedback(fact: CompletedFeedbackFact): Promise<{ changed: boolean; friendship: Friendship | null }>;
}
export type RelationshipsReader = Pick<RelationshipsRepository, 'getFriendship' | 'getFriendshipForPair' | 'getPendingInvitation' | 'getInvitation' | 'listInvitations' | 'listConfirmed'>;
export const RELATIONSHIPS_REPOSITORY = defineRuntimeRepository<RelationshipsReader, RelationshipsRepository>('relationships');
