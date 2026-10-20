import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JavaScript.
import {createOwnerWorldSummaryReader,readOwnerWorldSummary} from '../../apps/web/public/hud/owner-world-summary.js';
const first={agentId:'first'},second={agentId:'second'};
const context=(selectedAgentId='first',observationRevision=1)=>({authenticated:true,phase:'ready',selectedAgentId,observationRevision,agents:[first,second]});
const caps={instanceId:'summary-test-instance',gateway:{protocolVersion:1,catalogRevision:'catalog-1',modules:['world','interaction']}};
const source={kind:'interaction_fact_summary',version:1,ownerObservation:'current-binding-fact-summary',privateText:false};
const summary=(agentId='first',items:unknown[]=[],complete=true,nextCursor:string|null=null)=>({agentId,asOf:1000,scope:'own-agent-fact-summary',source,items,complete,nextCursor});
const item=(id:string)=>({invitationId:id,invitationState:'accepted',activityId:`activity-${id}`,activityState:'waiting_ack',outcome:'submitted_unconfirmed',createdAt:10});
const envelope=(data:unknown)=>({protocolVersion:1,instanceId:caps.instanceId,data});
const discovery={catalogRevision:'catalog-1',operations:[{id:'interaction.owner_summary',moduleId:'interaction',kind:'query',actors:['owner'],http:{method:'POST',path:'/v1/gateway/query'},inputSchema:{id:'interaction.owner_summary.input',version:2},outputSchema:{id:'interaction.owner_summary.output',version:2},usageGuide:{moduleId:'interaction',version:3}}]};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
type State=ReturnType<typeof context>;
function harness(answer:(operation:string,input:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>=async()=>envelope(summary())){
 let state=context();const subscribers=new Set<(value:State)=>void>(),calls:Array<{operation:string;input:Record<string,unknown>;signal:AbortSignal}>=[];
 const reader=createOwnerWorldSummaryReader({subscribe(fn:(value:State)=>void){subscribers.add(fn);fn(state);return()=>subscribers.delete(fn);},
  async read(operation:string,input:Record<string,unknown>,{signal}:{signal:AbortSignal}){calls.push({operation,input,signal});return operation==='capabilities'?caps:operation==='discovery'?envelope(discovery):operation==='schema'?envelope({schemaId:input.schemaId,version:input.version,document:{}}):operation==='guide'?envelope({moduleId:input.moduleId,version:input.version,document:{}}):answer(operation,input,signal);},
 });
 return{reader,calls,emit(value:State){state=value;for(const fn of subscribers)fn(state);}};
}

test('owner fact projection excludes counterpart names and private text, and rejects an unapproved source',()=>{
 const data=summary('first',[{...item('one'),counterpartId:'PRIVATE_OTHER',title:'PRIVATE_TITLE',text:'PRIVATE_BODY'}]);
 assert.doesNotMatch(JSON.stringify(readOwnerWorldSummary(data,'first')),/PRIVATE_/u);
 assert.throws(()=>readOwnerWorldSummary({...data,source:{...source,privateText:true}},'first'),/summary_response_invalid/u);
 assert.throws(()=>readOwnerWorldSummary(data,'second'),/summary_response_invalid/u);
});

test('summary reads only while active, verifies advertised owner operation and preserves genuine empty completeness',async()=>{
 const {reader,calls}=harness();await flush();assert.equal(calls.length,0);
 reader.setActive(true);await flush();assert.deepEqual(calls.map(call=>call.operation),['capabilities','discovery','schema','schema','guide','summary']);
 assert.deepEqual(calls.filter(call=>call.operation==='schema').map(call=>call.input.version),[2,2]);assert.equal(calls.find(call=>call.operation==='guide')?.input.version,3,'Exact document versions come from discovery, separately from protocol 1');
 assert.equal(reader.snapshot().phase,'ready');assert.equal(reader.snapshot().complete,true);assert.deepEqual(reader.snapshot().items,[]);
 reader.setActive(false);assert.equal(reader.snapshot().phase,'idle');assert.equal(reader.snapshot().asOf,null);reader.dispose();
});

test('unsupported service does not guess a summary query or turn unavailable into empty success',async()=>{
 let queried=0;
 const reader=createOwnerWorldSummaryReader({subscribe(fn:(value:State)=>void){fn(context());return()=>{};},async read(){queried++;return{gateway:{protocolVersion:1,modules:['world']}};}});
 reader.setActive(true);await flush();assert.equal(queried,1);assert.equal(reader.snapshot().phase,'unavailable');assert.equal(reader.snapshot().complete,false);reader.dispose();
});

test('an interaction module alone cannot authorize an absent or Agent-only owner summary operation',async()=>{
 for(const operations of [[],[{...discovery.operations[0],actors:['agent']}]]){
  const calls:string[]=[];
  const reader=createOwnerWorldSummaryReader({subscribe(fn:(value:State)=>void){fn(context());return()=>{};},async read(operation:string){calls.push(operation);return operation==='capabilities'?caps:envelope({...discovery,operations});}});
  reader.setActive(true);await flush();assert.equal(reader.snapshot().phase,'unavailable');assert.deepEqual(calls,['capabilities','discovery']);reader.dispose();
 }
});

test('manual continuation uses the opaque token; rejected continuation clears every previous row and refresh starts fresh',async()=>{
 let denied=false;const {reader,calls}=harness(async(_operation,input)=>{if(denied)throw Object.assign(new Error('revoked'),{code:'target_not_accessible',status:404});return envelope(input.cursor?summary('first',[item('two')]):summary('first',[item('one')],false,'opaque'));});
 reader.setActive(true);await flush();assert.equal(reader.snapshot().phase,'partial');await reader.loadMore();assert.equal(reader.snapshot().items.length,2);
 await reader.refresh();denied=true;await reader.loadMore();assert.equal(reader.snapshot().phase,'error');assert.deepEqual(reader.snapshot().items,[]);
 denied=false;await reader.refresh();assert.deepEqual(calls.filter(call=>call.operation==='summary').at(-1)?.input,{});reader.dispose();
});

test('switching Agent or Owner observation revision clears immediately, cancels old reads, and ignores late facts',async()=>{
 let release:(value:unknown)=>void=()=>{},round=0;
 const {reader,calls,emit}=harness(async()=>++round===1?new Promise(resolve=>{release=resolve;}):envelope(summary('second',[item('fresh')])));
 reader.setActive(true);await flush();const old=calls.at(-1)!;emit(context('second',2));assert.equal(old.signal.aborted,true);assert.deepEqual(reader.snapshot().items,[]);
 await flush();assert.equal(reader.snapshot().items[0].invitationId,'fresh');release(envelope(summary('first',[item('stale')])));await flush();assert.equal(reader.snapshot().items[0].invitationId,'fresh');
 emit({...context('second',3),authenticated:false,phase:'expired'});assert.equal(reader.snapshot().phase,'unauthorized');assert.deepEqual(reader.snapshot().items,[]);reader.dispose();
});

test('closing during a late response and disposing both suppress delivery without reader-state writes',async()=>{
 let release:(value:unknown)=>void=()=>{};const {reader,calls}=harness(async()=>new Promise(resolve=>{release=resolve;}));
 reader.setActive(true);await flush();reader.setActive(false);assert.equal(calls.at(-1)!.signal.aborted,true);
 release(envelope(summary('first',[item('late')])));await flush();assert.deepEqual(reader.snapshot().items,[]);
 reader.setActive(true);await flush();reader.dispose();assert.equal(calls.at(-1)!.signal.aborted,true);release(envelope(summary('first',[item('destroyed')])));await flush();assert.deepEqual(reader.snapshot().items,[]);
 assert.ok(calls.every(call=>['capabilities','discovery','schema','guide','summary'].includes(call.operation)));
});
