import {BEHAVIOR_REPOSITORY} from '../domains/behavior/repository.ts';
import {recordBehaviorSource} from '../domains/behavior/sources.ts';
import type {BehaviorObservationAccess,BehaviorRecord,BehaviorNode} from '../domains/behavior/types.ts';
import {assertWorldActionAllowed} from '../domains/access/world-action-policy.ts';
import { randomUUID } from 'node:crypto';
import {createInteractionOwnerReader} from './interaction-owner-read.ts';
import type { CommandKey, CommandReceipt, RuntimeReadContext, RuntimeTransaction, RuntimeEvent, RuntimeTask } from '../contracts/runtime-store.ts';
import type { JsonObject } from '../contracts/store.ts';
import type { IdentityAccess, Principal } from '../domains/access/public.ts';
import { fail, M1Error, object, version } from '../domains/common/errors.ts';
import type { DecisionIntentSink, DecisionOrigin, DecisionTarget } from '../domains/decision/public.ts';
import type { DecisionRequest } from '../domains/decision/repository.ts';
import { createInteractionCursor } from '../domains/interaction/cursor.ts';
import { INTERACTION_REPOSITORY } from '../domains/interaction/repository.ts';
import { activityExpired, artifactReference, assertConfiguration, identifier, invitationExpired, pairIds, plainText, sharedAccess } from '../domains/interaction/rules.ts';
import { acceptInvitation, closeActivity, declineInvitation, expireActivity, expireInvitation, leaveActivity, makeInvitation, submitFeedback, withdrawInvitation } from '../domains/interaction/transitions.ts';
import { TEXT_FEEDBACK_V1, type ArtifactRevision, type FeedbackActivity, type FeedbackConfiguration, type FeedbackContribution, type InteractionDecisionIntent, type InteractionInvitation } from '../domains/interaction/types.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../domains/runtime/command.ts';

