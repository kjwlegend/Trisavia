import type {JsonObject} from '../../contracts/store.ts';
import {fail,object} from '../common/errors.ts';
import {APPEARANCE_CATALOG_VERSION,APPEARANCE_LOOKS,DEFAULT_LOOK_ID,LEGACY_HAIR_ORDER} from './appearance-catalog.ts';

export const LEGACY_AVATAR_COLORS=['olive','cream','blue','coral'] as const;
export interface SelectedAvatar extends JsonObject {lookId:string;catalogVersion:string}
export interface LegacyAvatar extends JsonObject {template:'basic';color:string}
export type ProfileAvatar=SelectedAvatar|LegacyAvatar;
export const PROFILE_AVATAR_SCHEMA:JsonObject={oneOf:[{type:'object',additionalProperties:false,required:['lookId','catalogVersion'],properties:{lookId:{type:'string',minLength:1,maxLength:100},catalogVersion:{type:'string',minLength:1,maxLength:100}}},{type:'object',additionalProperties:false,required:['template','color'],properties:{template:{const:'basic'},color:{enum:[...LEGACY_AVATAR_COLORS,'amber']}}}]};
export interface LegacyAvatarIdentity {readonly avatarId:string}
/** Implemented by composition on the same guarded session; never an authority supplied by HTTP input. */
export type LegacyAvatarIdentityReader<Context>=(context:Context,input:{agentId:string;worldId:'default'})=>Promise<LegacyAvatarIdentity|null>;
export function defaultAvatar():SelectedAvatar{return {lookId:DEFAULT_LOOK_ID,catalogVersion:APPEARANCE_CATALOG_VERSION};}
/** Legacy first execution keeps its old validation and exact request bytes. */
export function validateAvatarInput(value:unknown):ProfileAvatar {
 const input=object(value,['lookId','catalogVersion','template','color']);
 if(Object.hasOwn(input,'lookId')||Object.hasOwn(input,'catalogVersion')){
  const selected=object(input,['lookId','catalogVersion']);
  if(selected.catalogVersion!==APPEARANCE_CATALOG_VERSION||!APPEARANCE_LOOKS.some(look=>look.lookId===selected.lookId&&look.selectable))fail('profile_validation_failed',422,'Choose a currently selectable catalogue appearance',{field:'avatar'});
  return {lookId:selected.lookId as string,catalogVersion:APPEARANCE_CATALOG_VERSION};
 }
 const legacy=object(input,['template','color']);
 if(legacy.template!=='basic'||!LEGACY_AVATAR_COLORS.includes(legacy.color as typeof LEGACY_AVATAR_COLORS[number]))fail('profile_validation_failed',422,'Choose a supported avatar',{field:'avatar'});
 return {template:'basic',color:legacy.color as string};
}
/** Read projection is intentionally broader than current selectable input: retained selections remain readable. */
export function projectAvatar(value:unknown):ProfileAvatar|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const input=value as Record<string,unknown>;
 if(typeof input.lookId==='string'&&input.lookId.length>0&&input.lookId.length<=100&&typeof input.catalogVersion==='string'&&input.catalogVersion.length>0&&input.catalogVersion.length<=100)return {lookId:input.lookId,catalogVersion:input.catalogVersion};
 if(input.template==='basic'&&typeof input.color==='string'&&[...LEGACY_AVATAR_COLORS,'amber'].includes(input.color))return {template:'basic',color:input.color};
 return null;
}
export function needsLegacyAvatarIdentity(value:unknown):boolean {
 const avatar=projectAvatar(value);return !!avatar&&avatar.template==='basic'&&avatar.color!=='blue'&&avatar.color!=='amber';
}
/** Resolves historical presentation without changing the saved profile, Agent or World Avatar. */
export function resolveAppearance(value:unknown,identity:LegacyAvatarIdentity|null=null):ProfileAvatar|null {
 const avatar=projectAvatar(value);if(!avatar||typeof avatar.lookId==='string')return avatar;
 let hair:string|undefined=avatar.color==='blue'?'curlyhair':avatar.color==='amber'?'longhair':undefined;
 if(!hair&&identity&&typeof identity.avatarId==='string'&&identity.avatarId.length){let index=0;for(const char of identity.avatarId)index=(index*31+char.charCodeAt(0))>>>0;hair=LEGACY_HAIR_ORDER[index%LEGACY_HAIR_ORDER.length];}
 return hair?{lookId:`sunnyside-human-${hair}`,catalogVersion:APPEARANCE_CATALOG_VERSION}:avatar;
}
export async function readAppearance<Context>(context:Context,agentId:string,value:unknown,reader?:LegacyAvatarIdentityReader<Context>):Promise<ProfileAvatar|null> {
 const identity=reader&&needsLegacyAvatarIdentity(value)?await reader(context,{agentId,worldId:'default'}):null;
 return resolveAppearance(value,identity);
}
