import {LIFE_FISHING_REPOSITORY,type LifeFishingRepository} from '../../domains/life/fishing-repository.ts';
import type {LifeFishingSession,LifeFishingCast,LifeTradeSource} from '../../domains/life/b-types.ts';
import {checkVersion,document,text,type RuntimeSql} from './runtime-sql.ts';
import {RuntimeError} from '../../contracts/runtime-store.ts';
import {hashRuntimeRequest} from '../../domains/runtime/command.ts';
import type {JsonObject} from '../../contracts/store.ts';
import {LIFE_B_RULES as B} from '../../domains/life/b-catalog.ts';

/** Same checked-out client as the Life activity, economic participant, events, receipts and outbox. */
export function createLifeFishingRepository(sql:RuntimeSql){
 const get=async<T>(table:string,id:string):Promise<T|undefined>=>(await sql.query('SELECT data FROM life.'+table+' WHERE id=$1',[text(id)]))[0]?.data;
 const repo:LifeFishingRepository={
  getSession:id=>get('fishing_sessions',id),getCast:id=>get('fishing_casts',id),
  async listCasts(id){return(await sql.query('SELECT data FROM life.fishing_casts WHERE session_id=$1 ORDER BY cast_index LIMIT 6',[text(id)])).map(r=>r.data);},
  async saveSession(v,e){checkVersion(v.version,e);document(v);if(e===null)await sql.mutate('INSERT INTO life.fishing_sessions(id,version,actor_kind,actor_id,state,data) VALUES($1,$2,$3,$4,$5,$6)',[v.id,v.version,v.actorKind,v.actorId,v.state,v]);else await sql.cas('UPDATE life.fishing_sessions SET version=$2,state=$3,data=$4 WHERE id=$1 AND version=$5 RETURNING id',[v.id,v.version,v.state,v,e]);},
  async saveCast(v,e){checkVersion(v.version,e);document(v);if(e===null)await sql.mutate('INSERT INTO life.fishing_casts(id,version,session_id,cast_index,state,started_at,scheduled_end_at,ended_at,result_id,source_event_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[v.id,v.version,v.sessionId,v.index,v.state,v.startedAt,v.scheduledEndAt,v.endedAt,v.resultId,v.sourceEventId,v]);else{
   const prior=await repo.getCast(v.id);if(!prior||prior.state!=='active'||v.state==='active')throw new RuntimeError('invalid_usage','Fishing cast may reach only one terminal state');
   const fixed=(c:LifeFishingCast)=>{const {version,state,endedAt,resultId,sourceEventId,stopCode,...source}=c;return hashRuntimeRequest(source as unknown as JsonObject);};if(fixed(prior)!==fixed(v))throw new RuntimeError('invalid_usage','The private draw and cast source are immutable');
   await sql.cas('UPDATE life.fishing_casts SET version=$2,state=$3,ended_at=$4,result_id=$5,source_event_id=$6,data=$7 WHERE id=$1 AND version=$8 RETURNING id',[v.id,v.version,v.state,v.endedAt,v.resultId,v.sourceEventId,v,e]);
  }},
 };
 return {port:LIFE_FISHING_REPOSITORY,writer:repo,reader:{getSession:repo.getSession,getCast:repo.getCast,listCasts:repo.listCasts}};
}
/** Narrow, source-owned snapshots for the economic domain; no generic table/session escapes. */
export async function readLifeTradeSource(sql:RuntimeSql,id:string){
 const row=(await sql.query('SELECT data FROM life.activities WHERE id=$1',[text(id)]))[0];if(!row)return undefined;
 const a=row.data as {id:string;actorKind:'agent'|'npc';actorId:string;actionId:string;state:string;placeId:string;ruleVersion:number;catalogRevision:number;startedAt:number;endedAt:number|null;resultId:string|null;sourceEventId:string|null;trade?:LifeTradeSource['terms']};
 if(!a.trade||!['shop.buy','shop.sell'].includes(a.actionId))return undefined;const t=a.trade,prices=t.side==='buy'?[{itemId:t.itemId,unitPrice:t.quote.unitPrice}]:B.shop.items.filter(i=>i.sellPrice!==null).map(i=>({itemId:i.id,unitPrice:i.sellPrice!}));
 return {id:a.id,actorKind:a.actorKind,actorId:a.actorId,actionId:a.actionId as 'shop.buy'|'shop.sell',state:a.state,placeId:a.placeId,ruleVersion:a.ruleVersion,catalogRevision:a.catalogRevision,startedAt:a.startedAt,endedAt:a.endedAt,resultId:a.resultId,sourceEventId:a.sourceEventId,
  quote:{catalogRevision:a.catalogRevision,ruleVersion:a.ruleVersion,createdAt:t.quote?.issuedAt??a.startedAt,expiresAt:t.quote?.expiresAt??a.startedAt+B.quoteTtlMs,items:prices},
  ...(t.side==='buy'?{purchase:{itemId:t.itemId,quantity:t.quantity,maxSpend:t.maxTotalPrice},moneyAmount:t.totalPrice}:{sale:{instanceIds:t.itemInstanceIds,minIncome:t.minTotalProceeds},moneyAmount:t.totalProceeds})};
}
export async function readLifeFishingSessionSource(sql:RuntimeSql,id:string){const s=(await sql.query('SELECT data FROM life.fishing_sessions WHERE id=$1',[text(id)]))[0]?.data as LifeFishingSession|undefined;return s?{id:s.id,actorKind:s.actorKind,actorId:s.actorId,actionId:'fish.session' as const,state:s.state,ruleVersion:s.ruleVersion,catalogRevision:s.catalogRevision,rodInstanceId:s.rodInstanceId,requestedCasts:s.requestedCasts,startedAt:s.startedAt,endedAt:s.endedAt}:undefined;}
export async function readLifeFishingCastSource(sql:RuntimeSql,id:string){const c=(await sql.query('SELECT data FROM life.fishing_casts WHERE id=$1',[text(id)]))[0]?.data as LifeFishingCast|undefined;return c?{id:c.id,sessionId:c.sessionId,actorKind:c.actorKind,actorId:c.actorId,state:c.state,ruleVersion:c.ruleVersion,catalogRevision:c.catalogRevision,castIndex:c.index,spotId:c.spotId,startedAt:c.startedAt,scheduledEndAt:c.scheduledEndAt,endedAt:c.endedAt,resultId:c.resultId,sourceEventId:c.sourceEventId,outcome:c.outcome}:undefined;}
