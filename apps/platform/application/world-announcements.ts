import type {JsonObject,M1ReadSession,M1Store,StoredRow} from '../contracts/store.ts';
import {catalogRepository,contentRepository} from '../domains/perception/repository.ts';
import {fail,object,text} from '../domains/common/errors.ts';
import {key,plain,refId,type ObjectRef} from '../domains/perception/protocol.ts';
import {executePerceptionAdministrativeCommand} from './perception-admin.ts';

// Keep the existing source identity: Agent perception and the human HUD read the same publication.
const SOURCE='demo-announcements';
export const WELCOME_ANNOUNCEMENT={id:'welcome-trisavia-20261024',title:'欢迎入驻 Trisavia',body:'万物有邻。您是我们的第一批居民。',author:'镇长',publisher:{kind:'npc',id:'npc-mayor',displayName:'镇长'}} as const;
const announcementRef=(id:string):ObjectRef=>({moduleId:'world',type:'world.announcement@1',id});
async function requireSource(tx:M1ReadSession){
 const state=plain((await catalogRepository(tx).get('current'))?.data.sourceStates)[SOURCE];
 if(state==='not_enabled'||state===undefined)fail('channel_not_enabled',409,'Announcements are not enabled');
 if(state!=='enabled')fail('source_unavailable',503,'Announcements are unavailable');
}
function projection(row:StoredRow,detail=false):JsonObject{
 const d=row.data,r=plain(d.ref),source=plain(d.source),revision=plain(plain(d.fields).announcementRevision);
 if(r.moduleId!=='world'||r.type!=='world.announcement@1'||typeof r.id!=='string'||row.id!==refId(announcementRef(r.id))||typeof d.title!=='string'||typeof d.body!=='string')fail('source_unavailable',503,'Announcement content is unavailable');
 return {id:r.id,version:row.version,title:d.title,author:typeof d.author==='string'?d.author:null,publishedAt:Number.isSafeInteger(source.publishedAt)?source.publishedAt!:null,revisedAt:Number.isSafeInteger(revision.revisedAt)?revision.revisedAt!:null,dataMode:d.dataMode==='demo'?'demo':'real',...(detail?{body:d.body}:{})};
}
/** Public current-world projection only. No actor, selected Agent, read-state or session writes. */
export function createWorldAnnouncements(store:M1Store,now:()=>number=Date.now){
 function scope(raw:unknown,keys:string[]){const input=object(raw,keys);if(input.worldId!==undefined&&input.worldId!=='default')fail('world_not_accessible',404,'World is not accessible');return input;}
 return {
  async list(raw:unknown){
   const input=scope(raw,['worldId','afterId']);
   if(input.afterId!==undefined&&(typeof input.afterId!=='string'||!/^[a-f0-9]{64}$/.test(input.afterId)))fail('invalid_request',400,'Invalid continuation');
   return store.read(async tx=>{await requireSource(tx);const rows=await contentRepository(tx).publicAnnouncements(SOURCE,{limit:26,...(typeof input.afterId==='string'?{afterId:input.afterId}:{})}),items=rows.slice(0,25).map(row=>projection(row));return {worldId:'default',items,complete:rows.length<=25,nextAfterId:rows.length>25?rows[24]!.id:null,asOf:now()};});
  },
  async detail(raw:unknown){
   const input=scope(raw,['worldId','id']),id=text(input.id,'id',1,200);
   return store.read(async tx=>{await requireSource(tx);const row=await contentRepository(tx).get(refId(announcementRef(id)));if(!row||row.data.categoryId!=='announcements'||row.data.channel!=='world'||row.data.sourceId!==SOURCE||row.data.public!==true||row.data.active!==true||row.data.available!==true)fail('target_not_accessible',404,'Announcement is not accessible');return {worldId:'default',item:projection(row,true),asOf:now()};});
  },
 };
}
/** Explicit maintenance operation. Appends one stable publication; never seeds or republishes a catalog. */
export async function publishWelcomeAnnouncement(store:M1Store,options:{actorId:string;expectedInstanceId:string;expectedRecoveryEpoch:string;now?:()=>number}):Promise<JsonObject>{
 if(options.expectedInstanceId!==store.instanceId||options.expectedRecoveryEpoch!==store.recoveryEpoch)fail('version_conflict',409,'Explicit target identity differs');
 if(!/^[A-Za-z0-9_.:@-]{1,100}$/.test(options.actorId))throw new Error('Explicit administrative actor is required');
 const welcome=WELCOME_ANNOUNCEMENT,ref=announcementRef(welcome.id),id=refId(ref);
 return store.transaction(async tx=>{
  await requireSource(tx);
  const prior=await contentRepository(tx).get(id),base:JsonObject={ref,categoryId:'announcements',metricId:'all',channel:'world',sourceId:SOURCE,title:welcome.title,body:welcome.body,author:welcome.author,actor:{...welcome.publisher},public:true,active:true,available:true,dataMode:'real',attachments:[]};
  if(prior){
   const {source,...previous}=prior.data,published=plain(source);
   if(prior.version!==1||key(previous)!==key(base)||published.kind!=='administrative_publication'||published.reference!==welcome.id||published.administrator!==options.actorId||!Number.isSafeInteger(published.publishedAt))fail('publication_conflict',409,'The stable announcement already has different content or identity');
   return {changed:false,instanceId:store.instanceId,ref,version:prior.version,publishedAt:published.publishedAt!};
  }
  const publishedAt=(options.now??Date.now)();if(!Number.isSafeInteger(publishedAt)||publishedAt<0)throw new Error('A real publication timestamp is required');
  await contentRepository(tx).insert({id,version:1,data:{...base,source:{kind:'administrative_publication',reference:welcome.id,administrator:options.actorId,publishedAt}}});
  return {changed:true,instanceId:store.instanceId,ref,version:1,publishedAt};
 });
}

