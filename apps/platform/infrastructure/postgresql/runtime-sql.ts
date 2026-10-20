import type { QueryResultRow } from 'pg';
import { StorageError, type JsonObject } from '../../contracts/store.ts';
import { RuntimeError } from '../../contracts/runtime-store.ts';
import { checkedJson, safeInteger } from './codec.ts';
import { storageError } from './errors.ts';
import type { PostgresScope } from './transaction-host.ts';

export function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||safeInteger(value)<min||value>max)throw new RuntimeError('invalid_usage','Invalid bounded integer');return value;}
export function number(value:unknown):number{const result=Number(value);return integer(result);}
export function text(value:unknown,max=256):string{if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))throw new RuntimeError('invalid_usage','Invalid stable text identifier');return value;}
export function document(value:unknown):JsonObject{checkedJson(value);if(!value||Array.isArray(value)||typeof value!=='object'||Buffer.byteLength(JSON.stringify(value))>65536)throw new RuntimeError('invalid_usage','Expected a bounded JSON object');return value as JsonObject;}
export function same(left:unknown,right:unknown):boolean{return JSON.stringify(left)===JSON.stringify(right);}
export function checkVersion(value:number,expected:number|null):void{integer(value,1);if(expected===null?value!==1:value!==integer(expected,1)+1)throw new RuntimeError('invalid_usage','A write must advance exactly one version');}
export interface RuntimeSql {
 readonly scope:PostgresScope;now():number;alive():void;writable():void;
 query<T extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[]):Promise<T[]>;
 mutate<T extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[]):Promise<T[]>;
 cas(sql:string,values:unknown[]):Promise<void>;
}
export function runtimeSql(scope:PostgresScope,clock:()=>number):RuntimeSql{
 const alive=()=>{if(!scope.alive())throw new StorageError('closed','Runtime scope has ended');};
 const writable=()=>{alive();if(!scope.write)throw new StorageError('invalid_usage','Runtime read scopes cannot write');};
 async function query<T extends QueryResultRow>(sql:string,values:unknown[]=[]):Promise<T[]>{alive();try{return (await scope.client.query<T>(sql,values)).rows;}catch(error){throw storageError(error);}}
 return {scope,alive,writable,now:()=>{alive();return integer(clock());},query,
  mutate:async<T extends QueryResultRow>(sql:string,values:unknown[]=[])=>{writable();return query<T>(sql,values);},
  cas:async(sql,values)=>{writable();const rows=await query(sql,values);if(rows.length!==1)throw new RuntimeError('version_conflict','The object version changed');}};
}
