import { StorageError, type QuotaCountQuery } from '../../contracts/store.ts';
import { checkedJson } from './codec.ts';

/** Fixed domain predicates; callers cannot supply SQL, column names or projections. */
export function quotaSelection(query:QuotaCountQuery):{sql:string;values:unknown[]} {
  if(!query||typeof query!=='object'||Array.isArray(query))throw new StorageError('invalid_usage','Expected a typed quota query');
  checkedJson(query);
  if(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100_001)throw new StorageError('invalid_usage','Invalid bounded quota limit');
  const values:unknown[]=[],where:string[]=[];let table:string,allowed:string[];
  const parameter=(value:unknown)=>{values.push(value);return `$${values.length}`;};
  const text=(value:unknown)=>{if(typeof value!=='string')throw new StorageError('invalid_usage','Invalid quota identity');return parameter(value)+'::text';};
  function timestamp(value:unknown):string {if(typeof value!=='number'||!Number.isSafeInteger(value)||!Number.isFinite(new Date(value).getTime()))throw new StorageError('invalid_usage','Invalid quota time');return parameter(new Date(value))+'::timestamptz';}
  function sourceKeys(keys:unknown):void {if(!Array.isArray(keys)||!keys.every(key=>typeof key==='string'))throw new StorageError('invalid_usage','Invalid quota source keys');where.push(`q.source_key = ANY(${parameter(keys)}::text[])`);}
  switch(query.kind){
    case'email_attempts_recent':
      table='iam.email_attempts';allowed=['kind','since','sourceKeys','limit'];where.push(`q.created_at > ${timestamp(query.since)}`);if(query.sourceKeys!==undefined)sourceKeys(query.sourceKeys);break;
    case'code_mail_recent':
      table='email.mail_jobs';allowed=['kind','since','related','sourceKeys','limit'];where.push("q.purpose='code'",`q.created_at > ${timestamp(query.since)}`);
      if(query.related!==undefined){const related=query.related;if(!related||typeof related!=='object'||Array.isArray(related)||Object.keys(related).some(key=>!['ownerKey','emailKey'].includes(key)))throw new StorageError('invalid_usage','Invalid related mail quota');where.push(`(q.owner_key = ${text(related.ownerKey)} OR EXISTS(SELECT 1 FROM iam.email_attempts a WHERE a.id=q.attempt_id AND a.email_key=${text(related.emailKey)}))`);}
      if(query.sourceKeys!==undefined)sourceKeys(query.sourceKeys);break;
    case'recovery_requests_recent':
      table='iam.recovery_requests';allowed=['kind','since','ownerId','sourceKey','limit'];where.push(`q.created_at > ${timestamp(query.since)}`);if(query.ownerId!==undefined)where.push(`q.owner_id=${text(query.ownerId)}`);if(query.sourceKey!==undefined)where.push(`q.source_key=${text(query.sourceKey)}`);break;
    case'active_invites':
      table='iam.credentials';allowed=['kind','ownerId','after','limit'];where.push("q.active=true","q.kind='invite'",`q.owner_id=${text(query.ownerId)}`,`q.expires_at > ${timestamp(query.after)}`);break;
    case'pending_recovery':
      if(query.limit!==1)throw new StorageError('invalid_usage','Pending recovery is a bounded existence query');
      table='iam.recovery_requests';allowed=['kind','agentId','epoch','after','limit'];
      where.push(`q.agent_id=${text(query.agentId)}`,"q.status='pending'",`q.epoch=${text(query.epoch)}`,`q.expires_at > ${timestamp(query.after)}`,
        `EXISTS(SELECT 1 FROM iam.human_accounts o WHERE o.id=q.owner_id AND o.status='active' AND o.epoch=q.epoch AND o.auth_version=q.owner_auth_version)`,
        `EXISTS(SELECT 1 FROM iam.management_bindings b WHERE b.id=q.binding_id AND b.version=q.binding_version AND b.active=true AND b.owner_id=q.owner_id)`,
        `EXISTS(SELECT 1 FROM iam.credentials c WHERE c.id=q.creator_runtime_credential_id AND c.active=true AND c.kind='runtime' AND c.epoch=q.epoch AND c.runtime_version=q.creator_runtime_version)`,
        `EXISTS(SELECT 1 FROM iam.agents a WHERE a.id=q.agent_id AND a.runtime_version=q.creator_runtime_version AND a.runtime_active=true)`);break;
    default:throw new StorageError('invalid_usage','Unknown domain quota query');
  }
  if(Object.keys(query).some(key=>!allowed.includes(key)))throw new StorageError('invalid_usage','Unknown quota query field');
  return {sql:`SELECT count(*)::integer AS total FROM (SELECT 1 FROM ${table} q WHERE ${where.join(' AND ')} LIMIT ${parameter(query.limit)}) bounded_quota`,values};
}
