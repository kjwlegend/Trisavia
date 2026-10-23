import type {RuntimeEvent,RuntimeTransaction,RuntimeSource,RuntimeActor} from '../../contracts/runtime-store.ts';
import type {BehaviorNode,BehaviorObservationAccess,BehaviorPublicProjection,BehaviorRecordDraft,BehaviorScope} from './types.ts';
import {BEHAVIOR_REPOSITORY} from './repository.ts';
import type {RuntimeReadContext} from '../../contracts/runtime-store.ts';
export async function behaviorEnabled(context:RuntimeReadContext,scope:BehaviorScope,occurredAt=context.now()):Promise<boolean>{return (await context.repository(BEHAVIOR_REPOSITORY).getCoverage()).some(c=>c.scope===scope&&occurredAt>=c.fromAt);}
/** Explicit source declaration. The original event audience is never broadened. */
export async function recordBehaviorSource(context:RuntimeTransaction,observation:BehaviorObservationAccess<RuntimeReadContext>|undefined,input:{event:RuntimeEvent;scope:BehaviorScope;sourceRef:BehaviorRecordDraft['sourceRef'];perspectives:{agentId:string;node:BehaviorNode;publicProjection?:BehaviorPublicProjection|null}[];initiator?:RuntimeActor;origin?:RuntimeSource}):Promise<void>{
 if(!await behaviorEnabled(context,input.scope,input.event.occurredAt))return;
 if(input.perspectives.length>2)throw new Error('Behavior source exceeds its bounded perspectives');
 const domain=input.scope.startsWith('world_')?'world':input.scope as 'relationships'|'interaction',repo=context.repository(BEHAVIOR_REPOSITORY);
 for(const view of input.perspectives){const ownerAudience=await observation?.capture(context,view.agentId,domain)??null;
  await repo.append({scope:input.scope,sourceDomain:domain,sourceEventId:input.event.eventId,sourceRef:{...input.sourceRef},node:view.node,agentId:view.agentId,occurredAt:input.event.occurredAt,recordedAt:context.now(),causationId:input.event.causationId,correlationId:input.event.correlationId,initiator:input.initiator??input.event.actor,executor:input.event.actor,origin:input.origin??input.event.source,ownerAudience,publicProjection:view.publicProjection??null});
 }
}
