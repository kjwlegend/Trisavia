import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {createOwnerInteractionReader,readOwnerInteractionResponse,interactionStatus} from '../../apps/web/public/hud/owner-interaction-reader.js';
const ref={artifactId:'work-a',revision:2};
const artifact=(authorAgentId='agent-a')=>({artifact:ref,version:3,authorAgentId,title:'合成作品',createdAt:1,withdrawnAt:null,contentAvailable:true});
const envelope=(data:unknown)=>({protocolVersion:1,instanceId:'synthetic',data});
const list=(agentId='agent-a')=>envelope({agentId,items:[artifact(agentId)],complete:true,nextCursor:null,asOf:2});
const exchange=(direction='sent',status='reply_received')=>({invitationId:'invitation-a',direction,artifact:ref,title:'合成作品',counterpart:{agentId:'other-a',displayName:'合成收件人'},status,createdAt:1,contentAvailable:true});
function session(){let context={authenticated:true,phase:'ready',observationRevision:1,selectedAgentId:'agent-a',agents:[{agentId:'agent-a'},{agentId:'agent-b'}]};const listeners=new Set<(value:any)=>void>();return{snapshot:()=>context,subscribe(fn:(value:any)=>void){listeners.add(fn);fn(context);return()=>listeners.delete(fn);},switchAgent(id:string){context={...context,selectedAgentId:id,observationRevision:context.observationRevision+1};for(const fn of listeners)fn(context);},readInteraction:async(_operation:string,_input:any,_options:any):Promise<any>=>list(context.selectedAgentId)};}
test('Owner projections keep only authorized current content and preserve exact artifact revision and natural states',()=>{
 const item={...ref,version:3,authorAgentId:'agent-a',title:'合成作品',createdAt:1,withdrawnAt:9,body:'MUST HIDE'};
 const data=readOwnerInteractionResponse(envelope({agentId:'agent-a',artifact:item,contentAvailable:false,asOf:2}),{agentId:'agent-a',view:'artifacts',detail:true,reference:ref});assert.equal(data.artifact.body,null);
 assert.throws(()=>readOwnerInteractionResponse(list('agent-b'),{agentId:'agent-a',view:'artifacts'}));assert.throws(()=>readOwnerInteractionResponse(envelope({agentId:'agent-a',artifact:item,contentAvailable:true,asOf:2}),{agentId:'agent-a',view:'artifacts',detail:true,reference:{...ref,revision:1}}));
 const response=readOwnerInteractionResponse(envelope({agentId:'agent-a',exchange:{...exchange(),contentAvailable:false},artifact:item,intent:'MUST HIDE',feedback:{id:'feedback-a',activityId:'activity-a',authorAgentId:'other-a',version:1,body:'MUST HIDE',submittedAt:2,withdrawnAt:null},asOf:2}),{agentId:'agent-a',view:'exchanges',direction:'sent',detail:true,reference:'invitation-a'});assert.doesNotMatch(JSON.stringify(response),/MUST HIDE/u);
 assert.equal(interactionStatus(exchange()),'已收到回复');assert.equal(interactionStatus(exchange('received')),'已回复');assert.equal(interactionStatus(exchange('sent','awaiting_feedback')),'已接受，待回复');
});
test('Owner switch clears source text immediately and ignores a late previous Agent response',async()=>{
 const s=session();let release:(value:unknown)=>void=()=>{},signal:AbortSignal|undefined;const calls:string[]=[];s.readInteraction=async(operation,_input,options)=>{calls.push(s.snapshot().selectedAgentId);if(s.snapshot().selectedAgentId==='agent-a'){signal=options.signal;return new Promise(done=>{release=done;});}return list('agent-b');};
 const reader=createOwnerInteractionReader(s);reader.setActive(true);s.switchAgent('agent-b');assert.equal(signal?.aborted,true);assert.deepEqual(reader.snapshot().items,[]);await new Promise(done=>setTimeout(done,0));assert.equal(reader.snapshot().items[0].authorAgentId,'agent-b');release(list());await new Promise(done=>setTimeout(done,0));assert.equal(reader.snapshot().items[0].authorAgentId,'agent-b');reader.setActive(false);assert.deepEqual(reader.snapshot().items,[]);assert.deepEqual(calls,['agent-a','agent-b']);reader.dispose();
});
test('detail rejection removes previously read body and pagination never claims partial data is complete',async()=>{
 const s=session();let denied=false;s.readInteraction=async(operation,input)=>operation==='artifacts'?envelope({agentId:'agent-a',items:[artifact()],complete:false,nextCursor:'next-page',asOf:2}):denied?Promise.reject(Object.assign(new Error('revoked'),{status:404})):envelope({agentId:'agent-a',artifact:{...ref,version:3,authorAgentId:'agent-a',title:'合成作品',createdAt:1,withdrawnAt:null,body:'合成正文'},contentAvailable:true,asOf:2});
 const reader=createOwnerInteractionReader(s);reader.setActive(true);await new Promise(done=>setTimeout(done,0));assert.equal(reader.snapshot().complete,false);await reader.detail(artifact());assert.equal(reader.snapshot().detail.artifact.body,'合成正文');denied=true;const pending=reader.detail(artifact());assert.equal(reader.snapshot().detail,null);await pending;assert.equal(reader.snapshot().detailPhase,'error');assert.equal(reader.snapshot().detail,null);reader.dispose();
});
