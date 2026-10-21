import type { PoolClient } from 'pg';
import { StorageError, type JsonObject, type JsonValue, type StoredRow } from '../../contracts/store.ts';
import { column, resolveModel, type Field, type Model } from './model.ts';

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const profileLookIds=new Set(['sunnyside-human-shorthair','sunnyside-human-longhair','sunnyside-human-curlyhair','sunnyside-human-bowlhair','sunnyside-human-mophair','sunnyside-human-spikeyhair']);
const profileCatalogVersion='2026-10-21.appearance-v1.1';
export function safeInteger(value: unknown): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if(typeof number!=='number'||!Number.isSafeInteger(number))throw new StorageError('invalid_usage','Expected a safe integer');
  return number;
}
export function checkedJson(value:unknown, seen=new Set<unknown>()):void {
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){
    if(value.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw new StorageError('invalid_usage','Invalid Unicode in source');
    return;
  }
  if(typeof value==='number'&&Number.isFinite(value))return;
  if(typeof value!=='object'||seen.has(value))throw new StorageError('invalid_usage','Expected JSON value');
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new StorageError('invalid_usage','Expected plain JSON value');
  seen.add(value);for(const [key,item]of Object.entries(value)){checkedJson(key,seen);checkedJson(item,seen);}seen.delete(value);
}

export interface Encoded { columns:string[]; values:unknown[] }
export interface SplitField { table:string; path:string; mode:'array'|'map'|'profile'|'confirmation'|'snapshot' }
export function splitFields(model:Model):SplitField[]{
  if(model.logical==='profiles')return [{table:'profiles.profile_contents',path:'draft',mode:'profile'},{table:'profiles.profile_contents',path:'published',mode:'profile'},{table:'profiles.field_policies',path:'lockedFields',mode:'array'}];
  if(model.table==='perception.read_sessions')return [{table:'perception.read_session_items',path:'records',mode:'array'},{table:'perception.read_session_grants',path:'grantVersions',mode:'map'},{table:'perception.read_session_catalog_items',path:'snapshot',mode:'snapshot'}];
  if(model.table==='perception.access_facts')return [{table:'perception.access_targets',path:'targets',mode:'array'},{table:'perception.access_related_records',path:'relatedRecordIds',mode:'array'}];
  if(model.table==='perception.catalog_current')return [{table:'perception.source_states',path:'sourceStates',mode:'map'},{table:'perception.catalog_seed_objects',path:'seedObjectIds',mode:'array'}];
  if(model.table==='perception.observation_policies')return [{table:'perception.observation_policy_objects',path:'objectIds',mode:'array'}];
  if(model.table==='mailbox.deliveries')return ['confirmedContentVersion','confirmedAt'].map(path=>({table:'mailbox.agent_version_confirmations',path,mode:'confirmation' as const}));
  return [];
}
export function directFields(model:Model):Field[]{const split=splitFields(model);return model.fields.filter(field=>!split.some(item=>item.path===field.path));}

function normalizeField(field:Field,value:JsonValue):unknown {
  if(value===null)return null;
  if(field.kind==='text'){if(typeof value!=='string')throw new StorageError('invalid_usage',`Invalid ${field.path} type`);return value;}
  if(field.kind==='integer'){if(typeof value!=='number')throw new StorageError('invalid_usage',`Invalid ${field.path} integer type`);return safeInteger(value);}
  if(field.kind==='timestamp'){
    if(typeof value!=='number')throw new StorageError('invalid_usage',`Invalid ${field.path} timestamp type`);
    const stamp=safeInteger(value);if(stamp<0||!Number.isFinite(new Date(stamp).getTime()))throw new StorageError('invalid_usage',`Invalid ${field.path} timestamp`);return new Date(stamp);
  }
  if(field.kind==='boolean'){if(typeof value!=='boolean')throw new StorageError('invalid_usage',`Invalid ${field.path} flag`);return value;}
  if(field.kind==='authorization'){
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return value;
    if(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))return value;
    throw new StorageError('invalid_usage','Invalid grant authorization version');
  }
  if(field.kind==='document'&&(typeof value!=='object'||Array.isArray(value)))throw new StorageError('invalid_usage',`Invalid ${field.path} document`);
  if((field.kind==='array'||field.kind==='strings')&&!Array.isArray(value))throw new StorageError('invalid_usage',`Invalid ${field.path} array`);
  if(field.kind==='strings'){if(!(value as JsonValue[]).every(item=>typeof item==='string'))throw new StorageError('invalid_usage',`Invalid ${field.path} text list`);return value;}
  return JSON.stringify(value);
}
export function encode(model:Model,row:StoredRow):Encoded {
  checkedJson(row.data);
  if(!row.id||typeof row.id!=='string'||typeof row.version!=='number'||safeInteger(row.version)<1)throw new StorageError('invalid_usage','Invalid source identity/version');
  const allowed=new Set(model.fields.map(field=>field.path)),containers=new Set<string>();
  for(const field of model.fields){const parts=field.path.split('.');for(let index=1;index<parts.length;index++)containers.add(parts.slice(0,index).join('.'));}
  const present:string[]=[],nulls:string[]=[],values=new Map<string,unknown>();
  function walk(object:JsonObject,prefix=''):void {
    for(const[key,value]of Object.entries(object)){
      const path=prefix?`${prefix}.${key}`:key;
      if(!allowed.has(path)&&!containers.has(path))throw new StorageError('invalid_usage',`Unmapped field in ${model.logical}: ${path}`);
      present.push(path);if(value===null){nulls.push(path);continue;}
      const field=model.fields.find(item=>item.path===path);
      if(field)values.set(path,normalizeField(field,value));
      else {if(typeof value!=='object'||Array.isArray(value))throw new StorageError('invalid_usage',`Invalid structured ${path}`);walk(value,path);}
    }
  }
  walk(row.data);
  if(model.logical==='perception_catalog'&&row.data.kind==='object_history'){
    const content=row.data.content as JsonObject;encode(resolveModel('perception_objects',{id:String(row.data.objectId),version:row.data.contentVersion as number,data:content}),{id:String(row.data.objectId),version:row.data.contentVersion as number,data:content});
  }
  const columns=['id','version','_present','_nulls'],output:unknown[]=[row.id,row.version,present,nulls];
  for(const field of directFields(model)){
    if(field.kind==='authorization'){
      const value=values.get(field.path);columns.push(`${column(field.path)}_number`,`${column(field.path)}_hash`);output.push(typeof value==='number'?value:null,typeof value==='string'?value:null);continue;
    }
    columns.push(column(field.path));output.push(values.get(field.path)??null);
    if(field.kind==='document'||field.kind==='array'){
      columns.push(`${column(field.path)}_text`);output.push(values.get(field.path)??null);
    }
  }
  return {columns,values:output};
}

