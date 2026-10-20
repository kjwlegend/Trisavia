import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {fail} from '../common/errors.ts';
interface Scope {instanceId:string;recoveryEpoch:string;agentId:string;limit:number}
/** Process-local continuation only. Encryption conceals revoked Decision IDs; authentication binds the current reader. */
export function createDecisionCursor(){
 const secret=randomBytes(32),ttl=300000;
 const invalid=():never=>fail('invalid_cursor',400,'Decision continuation is invalid or expired; restart the current query');
 return {
  encode(afterId:string,scope:Scope,now:number){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(JSON.stringify(scope)));const body=Buffer.concat([cipher.update(JSON.stringify({afterId,expiresAt:now+ttl})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');},
  decode(token:string,scope:Scope,now:number):string{
   try{if(token.length>2048||!/^[-_a-zA-Z0-9]+$/.test(token))return invalid();const bytes=Buffer.from(token,'base64url');if(bytes.length<29)return invalid();const decipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));decipher.setAAD(Buffer.from(JSON.stringify(scope)));decipher.setAuthTag(bytes.subarray(12,28));const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as {afterId:unknown;expiresAt:unknown};if(typeof value.afterId!=='string'||value.afterId.length>100||typeof value.expiresAt!=='number'||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+ttl)return invalid();return value.afterId;}catch{return invalid();}
  },
 };
}
