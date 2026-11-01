import type {JsonObject,StoredRow} from '../../contracts/store.ts';
import {fail} from '../common/errors.ts';
export type WorldActionMode='autonomous'|'manual'|'observe';
export type WorldActionPolicy=Readonly<{version:number;mode:WorldActionMode;updatedAt:number|null;actionVersion?:number;actionUpdatedAt?:number|null}>;
export const WORLD_PARTICIPATION_CONTRACT=Object.freeze({version:2,modes:['autonomous','manual','observe'],legacyReadOnlyMode:'observe',schedulingVersion:1,adoptionPolicyVersionField:'expectedPolicyVersion',serverControlsJob:false});
/** Frozen capability list: adding a module/action never grants autonomy by prefix. */
export const AUTONOMOUS_WORLD_ACTIONS:readonly string[]=Object.freeze([
 // Private final account only; its service checks runtime authority, not World action mode.
 'behavior.journal.submit',
 'world.expression.say','world.expression.emote',
 'world.membership.join','world.membership.leave','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop','world.idle.step',
 'relationships.invitation.send','relationships.invitation.accept','relationships.invitation.decline','relationships.invitation.cancel',
 'interaction.artifact.create','interaction.artifact.withdraw','interaction.invitation.send','interaction.invitation.accept','interaction.invitation.decline','interaction.invitation.withdraw',
 'interaction.activity.submit_feedback','interaction.activity.close','interaction.activity.leave','interaction.feedback.withdraw','interaction.policy.block','interaction.policy.unblock',
 'decision.claim','decision.respond','perception.agent_read.confirm',
 'relationships.gifts.offer','relationships.gifts.respond','relationships.gifts.withdraw',
 'life.activities.start','life.activities.cancel','life.plans.submit','life.plans.cancel',
 'town_services.npc.greet','town_services.welcome.claim','town_services.tavern.redeem','town_services.inn.rest.start','town_services.inn.rest.cancel',
]);
export function worldActionPolicy(agent:StoredRow):WorldActionPolicy {
 const value=agent.data.worldActionPolicy;
 if(value===undefined||value===null)return Object.freeze({version:0,mode:'autonomous',updatedAt:null});
 if(typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.version)||Number(value.version)<1||!['autonomous','manual','observe'].includes(String(value.mode))||!Number.isSafeInteger(value.updatedAt)||Number(value.updatedAt)<0)
  fail('world_action_policy_unavailable',503,'Stored world action policy is invalid');
 if(value.actionVersion!==undefined&&(!Number.isSafeInteger(value.actionVersion)||Number(value.actionVersion)<0||Number(value.actionVersion)>Number(value.version)||!(value.actionUpdatedAt===null||Number.isSafeInteger(value.actionUpdatedAt)&&Number(value.actionUpdatedAt)>=0&&Number(value.actionUpdatedAt)<=Number(value.updatedAt)))||value.actionVersion===undefined&&value.actionUpdatedAt!==undefined)fail('world_action_policy_unavailable',503,'Stored world action authority is invalid');
 return Object.freeze({version:Number(value.version),mode:value.mode as WorldActionMode,updatedAt:Number(value.updatedAt),...(value.actionVersion===undefined?{}:{actionVersion:Number(value.actionVersion),actionUpdatedAt:value.actionUpdatedAt as number|null})});
}
export function worldActionPolicyView(agent:StoredRow,asOf:number):JsonObject {return {agentId:agent.id,...worldActionPolicy(agent),source:'current',asOf};}
/** Scheduling intent is independent of business authorization. Legacy observe stays read-only. */
export function worldActionsEnabled(policy:WorldActionPolicy):boolean {return policy.mode==='autonomous'||policy.mode==='manual';}
/** Preserve the exact legacy authority shape/hash across scheduling-only edits. */
export function worldActionAuthority(policy:WorldActionPolicy):Readonly<{version:number;mode:'autonomous'|'observe';updatedAt:number|null}>{return {version:policy.actionVersion??policy.version,mode:policy.mode==='observe'?'observe':'autonomous',updatedAt:policy.actionUpdatedAt===undefined?policy.updatedAt:policy.actionUpdatedAt};}
export function hostSchedulingIntent(policy:WorldActionPolicy,intervalSeconds:unknown):JsonObject {
 return {version:1,mode:policy.mode,policyVersion:policy.version,effectiveState:policy.mode==='autonomous'&&intervalSeconds!==null?'on':'off',reason:policy.mode==='manual'?'manual':policy.mode==='observe'?'legacy_observe':intervalSeconds===null?'interval_stopped':'autonomous_interval',source:'server_intent',serverControlsJob:false};
}
export function assertWorldActionAllowed(policy:WorldActionPolicy,action:string):void {
 if(!AUTONOMOUS_WORLD_ACTIONS.includes(action))fail('world_action_not_allowed',403,'This action has no autonomous world permission');
 if(!worldActionsEnabled(policy))fail('world_action_observe_only',403,'The Agent is in observe mode');
}
