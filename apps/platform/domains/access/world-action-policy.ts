import type {JsonObject,StoredRow} from '../../contracts/store.ts';
import {fail} from '../common/errors.ts';
export type WorldActionMode='autonomous'|'observe';
export type WorldActionPolicy=Readonly<{version:number;mode:WorldActionMode;updatedAt:number|null}>;
/** Frozen capability list: adding a module/action never grants autonomy by prefix. */
export const AUTONOMOUS_WORLD_ACTIONS:readonly string[]=Object.freeze([
 'world.membership.join','world.membership.leave','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop','world.idle.step',
 'relationships.invitation.send','relationships.invitation.accept','relationships.invitation.decline','relationships.invitation.cancel',
 'interaction.artifact.create','interaction.artifact.withdraw','interaction.invitation.send','interaction.invitation.accept','interaction.invitation.decline','interaction.invitation.withdraw',
 'interaction.activity.submit_feedback','interaction.activity.close','interaction.activity.leave','interaction.feedback.withdraw','interaction.policy.block','interaction.policy.unblock',
 'decision.claim','decision.respond','perception.agent_read.confirm',
 'town_services.npc.greet','town_services.welcome.claim','town_services.tavern.redeem','town_services.inn.rest.start','town_services.inn.rest.cancel',
]);
export function worldActionPolicy(agent:StoredRow):WorldActionPolicy {
 const value=agent.data.worldActionPolicy;
 if(value===undefined||value===null)return Object.freeze({version:0,mode:'autonomous',updatedAt:null});
 if(typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.version)||Number(value.version)<1||!['autonomous','observe'].includes(String(value.mode))||!Number.isSafeInteger(value.updatedAt)||Number(value.updatedAt)<0)
  fail('world_action_policy_unavailable',503,'Stored world action policy is invalid');
 return Object.freeze({version:Number(value.version),mode:value.mode as WorldActionMode,updatedAt:Number(value.updatedAt)});
}
export function worldActionPolicyView(agent:StoredRow,asOf:number):JsonObject {return {agentId:agent.id,...worldActionPolicy(agent),source:'current',asOf};}
export function assertWorldActionAllowed(policy:WorldActionPolicy,action:string):void {
 if(!AUTONOMOUS_WORLD_ACTIONS.includes(action))fail('world_action_not_allowed',403,'This action has no autonomous world permission');
 if(policy.mode!=='autonomous')fail('world_action_observe_only',403,'The Agent is in observe mode');
}
