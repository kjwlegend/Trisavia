import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {projectOwnedAgents,createOwnedAgentBinding} from '../../apps/web/public/hud/owned-agents.js';

type Projection={agents:Array<{agentId:string;name:string;avatar:{template:string;color:string};profileSource:string}>;selectedAgentId:string};
type State=Record<string,unknown>;
const first={agentId:'agent_map_first',name:'测试甲 <span>名字 & 文本</span>',avatar:{template:'basic',color:'blue'},profileSource:'published'};
const second={agentId:'agent_map_second',name:'测试乙（草稿）',avatar:{template:'basic',color:'coral'},profileSource:'draft'};
const other={agentId:'agent_other_owner',name:'另一主人的测试 Agent',avatar:{template:'basic',color:'olive'},profileSource:'published'};
const ready=(agents=[first,second],selectedAgentId=first.agentId):State=>({authenticated:true,phase:'ready',agents,selectedAgentId});
const empty={agents:[],selectedAgentId:''};

function session(initial:State){
 let current=initial;const listeners=new Set<(value:State)=>void>();
 return{
  subscribe(listener:(value:State)=>void){listeners.add(listener);listener(current);return()=>listeners.delete(listener);},
  emit(value:State){current=value;for(const listener of [...listeners])listener(value);},
  queued(value:State){const pending=[...listeners];return()=>{for(const listener of pending)listener(value);};},
  get subscriptions(){return listeners.size;},
 };
}
function scene(){const calls:Projection[]=[];return{calls,setOwnedAgents(value:Projection){calls.push(value);}};}
const latest=(target:ReturnType<typeof scene>)=>target.calls.at(-1);

test('owned Agent projection keeps one current target in ready and refreshing snapshots',()=>{
 for(const phase of ['ready','refreshing']){
  const input={...ready([first,second,first],second.agentId),phase};
  const actual=projectOwnedAgents(input) as Projection;
  assert.deepEqual(actual.agents.map(agent=>agent.agentId),[first.agentId,second.agentId]);
  assert.equal(actual.selectedAgentId,second.agentId);
  assert.equal(actual.agents.filter(agent=>agent.agentId===actual.selectedAgentId).length,1);
  assert.equal(actual.agents[0]?.name,first.name);
  assert.equal(actual.agents[0]?.profileSource,'published');
  assert.equal(actual.agents[1]?.profileSource,'draft');
 }
});

test('non-ready or unauthenticated snapshots clear residents and selection even with old rows present',()=>{
 for(const phase of ['loading','anonymous','error','expired'])assert.deepEqual(projectOwnedAgents({...ready(),phase}),empty);
 for(const authenticated of [false,undefined])assert.deepEqual(projectOwnedAgents({...ready(),authenticated}),empty);
 assert.deepEqual(projectOwnedAgents(ready([])),empty);
 assert.equal(projectOwnedAgents(ready([first],'agent_not_owned')).selectedAgentId,'');
});

test('world projection allowlists display fields and never forwards account, proof or raw draft data',()=>{
 const input={...ready(),ownerId:'PRIVATE_OWNER_SENTINEL',email:'PRIVATE_EMAIL_SENTINEL',sessionToken:'PRIVATE_SESSION_SENTINEL',
  agents:[{...first,ownerId:'PRIVATE_ROW_OWNER',email:'PRIVATE_ROW_EMAIL',runtimeToken:'PRIVATE_RUNTIME_SENTINEL',
   draft:{bio:'PRIVATE_DRAFT_SENTINEL'},bio:'PRIVATE_BIO_SENTINEL',interests:['PRIVATE_INTEREST_SENTINEL'],
   avatar:{...first.avatar,secret:'PRIVATE_AVATAR_SENTINEL'}}]};
 const actual=projectOwnedAgents(input) as Projection;
 assert.deepEqual(Object.keys(actual).sort(),['agents','selectedAgentId']);
 assert.deepEqual(Object.keys(actual.agents[0]!).sort(),['agentId','avatar','name','profileSource']);
 assert.deepEqual(Object.keys(actual.agents[0]!.avatar).sort(),['color','template']);
 assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_/u);
 const target=scene(),binding=createOwnedAgentBinding(session(input));binding.attach(target);
 assert.deepEqual(latest(target),actual);assert.doesNotMatch(JSON.stringify(target.calls),/PRIVATE_/u);binding.dispose();
 const fallback=projectOwnedAgents(ready([{...first,avatar:{template:'external',color:'unsafe'}}])) as Projection;
 assert.deepEqual(fallback.agents[0]?.avatar,{template:'basic',color:'cream'});
});