function getPath(data:JsonObject,path:string):JsonValue|undefined{return path.split('.').reduce<JsonValue|undefined>((value,key)=>value&&typeof value==='object'&&!Array.isArray(value)?value[key]:undefined,data);}
function setPath(data:JsonObject,path:string,value:JsonValue):void {
  const keys=path.split('.');let target=data;for(const key of keys.slice(0,-1)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};target=target[key] as JsonObject;}
  Object.defineProperty(target,keys.at(-1)!,{value,writable:true,configurable:true,enumerable:true});
}
export async function decode(client:PoolClient,model:Model,stored:Record<string,unknown>):Promise<StoredRow> {
  const data:JsonObject={},present=stored._present as string[],nulls=new Set(stored._nulls as string[]);
  for(const path of present){if(nulls.has(path)){setPath(data,path,null);continue;}const field=directFields(model).find(item=>item.path===path);
    if(!field){if(!model.fields.some(item=>item.path===path))setPath(data,path,{});continue;}
    const value=stored[column(path)];
    if(field.kind==='integer')setPath(data,path,safeInteger(value));
    else if(field.kind==='authorization')setPath(data,path,stored[`${column(path)}_number`]!=null?safeInteger(stored[`${column(path)}_number`]):stored[`${column(path)}_hash`] as string);
    else if(field.kind==='timestamp')setPath(data,path,new Date(value as string).getTime());
    else if(field.kind==='document'||field.kind==='array')setPath(data,path,JSON.parse(stored[`${column(path)}_text`] as string) as JsonValue);
    else setPath(data,path,value as JsonValue);
  }
  for(const split of splitFields(model)){
    if(!present.includes(split.path)||nulls.has(split.path))continue;
    if(split.mode==='confirmation'){
      const result=await client.query('SELECT confirmed_content_version,confirmed_at FROM mailbox.agent_version_confirmations WHERE parent_id=$1',[stored.id]);
      const value=result.rows[0]?.[split.path==='confirmedAt'?'confirmed_at':'confirmed_content_version'];
      data[split.path]=split.path==='confirmedAt'?new Date(value).getTime():safeInteger(value);continue;
    }
    const result=await client.query(`SELECT * FROM ${split.table} WHERE parent_id=$1${split.mode==='profile'?' AND stage=$2':''} ORDER BY ordinal`,split.mode==='profile'?[stored.id,split.path]:[stored.id]);
    if(split.mode==='profile'){data[split.path]=JSON.parse(result.rows[0]?.content_text??'{}') as JsonObject;continue;}
    if(split.mode==='snapshot'){
      const snapshot:JsonObject={};for(const item of result.rows){if(item.collection_index===null)snapshot[item.entry_key]=JSON.parse(item.entry_text);else if(item.collection_index===-1)snapshot[item.entry_key]=[];else(snapshot[item.entry_key] as JsonValue[]).push(JSON.parse(item.entry_text));}data[split.path]=snapshot;continue;
    }
    if(split.mode==='map')data[split.path]=Object.fromEntries(result.rows.map(item=>[item.entry_key,JSON.parse(item.entry_text)])) as JsonObject;
    else data[split.path]=result.rows.map(item=>JSON.parse(item.entry_text)) as JsonValue[];
  }
  return {id:String(stored.id),version:safeInteger(stored.version),data};
}

