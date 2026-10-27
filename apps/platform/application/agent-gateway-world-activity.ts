import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation} from './agent-gateway.ts';
const changed=new Set(['world.movement','world.avatar.create','world.avatar.move','world.avatar.leave','world.movement.stop']);
/** New exact output, with valid legacy/current pairs; the old schema objects are never mutated. */
export function withCurrentMovementOperations(operations:GatewayOperation[]):GatewayOperation[]{
 const convert=(v:any):any=>{
  if(Array.isArray(v))return v.map(convert);if(!v||typeof v!=='object')return v;
  const out=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,convert(x)])) as any,p=out.properties;
  if(p?.policyVersion?.const===1&&p?.stepIntervalMs?.const===1000){
   p.policyVersion={enum:[1,2]};p.stepIntervalMs={enum:[1000,500]};
   out.oneOf=[{properties:{policyVersion:{const:1},stepIntervalMs:{const:1000}}},{properties:{policyVersion:{const:2},stepIntervalMs:{const:500}}}];
  }
  return out;
 };
 return operations.map(o=>changed.has(o.id)?{...o,schemaVersion:3,output:convert(o.output) as JsonObject}:o);
}