export async function bootstrapInteraction(context: RuntimeTransaction, configuration: FeedbackConfiguration = structuredClone(TEXT_FEEDBACK_V1)): Promise<void> {
  assertConfiguration(configuration); await context.repository(INTERACTION_REPOSITORY).initializeConfiguration(configuration);
  if (await context.tasks.currentGeneration('interaction') === 0) await context.tasks.advanceGeneration('interaction', 0);
}
const fields: Record<string, string[]> = {
  'interaction.artifact.create': ['body', 'title'], 'interaction.artifact.withdraw': ['artifact', 'expectedVersion'],
  'interaction.invitation.send': ['worldId', 'toAgentId', 'artifact', 'expectedArtifactVersion', 'templateVersion', 'configVersion', 'intent'],
  'interaction.invitation.accept': ['invitationId', 'expectedVersion'], 'interaction.invitation.decline': ['invitationId', 'expectedVersion', 'reason'],
  'interaction.invitation.withdraw': ['invitationId', 'expectedVersion'], 'interaction.activity.submit_feedback': ['activityId', 'expectedVersion', 'body'],
  'interaction.activity.close': ['activityId', 'expectedVersion'], 'interaction.activity.leave': ['activityId', 'expectedVersion', 'reason'],
  'interaction.feedback.withdraw': ['feedbackId', 'expectedVersion'], 'interaction.policy.block': ['agentId', 'expectedVersion'], 'interaction.policy.unblock': ['agentId', 'expectedVersion'],
};
function absent(): never { fail('target_not_accessible', 404, 'Target is not accessible'); }
function expected(value: unknown, actual: number): void { if (version(value) !== actual) fail('version_conflict', 409, 'The interaction object has changed'); }
function origin(key: CommandKey): DecisionOrigin { return { actor: key.principal, source: key.principal.kind === 'system' ? 'rules' : 'external_agent', commandId: key.commandId, correlationId: key.commandId }; }
function reason(id: string, stage: string): string { return id + ':' + stage; }
function safeInvitation(invitation: InteractionInvitation, now: number): JsonObject {
  return { invitationId: invitation.id, version: invitation.version, worldId: invitation.worldId, fromAgentId: invitation.fromAgentId, toAgentId: invitation.toAgentId,
    artifact: { artifactId: invitation.artifact.artifactId, revision: invitation.artifact.revision }, state: invitationExpired(invitation, now) ? 'expired' : invitation.state,
    createdAt: invitation.createdAt, deadline: invitation.deadline, respondedAt: invitation.respondedAt, activityId: invitation.activityId,
    templateVersion: invitation.configuration.templateVersion, configVersion: invitation.configuration.configVersion };
}
function safeActivity(activity: FeedbackActivity, now: number): JsonObject {
  return { activityId: activity.id, invitationId: activity.invitationId, version: activity.version, state: activityExpired(activity, now) ? 'expired' : activity.state,
    outcome: activity.outcome, acceptedAt: activity.acceptedAt, feedbackDeadline: activity.feedbackDeadline, acknowledgementDeadline: activity.acknowledgementDeadline,
    feedbackId: activity.feedbackId, endedAt: activity.endedAt, endedByAgentId: activity.endedByAgentId };
}
export interface CompletedTextFeedback {activityId:string;fromAgentId:string;toAgentId:string;invitationCreatedAt:number;completedAt:number}
export function createInteractionService(identity: IdentityAccess<RuntimeReadContext>, decisions: DecisionIntentSink,hooks:{observation?:BehaviorObservationAccess<RuntimeReadContext>;onCompletedFeedback?:(context:RuntimeTransaction,fact:CompletedTextFeedback)=>Promise<void>}={}) {
  const cursors = createInteractionCursor();
  async function actor(context: RuntimeReadContext, principal: Principal): Promise<string> {
    if (principal.kind !== 'agent') fail('agent_identity_required', 403, 'This action requires the Agent identity');
    await identity.authorizeAgent(context, principal, principal.agentId); return principal.agentId;
  }
  async function participant(context: RuntimeReadContext, agentId: string, worldId?: string, writing = false) {
    const status = await identity.readParticipation(context, agentId);
    if (!status.runtimeActive || status.membership.state !== 'joined' || status.membership.platformRestricted || worldId !== undefined && status.membership.worldId !== worldId) absent();
    if (writing && status.membership.ownerPaused) fail('participation_paused', 403, 'Agent participation is paused'); return status;
  }
  async function ownArtifact(context: RuntimeReadContext, agentId: string, input: unknown): Promise<ArtifactRevision> {
    const artifact = await context.repository(INTERACTION_REPOSITORY).getArtifact(artifactReference(input));
    if (!artifact || artifact.authorAgentId !== agentId) absent(); return artifact;
  }
  async function bundle(context: RuntimeReadContext, agentId: string, invitationId: string, lock = false) {
    const repository = context.repository(INTERACTION_REPOSITORY), invitation = await repository.getInvitation(invitationId);
    if (!invitation || ![invitation.fromAgentId, invitation.toAgentId].includes(agentId)) absent();
    const [a, b] = pairIds(invitation.fromAgentId, invitation.toAgentId);
    // On writes the adapter serializes both possible invitation accept/block orderings on this pair.
    const policy = lock ? await (context as RuntimeTransaction).repository(INTERACTION_REPOSITORY).lockPair(a, b) : await repository.getPair(a, b);
    const from = await participant(context, invitation.fromAgentId, invitation.worldId), to = await participant(context, invitation.toAgentId, invitation.worldId);
    if (!sharedAccess(invitation, policy) || from.membership.sharingGeneration !== invitation.participantGenerations.from || to.membership.sharingGeneration !== invitation.participantGenerations.to) absent();
    const artifact = await repository.getArtifact(invitation.artifact); if (!artifact || artifact.withdrawnAt !== null) absent();
    return { invitation, artifact, activity: await repository.getActivityByInvitation(invitation.id) };
  }
  async function activityBundle(context: RuntimeReadContext, agentId: string, activityId: string, lock = false) {
    const activity = await context.repository(INTERACTION_REPOSITORY).getActivity(activityId); if (!activity) absent();
    const result = await bundle(context, agentId, activity.invitationId, lock);
    if (!result.activity || result.activity.id !== activityId || result.invitation.activityId !== activityId) absent(); return { ...result, activity: result.activity };
  }
  async function currentFeedback(context: RuntimeReadContext, activity: FeedbackActivity): Promise<FeedbackContribution | undefined> {
    if (!activity.feedbackId) return undefined; return context.repository(INTERACTION_REPOSITORY).getFeedback(activity.feedbackId);
  }
  async function visibleFeedback(context: RuntimeReadContext, activity: FeedbackActivity): Promise<FeedbackContribution | undefined> {
    const feedback = await currentFeedback(context, activity); return feedback?.withdrawnAt === null ? feedback : undefined;
  }
  async function emit(context: RuntimeTransaction, key: CommandKey, kind: string, subject: { type: string; id: string; version: number }, agentIds: string[], payload: JsonObject, worldId?: string): Promise<string[]> {
    const eventId = randomUUID();
    const event=await context.events.append({ eventId, domain: 'interaction', kind, schemaVersion: 1, subject, ...(worldId ? { worldId } : {}), actor: key.principal,
      source: key.principal.kind === 'system' ? 'rules' : 'external_agent', occurredAt: context.now(), causationId: key.commandId, correlationId: key.commandId,
      audience: { kind: 'agents', agentIds }, payload });
    const nodes:Record<string,BehaviorNode>={'interaction.invitation.accept':'interaction.invitation.accepted','interaction.invitation.decline':'interaction.invitation.declined','interaction.invitation.withdraw':'interaction.invitation.withdrawn','interaction.invitation.expire':'interaction.invitation.expired','interaction.activity.submit_feedback':'interaction.feedback.submitted','interaction.activity.close':'interaction.activity.closed','interaction.activity.leave':'interaction.activity.left','interaction.activity.expire':'interaction.activity.expired'};
    const shared=nodes[kind];if(kind==='interaction.invitation.send'||shared)await recordBehaviorSource(context,hooks.observation,{event,scope:'interaction',sourceRef:{type:subject.type==='invitation'?'interaction_invitation':'interaction_activity',id:subject.id,version:subject.version},perspectives:agentIds.map((agentId,index)=>({agentId,node:shared??(index===0?'interaction.invitation.sent':'interaction.invitation.received')}))});
    await context.outbox.enqueue({ outboxId: randomUUID(), eventId, consumerId: 'interaction-projection', dedupeKey: eventId,
      generation: await context.tasks.currentGeneration('interaction'), dueAt: context.now(), maxAttempts: 5 }); return [eventId];
  }
  function intentFor(invitation: InteractionInvitation, activity?: FeedbackActivity): InteractionDecisionIntent | null {
    if (invitation.state === 'pending') return { deduplicationKey: reason(invitation.id, 'invitation_response'), agentId: invitation.toAgentId, stage: 'invitation_response',
      target: { kind: 'invitation', id: invitation.id, version: invitation.version }, worldId: invitation.worldId, templateVersion: invitation.configuration.templateVersion,
      configVersion: invitation.configuration.configVersion, deadline: invitation.deadline, allowedActions: ['interaction.invitation.accept', 'interaction.invitation.decline'],
      contextRefs: [{ kind: 'invitation', id: invitation.id, version: invitation.version }, { kind: 'artifact', id: invitation.artifact.artifactId, version: invitation.artifact.revision }] };
    if (!activity || !['waiting_feedback', 'waiting_ack'].includes(activity.state)) return null;
    const feedbackStage = activity.state === 'waiting_feedback', stage = feedbackStage ? 'feedback' : 'acknowledgement';
    return { deduplicationKey: reason(activity.id, stage), agentId: feedbackStage ? invitation.toAgentId : invitation.fromAgentId, stage,
      target: { kind: 'activity', id: activity.id, version: activity.version }, worldId: invitation.worldId, templateVersion: invitation.configuration.templateVersion,
      configVersion: invitation.configuration.configVersion, deadline: feedbackStage ? activity.feedbackDeadline : activity.acknowledgementDeadline!,
      allowedActions: feedbackStage ? ['interaction.activity.submit_feedback', 'interaction.activity.leave'] : ['interaction.activity.close', 'interaction.activity.leave'],
      contextRefs: [{ kind: 'invitation', id: invitation.id, version: invitation.version }, { kind: 'activity', id: activity.id, version: activity.version }, { kind: 'artifact', id: invitation.artifact.artifactId, version: invitation.artifact.revision }] };
  }
  async function cancelStages(context: RuntimeTransaction, invitation: InteractionInvitation, activity: FeedbackActivity | undefined, key: CommandKey, code: string): Promise<void> {
    await decisions.cancel(context, invitation.toAgentId, reason(invitation.id, 'invitation_response'), code, origin(key));
    if (activity) {
      await decisions.cancel(context, invitation.toAgentId, reason(activity.id, 'feedback'), code, origin(key));
      await decisions.cancel(context, invitation.fromAgentId, reason(activity.id, 'acknowledgement'), code, origin(key));
    }
  }
  async function nextStage(context: RuntimeTransaction, invitation: InteractionInvitation, activity: FeedbackActivity | undefined, key: CommandKey): Promise<void> {
    await cancelStages(context, invitation, activity, key, 'stage_advanced');
    const intent = intentFor(invitation, activity); if (intent) await decisions.ensure(context, intent, origin(key));
    const target = activity ?? invitation, dueAt = activity ? activity.state === 'waiting_feedback' ? activity.feedbackDeadline : activity.acknowledgementDeadline : invitation.deadline;
    if (intent && dueAt !== null) await context.tasks.schedule({ taskId: randomUUID(), domain: 'interaction', kind: activity ? 'interaction.activity.expire' : 'interaction.invitation.expire',
      handlerVersion: 1, dedupeKey: target.id + ':' + target.version, target: { type: activity ? 'activity' : 'invitation', id: target.id, version: target.version },
      timeKind: 'utc', dueAt, generation: await context.tasks.currentGeneration('interaction'), maxAttempts: 5, payloadVersion: 1, payload: {} });
  }
  async function authorizeInput(context: RuntimeReadContext, principal: Principal, action: string, input: JsonObject): Promise<string> {
    const id = await actor(context, principal);
    if (action === 'interaction.artifact.withdraw') await ownArtifact(context, id, input.artifact);
    else if (action.startsWith('interaction.invitation.') && action !== 'interaction.invitation.send') await bundle(context, id, identifier(input.invitationId));
    else if (action.startsWith('interaction.activity.')) {
      const value = await activityBundle(context, id, identifier(input.activityId));
      if (value.activity.feedbackId && !await visibleFeedback(context, value.activity) && action !== 'interaction.activity.leave') absent();
    }
    else if (action === 'interaction.feedback.withdraw') {
      const feedback = await context.repository(INTERACTION_REPOSITORY).getFeedback(identifier(input.feedbackId));
      if (!feedback || feedback.authorAgentId !== id) absent(); await activityBundle(context, id, feedback.activityId);
    }
    return id;
  }
  async function execute(context: RuntimeTransaction, principal: Principal, key: CommandKey, input: JsonObject): Promise<CommandReceipt> {
    if (key.domain !== 'interaction' || !fields[key.action] || principal.kind !== 'agent' || key.principal.kind !== 'agent' || key.principal.id !== principal.agentId) fail('invalid_request', 400, 'Invalid interaction command identity');
    object(input, fields[key.action]!);
    return commitRuntimeCommandIn(context, { key, requestHash: hashRuntimeRequest(input), authorize: async current => {
      await authorizeInput(current, principal, key.action, input);
      // Recheck the actor, not a target legitimately withdrawn/blocked by this very command.
      current.validateBeforeCommit(async latest => { await actor(latest, principal); });
    },
      classifyRejection: error => error instanceof M1Error && error.statusCode < 500 ? { outcome: error.statusCode === 409 ? 'conflict' : error.statusCode === 410 ? 'expired' : 'rejected', result: { code: error.code, ...receiptReferences(input) } } : undefined,
      handle: async current => {
        const agentId = principal.agentId, repository = current.repository(INTERACTION_REPOSITORY), now = current.now();
        const qualification = await participant(current, agentId, undefined, true);
        assertWorldActionAllowed(qualification.actionPolicy, key.action);
        current.validateBeforeCommit(async latest => {
          const fresh = await participant(latest, agentId, undefined, true);
          assertWorldActionAllowed(fresh.actionPolicy, key.action);
          if (fresh.runtimeVersion !== qualification.runtimeVersion || fresh.membership.ownerPauseVersion !== qualification.membership.ownerPauseVersion
            || fresh.membership.platformVersion !== qualification.membership.platformVersion || fresh.membership.sharingGeneration !== qualification.membership.sharingGeneration || fresh.actionPolicy.version !== qualification.actionPolicy.version) fail('interaction_qualification_changed', 409, 'Interaction qualification changed before commit');
        });
        if (key.action === 'interaction.artifact.create') {
          const configuration = await repository.getConfiguration(1); if (!configuration) fail('interaction_unavailable', 503, 'Interaction configuration is not initialized');
          const artifact: ArtifactRevision = { artifactId: randomUUID(), revision: 1, version: 1, authorAgentId: agentId,
            title: input.title === undefined ? '' : plainText(input.title, 'title', configuration.maxTitleCodePoints, false), body: plainText(input.body, 'body', configuration.maxArtifactCodePoints), createdAt: now, withdrawnAt: null };
          await repository.saveArtifact(artifact, null); const result = { artifact: { artifactId: artifact.artifactId, revision: artifact.revision }, version: artifact.version, withdrawn: false };
          return { result, eventIds: await emit(current, key, key.action, { type: 'artifact', id: artifact.artifactId, version: artifact.version }, [agentId], result) };
        }
        if (key.action === 'interaction.artifact.withdraw') {
          const artifact = await ownArtifact(current, agentId, input.artifact); expected(input.expectedVersion, artifact.version);
          if (artifact.withdrawnAt !== null) return { result: { artifact: { ...artifactReference(input.artifact) }, version: artifact.version, withdrawn: true }, eventIds: [] };
          const next = { ...artifact, version: artifact.version + 1, withdrawnAt: now }; await repository.saveArtifact(next, artifact.version);
          await current.repository(BEHAVIOR_REPOSITORY).invalidateVisibility([agentId]);let afterId:string|undefined;
          for(;;){const rows=await repository.listInvitations(agentId,{artifact:{artifactId:artifact.artifactId,revision:artifact.revision},limit:100,...(afterId?{afterId}:{})});for(const row of rows)await current.repository(BEHAVIOR_REPOSITORY).invalidateVisibility([row.fromAgentId,row.toAgentId]);if(rows.length<100)break;afterId=rows.at(-1)!.id;}

          const result = { artifact: { artifactId: artifact.artifactId, revision: artifact.revision }, version: next.version, withdrawn: true };
          return { result, eventIds: await emit(current, key, key.action, { type: 'artifact', id: artifact.artifactId, version: next.version }, [agentId], result) };
        }
        if (key.action.startsWith('interaction.policy.')) {
          const target = identifier(input.agentId, 'agentId'); if (target === agentId) fail('invalid_request', 400, 'A pair requires two different Agents');
          await identity.readParticipation(current, target); const [a, b] = pairIds(agentId, target), policy = await repository.lockPair(a, b); expected(input.expectedVersion, policy.version);
          const blocking = key.action.endsWith('.block'), old = policy.blockedByAgentIds.includes(agentId);
          if (blocking === old) return { result: { agentId: target, version: policy.version, blocked: blocking, sharedGeneration: policy.sharedGeneration }, eventIds: [] };
          const next = { ...policy, version: policy.version + 1, blockedByAgentIds: blocking ? [...policy.blockedByAgentIds, agentId].sort() : policy.blockedByAgentIds.filter(id => id !== agentId), sharedGeneration: blocking ? policy.sharedGeneration + 1 : policy.sharedGeneration, updatedAt: now };
          await repository.savePair(next, policy.version); await current.repository(BEHAVIOR_REPOSITORY).invalidateVisibility([agentId,target]); const result = { agentId: target, version: next.version, blocked: blocking, sharedGeneration: next.sharedGeneration };
          return { result, eventIds: await emit(current, key, key.action, { type: 'pair', id: a + ':' + b, version: next.version }, [agentId, target], { sharedGeneration: next.sharedGeneration, invalidated: blocking }) };
        }
        if (key.action === 'interaction.invitation.send') {
          const worldId = identifier(input.worldId, 'worldId'), toAgentId = identifier(input.toAgentId, 'toAgentId');
          const from = await participant(current, agentId, worldId), to = await participant(current, toAgentId, worldId), [a, b] = pairIds(agentId, toAgentId), policy = await repository.lockPair(a, b);
          if (policy.blockedByAgentIds.length) absent(); const artifact = await ownArtifact(current, agentId, input.artifact); expected(input.expectedArtifactVersion, artifact.version);
          const configuration = await repository.getConfiguration(version(input.configVersion, 'configVersion'));
          if (!configuration || version(input.templateVersion, 'templateVersion') !== configuration.templateVersion) fail('version_conflict', 409, 'The feedback configuration is not available');
          const duplicate = await repository.findActiveInvitation(worldId, agentId, toAgentId, artifactReference(input.artifact), policy.sharedGeneration, { from: from.membership.sharingGeneration, to: to.membership.sharingGeneration });
          if (duplicate) fail('interaction_already_active', 409, 'This shared text already has an active invitation');
          const invitation = makeInvitation({ id: randomUUID(), worldId, actorId: agentId, recipientId: toAgentId, artifact, intent: input.intent,
            configuration, sharedGeneration: policy.sharedGeneration, participantGenerations: { from: from.membership.sharingGeneration, to: to.membership.sharingGeneration }, now });
          await repository.saveInvitation(invitation, null); await nextStage(current, invitation, undefined, key); const result = safeInvitation(invitation, now);
          return { result, eventIds: await emit(current, key, key.action, { type: 'invitation', id: invitation.id, version: invitation.version }, [agentId, toAgentId], result, worldId) };
        }
        if (key.action.startsWith('interaction.invitation.')) {
          const { invitation } = await bundle(current, agentId, identifier(input.invitationId), true); expected(input.expectedVersion, invitation.version);
          commitBeforeDeadline(current, invitation.deadline);
          if (key.action.endsWith('.accept')) {
            const accepted = acceptInvitation(invitation, agentId, now, randomUUID());
            await repository.saveInvitation(accepted.invitation, invitation.version); await repository.saveActivity(accepted.activity, null);
            await nextStage(current, accepted.invitation, accepted.activity, key); const result = { ...safeInvitation(accepted.invitation, now), activity: safeActivity(accepted.activity, now) };
            return { result, eventIds: await emit(current, key, key.action, { type: 'invitation', id: invitation.id, version: accepted.invitation.version }, [invitation.fromAgentId, invitation.toAgentId], result, invitation.worldId) };
          }
          const next = key.action.endsWith('.decline') ? declineInvitation(invitation, agentId, now, input.reason) : withdrawInvitation(invitation, agentId, now);
          await repository.saveInvitation(next, invitation.version);if(key.action.endsWith('.withdraw'))await current.repository(BEHAVIOR_REPOSITORY).invalidateVisibility([invitation.fromAgentId,invitation.toAgentId]); await cancelStages(current, next, undefined, key, 'invitation_ended'); const result = safeInvitation(next, now);
          return { result, eventIds: await emit(current, key, key.action, { type: 'invitation', id: invitation.id, version: next.version }, [invitation.fromAgentId, invitation.toAgentId], result, invitation.worldId) };
        }
        const feedbackToWithdraw = key.action === 'interaction.feedback.withdraw' ? await repository.getFeedback(identifier(input.feedbackId)) : undefined;
        const activityId = feedbackToWithdraw?.activityId ?? identifier(input.activityId, 'activityId'), { invitation, activity } = await activityBundle(current, agentId, activityId, true);
        if (key.action === 'interaction.feedback.withdraw') {
          if (!feedbackToWithdraw || feedbackToWithdraw.authorAgentId !== agentId) absent(); expected(input.expectedVersion, feedbackToWithdraw.version);
          if (feedbackToWithdraw.withdrawnAt !== null) return { result: { feedbackId: feedbackToWithdraw.id, activityId, version: feedbackToWithdraw.version, withdrawn: true }, eventIds: [] };
          const next = { ...feedbackToWithdraw, version: feedbackToWithdraw.version + 1, withdrawnAt: now }; await repository.saveFeedback(next, feedbackToWithdraw.version);await current.repository(BEHAVIOR_REPOSITORY).invalidateVisibility([invitation.fromAgentId,invitation.toAgentId]);
          await cancelStages(current, invitation, activity, key, 'feedback_withdrawn'); const result = { feedbackId: next.id, activityId, version: next.version, withdrawn: true };
          return { result, eventIds: await emit(current, key, key.action, { type: 'feedback', id: next.id, version: next.version }, [invitation.fromAgentId, invitation.toAgentId], result, invitation.worldId) };
        }
        expected(input.expectedVersion, activity.version);
        commitBeforeDeadline(current, activity.state === 'waiting_ack' ? activity.acknowledgementDeadline! : activity.feedbackDeadline);
        let next: FeedbackActivity;
        if (key.action.endsWith('.submit_feedback')) {
          const submitted = submitFeedback(invitation, activity, agentId, now, randomUUID(), input.body); await repository.saveFeedback(submitted.feedback, null); next = submitted.activity;
        } else if (key.action.endsWith('.close')) {
          if (!await visibleFeedback(current, activity)) absent(); next = closeActivity(invitation, activity, agentId, now);
        } else next = leaveActivity(invitation, activity, agentId, now, input.reason);
        await repository.saveActivity(next, activity.version);
        if(key.action==='interaction.activity.close'&&next.state==='closed'&&next.outcome==='received_confirmed')await hooks.onCompletedFeedback?.(current,{activityId:next.id,fromAgentId:invitation.fromAgentId,toAgentId:invitation.toAgentId,invitationCreatedAt:invitation.createdAt,completedAt:now});
        await nextStage(current, invitation, next, key); const result = safeActivity(next, now);
        return { result, eventIds: await emit(current, key, key.action, { type: 'activity', id: next.id, version: next.version }, [invitation.fromAgentId, invitation.toAgentId], result, invitation.worldId) };
      } });
  }
  async function readInvitation(context: RuntimeReadContext, principal: Principal, invitationId: string) {
    const agentId = await actor(context, principal), { invitation, artifact, activity } = await bundle(context, agentId, identifier(invitationId));
    const feedback = activity ? await visibleFeedback(context, activity) : undefined;
    return { ...safeInvitation(invitation, context.now()), intent: invitation.intent, configuration: { ...invitation.configuration }, artifact: { ...artifact },
      activity: activity ? safeActivity(activity, context.now()) : null, feedback: feedback ? { ...feedback } : null, asOf: context.now() };
  }
  async function inspect(context: RuntimeReadContext, principal: Principal, request: DecisionRequest) {
    try {
      const agentId = await actor(context, principal); if (agentId !== request.agentId) return null;
      const value = request.target.kind === 'invitation' ? await bundle(context, agentId, request.target.id) : await activityBundle(context, agentId, request.target.id);
      const { invitation, activity } = value;
      if (request.stage === 'invitation_response' && (request.target.kind !== 'invitation' || request.target.id !== invitation.id || agentId !== invitation.toAgentId)
        || request.stage === 'feedback' && (request.target.kind !== 'activity' || agentId !== invitation.toAgentId)
        || request.stage === 'acknowledgement' && (request.target.kind !== 'activity' || agentId !== invitation.fromAgentId)) return null;
      const reasonId = request.stage === 'invitation_response' ? invitation.id : activity?.id;
      if (!reasonId || request.deduplicationKey !== reason(reasonId, request.stage) || request.worldId !== invitation.worldId
        || request.configVersion !== invitation.configuration.configVersion || request.templateVersion !== invitation.configuration.templateVersion) return null;
      if (request.stage === 'acknowledgement' && activity?.feedbackId && !await visibleFeedback(context, activity)) return null;
      const current = intentFor(invitation, activity), status = await participant(context, agentId, invitation.worldId);
      const actionable = status.actionPolicy.mode === 'autonomous' && !status.membership.ownerPaused && current !== null && current.deduplicationKey === request.deduplicationKey
        && current.target.version === request.target.version && current.deadline === request.deadline && current.deadline > context.now();
      const intent: InteractionDecisionIntent = { deduplicationKey: request.deduplicationKey, agentId, stage: request.stage, target: { ...request.target }, worldId: request.worldId,
        templateVersion: request.templateVersion, configVersion: request.configVersion, deadline: request.deadline, allowedActions: [...request.allowedActions], contextRefs: request.contextRefs.map(ref => ({ ...ref })) };
      return { intent, actionable };
    } catch (error) { if (error instanceof M1Error && error.statusCode < 500) return null; throw error; }
  }
  async function handleTask(context: RuntimeTransaction, scheduled: RuntimeTask): Promise<void> {
    if (!scheduled.lease) fail('invalid_task', 400, 'Interaction task requires a current lease');
    const task = await context.tasks.assertLease(scheduled.lease, context.now());
    if (task.domain !== 'interaction' || task.handlerVersion !== 1 || task.payloadVersion !== 1 || !['interaction.invitation.expire', 'interaction.activity.expire'].includes(task.kind) || task.target.type !== (task.kind === 'interaction.invitation.expire' ? 'invitation' : 'activity')) fail('invalid_task', 400, 'Unsupported interaction task');
    const repository = context.repository(INTERACTION_REPOSITORY), systemKey: CommandKey = { domain: 'interaction', action: task.kind, commandId: task.taskId, principal: { kind: 'system', id: 'interaction-expiry' }, recoveryEpoch: context.recoveryEpoch };
    const invitation = task.target.type === 'invitation' ? await repository.getInvitation(task.target.id) : await repository.getActivity(task.target.id).then(async activity => activity ? repository.getInvitation(activity.invitationId) : undefined);
    if (invitation) {
      await repository.lockPair(...pairIds(invitation.fromAgentId, invitation.toAgentId));
      const activity = await repository.getActivityByInvitation(invitation.id), target = task.target.type === 'invitation' ? invitation : activity;
      if (target && target.version === task.target.version && task.dueAt <= context.now()) {
        if (task.target.type === 'invitation') { const next = expireInvitation(invitation, context.now()); if (next !== invitation) { await repository.saveInvitation(next, invitation.version); await cancelStages(context, next, activity, systemKey, 'expired'); await emit(context, systemKey, task.kind, { type: 'invitation', id: next.id, version: next.version }, [next.fromAgentId, next.toAgentId], safeInvitation(next, context.now()), next.worldId); } }
        else if (activity) { const next = expireActivity(activity, context.now()); if (next !== activity) { await repository.saveActivity(next, activity.version); await cancelStages(context, invitation, next, systemKey, 'expired'); await emit(context, systemKey, task.kind, { type: 'activity', id: next.id, version: next.version }, [invitation.fromAgentId, invitation.toAgentId], safeActivity(next, context.now()), invitation.worldId); } }
      }
    }
    // The controlled scheduler completes the lease in this same transaction after this handler returns.
  }
  async function authorizeReceipt(context: RuntimeReadContext, principal: Principal, receipt: CommandReceipt): Promise<void> {
    const agentId = await actor(context, principal);
    if (receipt.key.domain !== 'interaction' || receipt.key.principal.kind !== 'agent' || receipt.key.principal.id !== agentId || !fields[receipt.key.action]) absent();
    await authorizeInput(context, principal, receipt.key.action, receipt.result);
    if (typeof receipt.result.invitationId === 'string') await bundle(context, agentId, receipt.result.invitationId);
    if (receipt.key.action === 'interaction.invitation.send' && receipt.result.artifact) {
      const artifact = await ownArtifact(context, agentId, receipt.result.artifact); if (artifact.withdrawnAt !== null) absent();
      if (typeof receipt.result.toAgentId === 'string') { const policy = await context.repository(INTERACTION_REPOSITORY).getPair(...pairIds(agentId, receipt.result.toAgentId)); if (policy?.blockedByAgentIds.length) absent(); }
    }
  }
  const decisionTarget: DecisionTarget = { inspect, async execute(context, principal, key, action, input) {
    if (key.action !== action) fail('invalid_request', 400, 'Decision action differs from target command'); return execute(context, principal, key, input);
  } };
  async function behaviorSource(context:RuntimeReadContext,record:BehaviorRecord){
    if(record.sourceDomain!=='interaction')return null;
    let invitationId:string;if(record.sourceRef.type==='interaction_invitation')invitationId=record.sourceRef.id;else if(record.sourceRef.type==='interaction_activity'){const activity=await context.repository(INTERACTION_REPOSITORY).getActivity(record.sourceRef.id);if(!activity||activity.version<record.sourceRef.version)return null;invitationId=activity.invitationId;}else return null;
    const source=await bundle(context,record.agentId,invitationId);if(record.sourceRef.type==='interaction_invitation'&&source.invitation.version<record.sourceRef.version)return null;
    if(record.sourceRef.type==='interaction_activity'&&source.activity?.feedbackId&&!await visibleFeedback(context,source.activity))return null;return source;
  }
  async function canObserveBehavior(context:RuntimeReadContext,record:BehaviorRecord,audience:'owner'|'public'){if(audience!=='owner')return false;try{return await behaviorSource(context,record)!==null;}catch(error){if(error instanceof M1Error&&error.statusCode<500)return false;throw error;}}
  async function behaviorDetailRef(context:RuntimeReadContext,record:BehaviorRecord){if(!await canObserveBehavior(context,record,'owner'))return null;const source=await behaviorSource(context,record);return source?{invitationId:source.invitation.id}:null;}
  return { ...createInteractionOwnerReader(identity,{bundle,participant}), execute, inspect, decisionTarget, handleTask, readInvitation, authorizeReceipt,canObserveBehavior,behaviorDetailRef,
    async authorizeEvent(context: RuntimeReadContext, principal: Principal, event: RuntimeEvent) {
      const agentId = await actor(context, principal); if (event.domain !== 'interaction' || !event.audience.agentIds.includes(agentId)) absent();
      if (event.subject.type === 'invitation') await bundle(context, agentId, event.subject.id);
      else if (event.subject.type === 'activity') await activityBundle(context, agentId, event.subject.id);
      else if (event.subject.type === 'artifact') await ownArtifact(context, agentId, event.payload.artifact);
      else if (event.subject.type === 'feedback') { const feedback = await context.repository(INTERACTION_REPOSITORY).getFeedback(event.subject.id); if (!feedback) absent(); await activityBundle(context, agentId, feedback.activityId); }
      else if (event.subject.type !== 'pair') absent();
    },
    async readActivity(context: RuntimeReadContext, principal: Principal, activityId: string) { const agentId = await actor(context, principal), value = await activityBundle(context, agentId, identifier(activityId)); return readInvitation(context, principal, value.invitation.id); },
    async readArtifact(context: RuntimeReadContext, principal: Principal, ref: unknown) { return structuredClone(await ownArtifact(context, await actor(context, principal), ref)); },
    async readPolicy(context: RuntimeReadContext, principal: Principal, target: string) { const agentId = await actor(context, principal); const [a, b] = pairIds(agentId, identifier(target)); const policy = await context.repository(INTERACTION_REPOSITORY).getPair(a, b); return { agentId: target, version: policy?.version ?? 1, blocked: policy?.blockedByAgentIds.includes(agentId) ?? false, sharedGeneration: policy?.sharedGeneration ?? 0, asOf: context.now() }; },
    async listCurrent(context: RuntimeReadContext, principal: Principal, options: { cursor?: string; limit?: number } = {}) {
      const agentId = await actor(context, principal); object(options, ['cursor', 'limit']);
      const limit = options.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || options.cursor !== undefined && typeof options.cursor !== 'string') fail('invalid_request', 400, 'Invalid current-items query');
      const scope = { instanceId: context.instanceId, recoveryEpoch: context.recoveryEpoch, agentId, limit };
      let afterId = options.cursor === undefined ? undefined : cursors.decode(options.cursor, scope, context.now()), scanned = 0, complete = false;
      const repository = context.repository(INTERACTION_REPOSITORY), items: JsonObject[] = [];
      // Hidden rows still advance this internal cut; only encrypted continuations leave the domain.
      while (items.length < limit && scanned < 500 && !complete) {
        const batchSize = Math.min(50, 500 - scanned), candidates = await repository.listInvitations(agentId, { ...(afterId ? { afterId } : {}), limit: batchSize });
        if (!candidates.length) { complete = true; break; }
        for (let index = 0; index < candidates.length; index++) {
          const candidate = candidates[index]!; afterId = candidate.id; scanned++;
          try {
            const value = await bundle(context, agentId, candidate.id);
            items.push({ invitation: safeInvitation(value.invitation, context.now()), activity: value.activity ? safeActivity(value.activity, context.now()) : null });
          } catch (error) {
            if (!(error instanceof M1Error) || error.code !== 'target_not_accessible' || error.statusCode !== 404) throw error;
          }
          if (items.length === limit) { complete = index === candidates.length - 1 && candidates.length < batchSize; break; }
        }
        if (items.length < limit && candidates.length < batchSize) complete = true;
      }
      return { items, asOf: context.now(), scope: 'current-authorized-interactions', complete, nextCursor: !complete && afterId ? cursors.encode(afterId, scope, context.now()) : null };
    },

    async readOwnerSummary(context: RuntimeReadContext, principal: Principal, agentId: string, options: { afterId?: string; limit?: number } = {}) {
      if (principal.kind !== 'owner') fail('owner_identity_required', 403, 'This summary requires the current Owner identity'); await identity.authorizeAgent(context, principal, agentId);
      const limit = options.limit ?? 50; if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid_request', 400, 'Invalid summary limit');
      const rows = await context.repository(INTERACTION_REPOSITORY).listInvitations(agentId, { ...options, limit }), items: JsonObject[] = [];
      for (const row of rows) { const activity = await context.repository(INTERACTION_REPOSITORY).getActivityByInvitation(row.id); items.push({ invitationId: row.id, invitationState: invitationExpired(row, context.now()) ? 'expired' : row.state,
        activityId: activity?.id ?? null, activityState: activity ? activityExpired(activity, context.now()) ? 'expired' : activity.state : null, outcome: activity?.outcome ?? 'no_feedback', createdAt: row.createdAt }); }
      return { agentId, asOf: context.now(), scope: 'own-agent-fact-summary', items, complete: rows.length < limit, nextAfterId: rows.length === limit ? rows.at(-1)!.id : null };
    } };
}

function receiptReferences(input: JsonObject): JsonObject {
  const references: JsonObject = {};
  for (const key of ['artifact', 'invitationId', 'activityId', 'feedbackId', 'toAgentId', 'agentId']) if (input[key] !== undefined) references[key] = input[key]!;
  return references;
}
export async function verifyInteractionReadiness(context: RuntimeReadContext): Promise<void> {
  const configuration = await context.repository(INTERACTION_REPOSITORY).getConfiguration(1);
  if (!configuration || await context.tasks.currentGeneration('interaction') < 1) fail('interaction_unavailable', 503, 'Interaction has not been initialized');
  assertConfiguration(configuration);
}

function commitBeforeDeadline(context: RuntimeTransaction, deadline: number): void {
  context.validateBeforeCommit(async latest => { if (latest.now() >= deadline) fail('interaction_expired', 410, 'The interaction stage deadline passed before commit'); });
}