export async function writeChildren(client:PoolClient,model:Model,row:StoredRow):Promise<void>{
  const splits=splitFields(model),tables=new Set(splits.map(item=>item.table));
  for(const table of tables)await client.query(`DELETE FROM ${table} WHERE parent_id=$1`,[row.id]);
  for(const split of splits){const value=getPath(row.data,split.path);if(value===undefined||value===null)continue;
    if(split.mode==='confirmation')continue;
    if(split.mode==='profile'){
      const content=value as JsonObject,known=['displayName','bio','interests','avatar'];
      if(Object.keys(content).some(key=>!known.includes(key)))throw new StorageError('invalid_usage','Unmapped profile content');
      for(const key of ['displayName','bio'])if(content[key]!=null&&typeof content[key]!=='string')throw new StorageError('invalid_usage','Invalid profile text');
      if(content.interests!=null&&(!Array.isArray(content.interests)||!content.interests.every(item=>typeof item==='string')))throw new StorageError('invalid_usage','Invalid profile interests');
      const avatar=content.avatar as JsonObject|null|undefined;
      if(avatar!=null&&(typeof avatar!=='object'||Array.isArray(avatar)))throw new StorageError('invalid_usage','Invalid profile avatar');
      const selectedLook=avatar!=null&&(Object.hasOwn(avatar,'lookId')||Object.hasOwn(avatar,'catalogVersion'));
      if(selectedLook){
        if(Object.keys(avatar!).length!==2||typeof avatar!.lookId!=='string'||!profileLookIds.has(avatar!.lookId)||avatar!.catalogVersion!==profileCatalogVersion)throw new StorageError('invalid_usage','Invalid profile appearance selection');
      }else if(avatar&&Object.keys(avatar).some(key=>!['template','color'].includes(key)))throw new StorageError('invalid_usage','Unmapped avatar parameter');
      // Keep the original content, including optional/null legacy fields. The
      // mirrors describe its union branch; they never replace old avatar facts.
      await client.query(`INSERT INTO profiles.profile_contents(parent_id,stage,ordinal,display_name,bio,interests,avatar_template,avatar_color,avatar_look_id,avatar_catalog_version,content_schema_version,content_text)
        VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[row.id,split.path,content.displayName??null,content.bio??null,content.interests??null,avatar?.template??null,avatar?.color??null,selectedLook?avatar!.lookId:null,selectedLook?avatar!.catalogVersion:null,selectedLook?2:1,JSON.stringify(content)]);continue;
    }
    if(split.mode==='snapshot'){
      let ordinal=0;for(const[key,entry]of Object.entries(value as JsonObject)){
        if(!['worlds','modules','types','sources','categories','skills','operations','catalogRevision','skillCatalogRevision','schemaReader','guideReader','notEnabled'].includes(key))throw new StorageError('invalid_usage','Unknown frozen catalog field');
        const parts=Array.isArray(entry)?[[-1,[]],...entry.map((item,index)=>[index,item])]:[[null,entry]];
        for(const[index,item]of parts)await client.query(`INSERT INTO ${split.table}(parent_id,ordinal,entry_key,entry_schema_version,entry_text,collection_index) VALUES($1,$2,$3,1,$4,$5)`,[row.id,ordinal++,key,JSON.stringify(item),index]);
      }continue;
    }
    if(split.table==='perception.read_session_grants')for(const entry of Object.values(value as JsonObject))if(entry!==null&&!(typeof entry==='number'&&Number.isSafeInteger(entry)&&entry>0)&&!(typeof entry==='string'&&/^[0-9a-f]{64}$/.test(entry)))throw new StorageError('invalid_usage','Invalid frozen grant authorization version');
    const entries=split.mode==='map'?Object.entries(value as JsonObject):(value as JsonValue[]).map((entry,index)=>[String(index),entry] as const);
    for(const[index,[key,entry]]of entries.entries())await client.query(`INSERT INTO ${split.table}(parent_id,ordinal,entry_key,entry_schema_version,entry_text${split.table==='perception.source_states'?',source_state':''}) VALUES($1,$2,$3,1,$4${split.table==='perception.source_states'?',$5':''})`,[row.id,index,key,JSON.stringify(entry),...(split.table==='perception.source_states'?[entry]:[])]);
  }
  if(model.table==='mailbox.deliveries')await client.query('INSERT INTO mailbox.agent_version_confirmations(parent_id,confirmed_content_version,confirmed_at) VALUES($1,$2,$3)',[row.id,row.data.confirmedContentVersion??null,row.data.confirmedAt==null?null:new Date(row.data.confirmedAt as number)]);
}
