import {RuntimeError} from '../../contracts/runtime-store.ts';
import {fail} from '../../domains/common/errors.ts';
import {hashRuntimeRequest} from '../../domains/runtime/command.ts';
import {LIFE_WALLET_REPOSITORY,type LifeCreditReason,type LifeWalletAccount,type LifeWalletCredit,type LifeWalletReader,type LifeWalletRepository,type LifeWalletSources,type WalletActorRef,type WorkRewardSource} from '../../domains/wallet/life-wallet.ts';
import {integer,number,text,type RuntimeSql} from './runtime-sql.ts';

type Row=Record<string,any>;
const copy=<T>(value:T):T=>structuredClone(value);
function actor(value:WalletActorRef):WalletActorRef{
 if(!value||!['agent','npc'].includes(value.kind))throw new RuntimeError('invalid_usage','A stable Agent or NPC wallet actor is required');
 return {kind:value.kind,id:text(value.id)};
}
function credit(row:Row):LifeWalletCredit{return {
 id:row.id,reason:row.reason,sourceId:row.source_id,actorRef:{kind:row.actor_kind,id:row.actor_id},currencyCode:'star_coin',amount:number(row.amount),
 catalogRevision:number(row.catalog_revision),ruleVersion:number(row.rule_version),jobId:row.job_id,sourceEventId:row.source_event_id,
 occurredAt:number(row.occurred_at),recordedAt:number(row.recorded_at),balanceBefore:number(row.balance_before),balanceAfter:number(row.balance_after),
 accountVersionBefore:number(row.account_version_before),accountVersionAfter:number(row.account_version_after),
};}
/** Same caller-owned RuntimeSql/client as lifecycle, receipts and events. This factory opens no transaction or connection. */
export function createLifeWalletRepository(sql:RuntimeSql,sources:LifeWalletSources):{port:typeof LIFE_WALLET_REPOSITORY;reader:LifeWalletReader;writer:LifeWalletRepository}{
 const catalog=copy(sources.catalog);
 if(![1,2].includes(catalog.revision)||catalog.ruleVersion!==1||catalog.currency!=='star_coin'||catalog.currencyScale!==0||typeof sources.readCompletedWorkRewardSource!=='function')throw new RuntimeError('invalid_usage','The approved life wallet catalog and source reader are required');
 const jobs=new Map(catalog.jobs.map(job=>{text(job.id);integer(job.coinReward,1);integer(job.durationSeconds,1,7200);return [job.id,job] as const;}));
 if(jobs.size!==catalog.jobs.length||jobs.size!==2||!jobs.has('harbor_shift')||!jobs.has('tavern_shift'))throw new RuntimeError('invalid_usage','The two approved work rules are required');
 integer(catalog.npcPolicy.initialCoins,1);
 const npcs=new Set(catalog.npcProfiles.filter(profile=>profile.stage==='A'||catalog.revision===2&&profile.stage==='B').map(profile=>text(profile.id)));
 const expectedNpcs=['npc-mayor','npc-tavern','npc-innkeeper','npc-harbor-hand',...(catalog.revision===2?['npc-fishing-clerk']:[])];
 if(npcs.size!==expectedNpcs.length||expectedNpcs.some(id=>!npcs.has(id)))throw new RuntimeError('invalid_usage','The approved A/B NPC identities are required');
 async function readCredit(reason:LifeCreditReason,sourceId:string){
  const row=(await sql.query('SELECT * FROM wallet.life_credits WHERE reason=$1 AND source_id=$2',[reason,text(sourceId)]))[0];
  return row?{value:credit(row),payloadHash:String(row.payload_hash)}:undefined;
 }
 async function readAccount(ref:WalletActorRef,lock=false):Promise<LifeWalletAccount|undefined>{
  const a=actor(ref),query=a.kind==='agent'
   ?'SELECT balance,version FROM wallet.accounts WHERE id=$1 AND agent_id=$2 AND currency_code=\'star_coin\' AND scale=0'
   :'SELECT balance,version FROM wallet.npc_accounts WHERE npc_id=$1 AND actor_kind=\'npc\' AND currency_code=\'star_coin\' AND scale=0';
  const row=(await sql.query(query+(lock?' FOR UPDATE':''),a.kind==='agent'?['star_coin:'+a.id,a.id]:[a.id]))[0];
  return row?{actorRef:a,currencyCode:'star_coin',scale:0,balance:number(row.balance),accountVersion:number(row.version)}:undefined;
 }
 function samePrior(prior:Awaited<ReturnType<typeof readCredit>>,payloadHash:string){
  if(prior&&prior.payloadHash!==payloadHash)throw new RuntimeError('command_conflict','This immutable life credit already has another source payload');
  return prior?.value;
 }
 async function post(input:{reason:LifeCreditReason;sourceId:string;actorRef:WalletActorRef;amount:number;jobId:string|null;sourceEventId:string|null;occurredAt:number;payloadHash:string;catalogRevision:number}):Promise<LifeWalletCredit>{
  const prior=samePrior(await readCredit(input.reason,input.sourceId),input.payloadHash);if(prior)return prior;
  const account=await readAccount(input.actorRef,true);if(!account)fail('wallet_not_initialized',409,'The actual actor wallet is not initialized');
  const concurrent=samePrior(await readCredit(input.reason,input.sourceId),input.payloadHash);if(concurrent)return concurrent;
  const balance=account.balance+input.amount,nextVersion=account.accountVersion+1;
  if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(nextVersion))fail('wallet_capacity',409,'The wallet cannot receive this work reward');
  const recordedAt=sql.now();integer(recordedAt,input.occurredAt);
  const id='life-credit:'+hashRuntimeRequest({reason:input.reason,sourceId:input.sourceId}),a=input.actorRef;
  await sql.mutate('INSERT INTO wallet.life_credits(id,reason,source_id,actor_kind,actor_id,agent_account_id,npc_account_id,source_activity_id,source_event_id,catalog_revision,rule_version,job_id,amount,occurred_at,recorded_at,balance_before,balance_after,account_version_before,account_version_after,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',[
   id,input.reason,input.sourceId,a.kind,a.id,a.kind==='agent'?'star_coin:'+a.id:null,a.kind==='npc'?a.id:null,input.reason==='life.work.reward'?input.sourceId:null,input.sourceEventId,input.catalogRevision,catalog.ruleVersion,input.jobId,input.amount,input.occurredAt,recordedAt,account.balance,balance,account.accountVersion,nextVersion,input.payloadHash,
  ]);
  if(a.kind==='agent')await sql.cas('UPDATE wallet.accounts SET balance=$2,version=$3 WHERE id=$1 AND version=$4 RETURNING id',['star_coin:'+a.id,balance,nextVersion,account.accountVersion]);
  else await sql.cas('UPDATE wallet.npc_accounts SET balance=$2,version=$3 WHERE npc_id=$1 AND version=$4 RETURNING npc_id',[a.id,balance,nextVersion,account.accountVersion]);
  return (await readCredit(input.reason,input.sourceId))!.value;
 }
 function completed(source:WorkRewardSource|undefined,a:WalletActorRef,id:string){
  if(!source||source.id!==id||source.state!=='completed'||source.actionId!=='work.shift')throw new RuntimeError('invalid_usage','Only a persisted completed work activity is a currency source');
  if(source.actorKind!==a.kind||source.actorId!==a.id)throw new RuntimeError('command_conflict','The completed activity belongs to another actor');
  const job=jobs.get(source.jobId??'');
  if(!job||!([1,2].includes(source.catalogRevision)&&source.catalogRevision<=catalog.revision)||source.ruleVersion!==catalog.ruleVersion||source.rewardAmount!==job.coinReward||source.resultId!==id||!source.sourceEventId)throw new RuntimeError('invalid_usage','The frozen completed work terms differ from the approved rule');
  integer(source.startedAt);integer(source.scheduledEndAt,source.startedAt);integer(source.endedAt,source.scheduledEndAt);
  if(source.scheduledEndAt-source.startedAt!==job.durationSeconds*1000)throw new RuntimeError('invalid_usage','The activity did not retain its full work duration');
  text(source.sourceEventId);return {source,job};
 }
 const repo:LifeWalletRepository={
  getAccount:ref=>readAccount(ref),
  async getWorkReward(id){return (await readCredit('life.work.reward',id))?.value;},
  async getNpcInitialization(id){return (await readCredit('life.npc.initialization',id))?.value;},
  async initializeNpc(input){
   sql.writable();const a=actor(input.actorRef);if(a.kind!=='npc'||!npcs.has(a.id))throw new RuntimeError('invalid_usage','Only an approved real A/B NPC may receive initialization');
   // Initialization is a lifetime entitlement, independent of later catalog activation or the current balance.
   const existing=await readCredit('life.npc.initialization',a.id);
   if(existing){const v=existing.value;if(v.actorRef.kind!=='npc'||v.actorRef.id!==a.id||v.amount!==catalog.npcPolicy.initialCoins||v.ruleVersion!==1||![1,2].includes(v.catalogRevision)||v.catalogRevision>catalog.revision)throw new RuntimeError('command_conflict','The original NPC initialization differs');return v;}
   const payloadHash=hashRuntimeRequest({reason:'life.npc.initialization',actorKind:a.kind,actorId:a.id,catalogRevision:catalog.revision,ruleVersion:catalog.ruleVersion,amount:catalog.npcPolicy.initialCoins});
   const prior=samePrior(await readCredit('life.npc.initialization',a.id),payloadHash);if(prior)return prior;
   if(!(await sql.query('SELECT npc_id FROM town_services.npcs WHERE npc_id=$1',[a.id])).length)throw new RuntimeError('invalid_usage','A real NPC identity must exist before its wallet');
   const stamp=sql.now();await sql.mutate('INSERT INTO wallet.npc_accounts(actor_kind,npc_id,currency_code,scale,version,balance,initialized_at,initialization_source) VALUES(\'npc\',$1,\'star_coin\',0,1,0,$2,\'life.npc.initialization\') ON CONFLICT(npc_id) DO NOTHING',[a.id,stamp]);
   return post({reason:'life.npc.initialization',sourceId:a.id,actorRef:a,amount:catalog.npcPolicy.initialCoins,jobId:null,sourceEventId:null,occurredAt:stamp,payloadHash,catalogRevision:catalog.revision});
  },
  async rewardCompletedWork(input){
   sql.writable();const a=actor(input.actorRef),id=text(input.activityId);
   const {source,job}=completed(await sources.readCompletedWorkRewardSource(id),a,id);
   if(a.kind==='npc'&&(!npcs.has(a.id)||!await repo.getNpcInitialization(a.id)))throw new RuntimeError('invalid_usage','The real NPC wallet must have its unique initialization first');
   const payloadHash=hashRuntimeRequest({...source,reason:'life.work.reward'});
   return post({reason:'life.work.reward',sourceId:id,actorRef:a,amount:job.coinReward,jobId:job.id,sourceEventId:source.sourceEventId,occurredAt:source.endedAt!,payloadHash,catalogRevision:source.catalogRevision});
  },
 };
 return {port:LIFE_WALLET_REPOSITORY,reader:{getAccount:repo.getAccount,getWorkReward:repo.getWorkReward,getNpcInitialization:repo.getNpcInitialization},writer:repo};
}