test('late scene attachment receives only the latest snapshot and detach clears the old scene',()=>{
 const source=session(ready()),binding=createOwnedAgentBinding(source),oldScene=scene(),newScene=scene();
 source.emit(ready([other],other.agentId));source.emit({...ready(),phase:'expired'});
 binding.attach(oldScene);assert.deepEqual(latest(oldScene),empty);assert.equal(oldScene.calls.length,1);
 source.emit(ready([other],other.agentId));assert.deepEqual(latest(oldScene)?.agents.map(agent=>agent.agentId),[other.agentId]);
 binding.attach(null);assert.deepEqual(latest(oldScene),empty);const detachedCalls=oldScene.calls.length;
 source.emit(ready([second],second.agentId));assert.equal(oldScene.calls.length,detachedCalls);
 binding.attach(newScene);assert.deepEqual(latest(newScene)?.agents.map(agent=>agent.agentId),[second.agentId]);
 assert.equal(latest(newScene)?.selectedAgentId,second.agentId);binding.dispose();
});

test('selection callbacks require the current owned set and never optimistically change the target',()=>{
 const source=session(ready()),selected:Array<[string,unknown]>=[],origin={label:'canvas focus origin'},target=scene();
 const binding=createOwnedAgentBinding(source,(agentId:string,from:unknown)=>selected.push([agentId,from]));binding.attach(target);
 binding.select(second.agentId,origin);assert.deepEqual(selected,[[second.agentId,origin]]);
 assert.equal(latest(target)?.selectedAgentId,first.agentId);
 binding.select('agent_not_owned',origin);assert.equal(selected.length,1);
 source.emit({...ready(),phase:'anonymous'});binding.select(second.agentId,origin);
 assert.deepEqual(latest(target),empty);assert.equal(selected.length,1);
 source.emit(ready([other],other.agentId));binding.select(first.agentId,origin);assert.equal(selected.length,1);
 binding.select(other.agentId,origin);assert.deepEqual(selected.at(-1),[other.agentId,origin]);binding.dispose();
});

test('each scene delivery is independent of upstream state and previous renderer mutations',()=>{
 const input=ready(),source=session(input),binding=createOwnedAgentBinding(source),firstScene=scene(),secondScene=scene();
 binding.attach(firstScene);const delivered=latest(firstScene)!;
 delivered.agents[0]!.avatar.color='cream';delivered.agents[0]!.name='renderer local mutation';delivered.selectedAgentId='not_current';
 binding.attach(secondScene);
 assert.equal(latest(secondScene)?.agents[0]?.avatar.color,'blue');assert.equal(latest(secondScene)?.agents[0]?.name,first.name);
 assert.equal(latest(secondScene)?.selectedAgentId,first.agentId);
 assert.deepEqual(input,ready());assert.deepEqual(latest(firstScene),empty);binding.dispose();
});

test('dispose clears the scene and ignores already queued updates or old selection callbacks',()=>{
 const source=session(ready()),target=scene(),selected:string[]=[],binding=createOwnedAgentBinding(source,(id:string)=>selected.push(id));
 binding.attach(target);const queued=source.queued(ready([other],other.agentId));
 binding.dispose();assert.equal(source.subscriptions,0);assert.deepEqual(latest(target),empty);const count=target.calls.length;
 queued();source.emit(ready());binding.select(first.agentId,{});const afterDispose=scene();binding.attach(afterDispose);binding.dispose();
 assert.equal(target.calls.length,count);assert.deepEqual(selected,[]);assert.equal(latest(afterDispose)?.agents.length??0,0);
});
