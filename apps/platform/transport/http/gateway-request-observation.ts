import {writeSync} from 'node:fs';
/** Quota diagnostics contain registered route templates and cumulative counts only. */
export interface GatewayQuotaRoute {
 readonly method:'GET'|'POST';
 readonly route:string;
 /** This describes the route, never the identity or authentication of its caller. */
 readonly requestClass:'public_read'|'gateway_operation';
}
export type GatewayQuotaDiagnosticSink=(line:string)=>void|Promise<void>;
interface RouteCount extends GatewayQuotaRoute {allowed:number;rejected:number}
interface Counts {at:number;allowed:number;rejected:number;routes:Map<string,RouteCount>;reportedAt?:number}
const WINDOW_MS=60_000,REPORT_INTERVAL_MS=10_000;
function counts(at:number):Counts{return {at,allowed:0,rejected:0,routes:new Map()};}
function record(state:Counts,route:GatewayQuotaRoute,allowed:boolean):void {
 const key=`${route.method} ${route.route}`,entry=state.routes.get(key)??{...route,allowed:0,rejected:0};
 if(allowed){state.allowed++;entry.allowed++;}else{state.rejected++;entry.rejected++;}
 state.routes.set(key,entry);
}
/** No timer, durable state, client identifier, request payload or arbitrary error logging. */
export function createGatewayQuotaObservation(write:GatewayQuotaDiagnosticSink=line=>{writeSync(2,line);}){
 const windows=new WeakMap<object,Counts>();let capacity:Counts|undefined;
 function emit(state:Counts,at:number,route:GatewayQuotaRoute,quota:Record<string,unknown>):void {
  if(state.reportedAt!==undefined&&at-state.reportedAt<REPORT_INTERVAL_MS)return;
  state.reportedAt=at;
  // A failed diagnostic sink must neither change quota state nor the HTTP result.
  try{
   const pending=write(`${JSON.stringify({event:'gateway_quota_rejected',snapshotKind:'cumulative',time:new Date(at).toISOString(),...route,status:429,quota:{...quota,attempts:state.allowed+state.rejected,allowed:state.allowed,rejected:state.rejected,routes:[...state.routes.values()].map(entry=>({...entry}))}})}\n`);
   if(pending)void Promise.resolve(pending).catch(()=>{});
  }catch{}
 }
 return {
  attempt(window:{at:number},route:GatewayQuotaRoute,allowed:boolean){
   let state=windows.get(window);if(!state||state.at!==window.at){state=counts(window.at);windows.set(window,state);}record(state,route,allowed);
  },
  rejected(window:{at:number},route:GatewayQuotaRoute,at:number,retryAfterSeconds:number){
   const state=windows.get(window);if(!state)return;
   emit(state,at,route,{reason:'window_limit',limit:240,windowMs:WINDOW_MS,windowStartedAt:window.at,windowEndsAt:window.at+WINDOW_MS,retryAfterSeconds});
  },
  capacityRejected(route:GatewayQuotaRoute,at:number,trackedWindows:number){
   if(!capacity||at-capacity.at>=WINDOW_MS)capacity=counts(at);record(capacity,route,false);
   // This is a map-capacity episode, not a known request-IP window deadline.
   emit(capacity,at,route,{reason:'map_capacity',limit:240,windowMs:WINDOW_MS,windowStartedAt:null,windowEndsAt:null,capacityEpisodeStartedAt:capacity.at,trackedWindows,maximumTrackedWindows:10_000,retryAfterSeconds:60});
  },
 };
}
