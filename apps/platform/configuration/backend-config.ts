import { loadEmailConfig, type EmailConfig } from '../infrastructure/email/resend.ts';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BackendConfig {
  email?:EmailConfig;
  host:string;port:number;trustProxyLoopback:boolean;worldCoreEnabled:boolean;worldCoreInteractionEnabled:boolean;
  connectionString:string;identityPath:string;instanceId:string;recoveryEpoch:string;
}
function identifier(value:unknown):value is string {return typeof value==='string'&&/^[A-Za-z0-9_.:-]{3,128}$/.test(value);}
function privateText(path:string):string {const info=lstatSync(path);if(!info.isFile()||(info.mode&0o077)!==0)throw new Error('Private regular configuration files (0600) are required');return readFileSync(path,'utf8');}
/** Runtime is PostgreSQL only. Provisioning, schema migration and identity creation are explicit offline operations. */
export function loadBackendConfig(env:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):BackendConfig {
 const email=loadEmailConfig(env),host=env.M1_HOST??'127.0.0.1';if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('M1_HOST must be a loopback address');
 const proxy=env.M1_TRUST_PROXY_LOOPBACK??'0';if(!['0','1'].includes(proxy))throw new Error('M1_TRUST_PROXY_LOOPBACK must be 0 or 1');
 const worldCore=env.WORLD_CORE_ENABLED??'0';if(!['0','1'].includes(worldCore))throw new Error('WORLD_CORE_ENABLED must be 0 or 1');
 const interaction=env.WORLD_CORE_INTERACTION_ENABLED??'0';if(!['0','1'].includes(interaction)||interaction==='1'&&worldCore!=='1')throw new Error('WORLD_CORE_INTERACTION_ENABLED must be 0 or 1 and requires WORLD_CORE_ENABLED=1');
 const portText=env.M1_PORT??'8787',port=Number(portText);if(!/^\d+$/.test(portText)||!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('M1_PORT must be an integer between 0 and 65535');
 if(env.M1_DATABASE_PATH!==undefined)throw new Error('SQLite is offline-only; configure the PostgreSQL connection explicitly');
 if(Boolean(env.M1_DATABASE_URL)===Boolean(env.M1_POSTGRES_CONNECTION_FILE))throw new Error('Exactly one private PostgreSQL connection file or database URL is required');
 const connectionString=(env.M1_POSTGRES_CONNECTION_FILE?privateText(resolve(cwd,env.M1_POSTGRES_CONNECTION_FILE)):env.M1_DATABASE_URL!).trim();
 let url:URL;try{url=new URL(connectionString);}catch{throw new Error('Invalid PostgreSQL connection configuration');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname||/[\r\n\u0000]/u.test(connectionString))throw new Error('Invalid PostgreSQL connection configuration');
 if(!env.M1_IDENTITY_PATH)throw new Error('Existing paired identity metadata is required');
 const identityPath=resolve(cwd,env.M1_IDENTITY_PATH);let saved:Record<string,unknown>;
 try{saved=JSON.parse(privateText(identityPath)) as Record<string,unknown>;}catch{throw new Error('Identity metadata is unreadable or invalid; refusing to regenerate it');}
 if(!saved||saved.version!==1||!identifier(saved.instanceId)||!identifier(saved.recoveryEpoch))throw new Error('Identity metadata has unsupported identifiers');
 for(const [key,value]of [['M1_INSTANCE_ID',saved.instanceId],['M1_RECOVERY_EPOCH',saved.recoveryEpoch]] as const)if(env[key]!==undefined&&env[key]!==value)throw new Error('Environment identity conflicts with saved metadata');
 return {host,port,trustProxyLoopback:proxy==='1',worldCoreEnabled:worldCore==='1',worldCoreInteractionEnabled:interaction==='1',connectionString,identityPath,instanceId:saved.instanceId,recoveryEpoch:saved.recoveryEpoch,...(email?{email}:{})};
}
