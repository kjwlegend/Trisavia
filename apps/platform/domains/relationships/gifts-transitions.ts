import type {Principal} from '../access/public.ts';
import type {LifeQualification} from '../life/types.ts';
import type {RelationshipGift,GiftState} from './gifts-types.ts';
import {fail} from '../common/errors.ts';
function terminal(g:RelationshipGift,state:Exclude<GiftState,'pending'>,now:number,code:string,recipientQualification:LifeQualification|null=null):RelationshipGift{
 if(g.state!=='pending')return g;if(!Number.isSafeInteger(now)||now<g.createdAt)fail('invalid_request',400,'A real source time is required');
 return {...g,version:g.version+1,state,resolvedAt:now,resultId:g.id,sourceEventId:'relationship-gift-result:'+g.id,acceptedByAgentId:state==='accepted'?g.toAgentId:null,recipientQualification,stopCode:code};
}
/** Current pair/participation/credential checks belong to the application in the original same transaction. */
export function respondToGift(g:RelationshipGift,p:Principal,decision:'accept'|'decline',now:number,qualification:LifeQualification|null):RelationshipGift{
 if(p.kind!=='agent'||p.agentId!==g.toAgentId)fail('agent_identity_required',403,'Only the actual recipient Agent can respond to this gift');
 if(g.state!=='pending')return g;if(now>=g.deadlineAt)fail('gift_expired',410,'The original gift deadline has passed');
 if(decision==='accept'&&(!qualification||qualification.authority.agentId!==g.toAgentId||qualification.authority.credentialId!==p.credentialId))fail('gift_authority_changed',403,'Acceptance needs this actual recipient credential and current permission');
 return terminal(g,decision==='accept'?'accepted':'declined',now,decision==='accept'?'accepted':'recipient_declined',decision==='accept'?qualification:null);
}
export function withdrawGift(g:RelationshipGift,p:Principal,now:number):RelationshipGift{if(p.kind!=='agent'||p.agentId!==g.fromAgentId)fail('agent_identity_required',403,'Only the actual sender Agent can withdraw this gift');return terminal(g,'withdrawn',now,'sender_withdrew');}
export function expireGift(g:RelationshipGift,now:number):RelationshipGift{if(g.state!=='pending')return g;if(now<g.deadlineAt)fail('gift_not_due',409,'The gift has not reached its real deadline');return terminal(g,'expired',now,'gift_expired');}
/** No Agent credential is borrowed for system cleanup, and cleanup can never accept/deliver. */
export function invalidateGift(g:RelationshipGift,now:number):RelationshipGift{return terminal(g,'unavailable',now,'gift_no_longer_available');}