/** One explicit revision of the original real publication. No new announcement, catalog release, reader state or rewards. */
export async function reviseWelcomeAnnouncement(store:M1Store,options:{actorId:string;operationId:string;expectedInstanceId:string;expectedRecoveryEpoch:string;expectedVersion:number;title:string;body:string;now?:()=>number}):Promise<JsonObject>{
 if(options.expectedInstanceId!==store.instanceId||options.expectedRecoveryEpoch!==store.recoveryEpoch)fail('version_conflict',409,'Explicit target identity differs');
 if(options.expectedVersion!==1)fail('version_conflict',409,'Only the original welcome publication version may be revised');
 text(options.title,'title',1,180);
 if(!options.title.trim()||typeof options.body!=='string'||!options.body.trim()||options.body.length>100000||/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(options.body))throw new Error('A bounded explicit welcome story is required');
 const ref=announcementRef(WELCOME_ANNOUNCEMENT.id),id=refId(ref),payload:JsonObject={action:'reviseWelcomeAnnouncement',edition:'welcome-story-1',instanceId:store.instanceId,recoveryEpoch:store.recoveryEpoch,ref,expectedVersion:options.expectedVersion,title:options.title,body:options.body};
 return executePerceptionAdministrativeCommand(store,options,payload,async(tx,revisedAt)=>{
  await requireSource(tx);const row=await contentRepository(tx).get(id);
  if(!row||row.version!==options.expectedVersion)fail('version_conflict',409,'The original welcome publication version changed or is missing');
  const source=plain(row.data.source),{source:_source,...current}=row.data,expected:JsonObject={ref,categoryId:'announcements',metricId:'all',channel:'world',sourceId:SOURCE,title:WELCOME_ANNOUNCEMENT.title,body:WELCOME_ANNOUNCEMENT.body,author:WELCOME_ANNOUNCEMENT.author,actor:{...WELCOME_ANNOUNCEMENT.publisher},public:true,active:true,available:true,dataMode:'real',attachments:[]};
  if(key(current)!==key(expected)||source.kind!=='administrative_publication'||source.reference!==WELCOME_ANNOUNCEMENT.id||typeof source.administrator!=='string'||!Number.isSafeInteger(source.publishedAt)||Number(source.publishedAt)<0)fail('publication_conflict',409,'The stable original publication content or source differs');
  if(!Number.isSafeInteger(revisedAt)||revisedAt<Number(source.publishedAt))throw new Error('A real revision timestamp at or after original publication is required');
  const historyId=`object-history:${id}:${row.version}`;
  // The existing history codec routes by content.type. Preserve every original field and record that derived type explicitly.
  const history={id:historyId,version:1,data:{kind:'object_history',objectId:id,contentVersion:row.version,content:{...row.data,type:ref.type},recordedAt:revisedAt}};
  const priorHistory=await catalogRepository(tx).get(historyId);if(priorHistory){if(key(priorHistory.data)!==key(history.data))fail('publication_conflict',409,'The original publication history already differs');}else await catalogRepository(tx).insert(history);
  const next={...row,version:2,data:{...row.data,title:options.title,body:options.body,fields:{announcementRevision:{edition:'welcome-story-1',previousContentVersion:row.version,revisedAt}}}};
  if(!await contentRepository(tx).replace(next,row.version))fail('version_conflict',409,'The original welcome publication changed before commit');
  return {changed:true,instanceId:store.instanceId,ref,previousVersion:row.version,version:2,publishedAt:source.publishedAt!,revisedAt,previousContentHash:key(row.data),contentHash:key(next.data)};
 });
}
