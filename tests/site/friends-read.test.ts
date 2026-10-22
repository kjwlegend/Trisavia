import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser source is plain JavaScript.
import {createFriendsReadProvider,readFriendsResponse} from '../../apps/web/public/hud/friends-read-provider.js';
const row={agentId:'friend-a',relationshipId:'relationship-a',status:'confirmed',version:1,intimacyScore:0,confirmedAt:100,profile:{displayName:'好友甲',appearance:{lookId:'sunnyside-human-longhair',catalogVersion:'2026-10-21.appearance-v1.1'},publishedVersion:1}};
const response=(agentId:string,friends:unknown[]=[row])=>({protocolVersion:1,instanceId:'synthetic',data:{agentId,friends,complete:true,nextCursor:null,asOf:200}});
function session(readFriends:(options:{signal:AbortSignal})=>Promise<unknown>){
 let state={authenticated:true,phase:'ready',observationRevision:1,selectedAgentId:'a',agents:[{agentId:'a'},{agentId:'b'}]};const listeners=new Set<(value:typeof state)=>void>();
 return{snapshot:()=>structuredClone(state),readFriendship:(_view:string,_input:unknown,options:{signal:AbortSignal})=>readFriends(options),setRead(next:typeof readFriends){readFriends=next;},subscribe(listener:(value:typeof state)=>void){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},select(agentId:string){state={...state,selectedAgentId:agentId,observationRevision:state.observationRevision+1};for(const listener of listeners)listener(state);},logout(){state={...state,authenticated:false,selectedAgentId:'',observationRevision:state.observationRevision+1};for(const listener of listeners)listener(state);}};
}
test('friend response admits only confirmed, unique relationships for the requested Agent and public profile fields',()=>{
 const value=readFriendsResponse(response('a',[{...row,online:true,privateEmail:'PRIVATE',profile:{...row.profile,ownerId:'PRIVATE'}}]),'a');assert.doesNotMatch(JSON.stringify(value),/PRIVATE|online/u);
 for(const invalid of [response('b'),response('a',[{...row,status:'pending'}]),response('a',[row,row]),response('a',[{...row,agentId:'a'}]),{...response('a'),data:{...response('a').data,complete:false}}])assert.throws(()=>readFriendsResponse(invalid,'a'));
});
test('switching Agent and logging out cancel old reads, clear rows immediately, and ignore late results',async()=>{
 let release:(value:unknown)=>void=()=>{},oldSignal:AbortSignal|undefined;const source=session(async({signal})=>{oldSignal=signal;return new Promise(resolve=>{release=resolve;});}),reader=createFriendsReadProvider(source);
 const old=reader.load();source.setRead(async()=>response('b',[{...row,agentId:'friend-b'}]));source.select('b');assert.equal(oldSignal?.aborted,true);assert.deepEqual(reader.snapshot().friends,[]);release(response('a'));await old;assert.notEqual(reader.snapshot().agentId,'a');
 await reader.load();assert.equal(reader.snapshot().friends[0].agentId,'friend-b');source.logout();assert.deepEqual(reader.snapshot().friends,[]);assert.equal(reader.snapshot().phase,'session');reader.dispose();
});
test('read failures never become an empty successful list, and anonymous/no-Agent states do not read',async()=>{
 let calls=0;const source=session(async()=>{calls++;throw Object.assign(new Error('source failed'),{status:503});}),reader=createFriendsReadProvider(source);await reader.load();assert.equal(reader.snapshot().phase,'error');assert.equal(reader.snapshot().errorStatus,503);source.select('');await reader.load();source.logout();await reader.load();assert.equal(calls,1);reader.dispose();
});
