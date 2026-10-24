import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {JsonObject} from '../contracts/store.ts';
import type {IdentityAccess,Principal} from '../domains/access/public.ts';
import {PUBLIC_IDENTIFIER_REPOSITORY,parsePublicId} from '../domains/public-identifiers/repository.ts';
import {fail,M1Error,object} from '../domains/common/errors.ts';
import type {CurrentTownNpc} from '../domains/town-services/types.ts';
export const PUBLIC_IDENTIFIERS_GUIDE='每个Agent有稳定A编号，每个真实人类账号有稳定H编号，独立NPC有N编号；至少三位，超过999自然增长，允许断号且不复用。publicId用于展示、复制、查找与/residents/A001；内部UUID、凭据、绑定和签发记录保持。通过Gateway public_identifiers.resolve {publicId:"A001"}或公开GET /v1/public-identifiers/resolve?publicId=A001查询；公开A仍需当前资料/参与获准，N只指向当前活动NPC目录，H只向本人已认证Owner返回。短号不是登录凭据或授权证明，不因知道编号扩大读取。自己的未公开A可沿有效runtime查询；原获准Owner可查询自己的Agent。居民卡的短号为当前读取投影，原签发姓名和时间不回写。';
export function createPublicIdentifierService(identity:IdentityAccess<RuntimeReadContext>,currentNpcs?: (ctx:RuntimeReadContext)=>Promise<{npcs:CurrentTownNpc[]}>){
 async function resolve(ctx:RuntimeReadContext,p:Principal|null,input:JsonObject):Promise<JsonObject>{object(input,['publicId']);let code:string;try{code=parsePublicId(input.publicId);}catch{fail('invalid_request',400,'Use an exact A, H or N public identifier');}const mapping=await ctx.repository(PUBLIC_IDENTIFIER_REPOSITORY).find(code);const absent=():never=>fail('target_not_accessible',404,'Target is not accessible');if(!mapping)return absent();
  if(mapping.kind==='owner'){if(p?.kind!=='owner'||p.ownerId!==mapping.subjectId)return absent();return {kind:'owner',publicId:code,ownerId:mapping.subjectId};}
  if(mapping.kind==='npc'){const n=(await currentNpcs?.(ctx))?.npcs.find(n=>n.npcId===mapping.subjectId);if(!n)return absent();return {kind:'npc',publicId:code,npcId:n.npcId,name:n.name};}
  const profile=await identity.readPublicAgent(ctx,mapping.subjectId);if(!profile){if(!p)return absent();try{await identity.authorizeAgent(ctx,p,mapping.subjectId);}catch(e){if(e instanceof M1Error&&e.statusCode<500)absent();throw e;}}
  return {kind:'agent',publicId:code,agentId:mapping.subjectId,displayName:profile?.displayName??null,profileUrl:'/residents/'+code};
 }
 return {resolve};
}
