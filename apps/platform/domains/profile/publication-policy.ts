import type {JsonObject} from '../../contracts/store.ts';
import {fail} from '../common/errors.ts';
export type ProfileWriteActor='agent'|'owner';
type Participation={state?:unknown;ownerPaused?:unknown;platformRestricted?:unknown};
/** Shared original profile business guards; world action mode is deliberately independent. */
export function assertProfileBusinessWrite(member:Participation,actor:ProfileWriteActor):void{
 if(actor==='agent'&&member.ownerPaused)fail('participation_paused',403,'Owner paused platform participation');
 if(member.platformRestricted)fail('platform_restricted',403,'Platform participation is restricted');
}
export function assertProfilePublicationMode(profile:JsonObject,actor:ProfileWriteActor):void{
 if(actor==='agent'&&profile.mode!=='agent_autonomous')fail('confirmation_required',403,'当前形象策略要求主人确认。');
}
export function assertProfileDirectSave(profile:JsonObject,member:Participation,actor:ProfileWriteActor):void{
 assertProfileBusinessWrite(member,actor);assertProfilePublicationMode(profile,actor);
 if(member.state!=='joined'||actor==='agent'&&profile.published===null)fail('role_not_public',409,'Restore the explicit public role before using direct save',{membershipState:typeof member.state==='string'?member.state:null,published:profile.published!==null});
}
export function assertProfilePublicationFields(profile:JsonObject,actor:ProfileWriteActor,fields:readonly string[]):void{
 assertProfilePublicationMode(profile,actor);
 if(actor==='agent'){
  if(!Array.isArray(profile.lockedFields)||!profile.lockedFields.every(x=>typeof x==='string'))fail('profile_policy_unavailable',503,'当前资料字段权限不可用。');
  if(fields.some(field=>(profile.lockedFields as string[]).includes(field)))fail('field_locked',403,'主人已锁定当前资料字段。');
 }
}
