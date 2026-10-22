import type { ArtifactRef, ArtifactRevision, FeedbackActivity, FeedbackConfiguration, FeedbackContribution, InteractionInvitation, InteractionPairPolicy } from './types.ts';
import { defineRuntimeRepository } from '../../contracts/runtime-store.ts';

/** B implements these named ports; business code does not query another domain's tables. */
export interface InteractionRepository {
  initializeConfiguration(configuration: FeedbackConfiguration): Promise<void>;
  getConfiguration(version: number): Promise<FeedbackConfiguration | undefined>;
  getArtifact(ref: ArtifactRef): Promise<ArtifactRevision | undefined>;
  /** Author-scoped source enumeration, including unsent/withdrawn revisions; application owns current visibility. */
  listArtifacts(authorAgentId: string, options: { after?: ArtifactRef; limit: number }): Promise<ArtifactRevision[]>;
  saveArtifact(artifact: ArtifactRevision, expectedVersion: number | null): Promise<void>;
  lockPair(firstAgentId: string, secondAgentId: string): Promise<InteractionPairPolicy>;
  getPair(firstAgentId: string, secondAgentId: string): Promise<InteractionPairPolicy | undefined>;
  savePair(policy: InteractionPairPolicy, expectedVersion: number): Promise<void>;
  getInvitation(id: string): Promise<InteractionInvitation | undefined>;
  saveInvitation(invitation: InteractionInvitation, expectedVersion: number | null): Promise<void>;
  findActiveInvitation(worldId: string, fromAgentId: string, toAgentId: string, artifact: ArtifactRef, sharedGeneration: number, participantGenerations: { from: number; to: number }): Promise<InteractionInvitation | undefined>;
  getActivity(id: string): Promise<FeedbackActivity | undefined>;
  getActivityByInvitation(invitationId: string): Promise<FeedbackActivity | undefined>;
  saveActivity(activity: FeedbackActivity, expectedVersion: number | null): Promise<void>;
  getFeedback(id: string): Promise<FeedbackContribution | undefined>;
  saveFeedback(feedback: FeedbackContribution, expectedVersion: number | null): Promise<void>;
  /** Bounded stable ID enumeration; C computes current effective state/visibility. */
  listInvitations(agentId: string, options: { afterId?: string; artifact?: ArtifactRef; limit: number }): Promise<InteractionInvitation[]>;
}
export type InteractionReader = Pick<InteractionRepository, 'getConfiguration' | 'getArtifact' | 'listArtifacts' | 'getPair' | 'getInvitation' | 'getActivity' | 'getActivityByInvitation' | 'getFeedback' | 'listInvitations'>;
export const INTERACTION_REPOSITORY = defineRuntimeRepository<InteractionReader, InteractionRepository>('interaction');
