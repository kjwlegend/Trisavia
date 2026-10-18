import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {projectOwnedAgents,createOwnedAgentBinding} from '../../apps/web/public/hud/owned-agents.js';
// @ts-expect-error Browser module is intentionally plain JS.
import {createOwnedAgentMotion} from '../../apps/web/public/world-owned-motion.js';
// @ts-expect-error Browser module is intentionally plain JS.
import {WORLD_SIZE,places,roadSegments,buildRoadGraph} from '../../apps/web/public/world-scene.js';
// @ts-expect-error Generated runtime metadata is intentionally plain JS.
import {townAssets} from '../../apps/web/public/world-town/assets.js';

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

type Road=[number,number,number,number];
type Rect={left:number;right:number;top:number;bottom:number};
type MotionPoint={agentId:string;x:number;y:number;fromId:string;toId:string;progress:number;pause:number;walking:boolean;frame:number;direction:string};
type Motion={
 sync(ids:string[]):void;
 step(dt:number,options?:{paused?:boolean;visible?:boolean;heldIds?:string[]}):void;
 read(id:string):MotionPoint|null;
 clear():void;
};
const loopRoads:Road[]=[[20,20,180,20],[180,20,180,180],[180,180,20,180],[20,180,20,20]];
const lineRoad:Road[]=[[20,20,180,20]];
const motion=(roads:Road[],blockedRects:Rect[]=[])=>createOwnedAgentMotion(buildRoadGraph(roads),{blockedRects}) as Motion;
const point=(model:Motion,id:string)=>{const value=model.read(id);assert.ok(value,`Expected a live point for ${id}`);return value;};
const moved=(a:MotionPoint,b:MotionPoint)=>Math.hypot(a.x-b.x,a.y-b.y)>1e-7;
function advanceUntil(model:Motion,id:string,accept:(value:MotionPoint)=>boolean){
 for(let i=0;i<400;i++){model.step(.05);const value=point(model,id);if(accept(value))return value;}
 assert.fail(`Agent ${id} did not reach the observed movement state`);
}
function assertLegalPoint(value:MotionPoint,roads:Road[],obstacles:Rect[]){
 assert.ok(Number.isFinite(value.x)&&Number.isFinite(value.y));
 assert.ok(roads.some(([x1,y1,x2,y2])=>
  (x1===x2&&Math.abs(value.x-x1)<1e-7&&value.y>=Math.min(y1,y2)&&value.y<=Math.max(y1,y2))||
  (y1===y2&&Math.abs(value.y-y1)<1e-7&&value.x>=Math.min(x1,x2)&&value.x<=Math.max(x1,x2))),
 'An observed foot point remains on an original street');
 for(const rect of obstacles)assert.equal(
  value.x-4<rect.right&&value.x+4>rect.left&&value.y-4<rect.bottom&&value.y+4>rect.top,false,
  'The observed foot area must stay outside occupied ground');
}

test('owned motion walks, briefly stops and resumes on legal streets outside obstacles and reference town water',()=>{
 // The blocked top street leaves a legal U-shaped route: staying still is not a passing result.
 const obstacle={left:70,right:110,top:5,bottom:35};
 const ids=['agent_motion_first','agent_motion_second'];
 const synthetic=motion(loopRoads,[obstacle]);synthetic.sync(ids);
 const previous=new Map(ids.map(id=>[id,point(synthetic,id)])),walked=new Set<string>(),stopped=new Set<string>(),resumed=new Set<string>();
 for(let i=0;i<2400;i++){
  synthetic.step(.05);
  for(const id of ids){
   const current=point(synthetic,id);assertLegalPoint(current,loopRoads,[obstacle]);
   if(moved(previous.get(id)!,current)){walked.add(id);if(stopped.has(id))resumed.add(id);}
   if(walked.has(id)&&!current.walking&&current.pause>0)stopped.add(id);
   previous.set(id,current);
  }
 }
 for(const id of ids){assert.ok(walked.has(id),'Each resident actually walks');assert.ok(stopped.has(id),'Walking includes a short stop');assert.ok(resumed.has(id),'The resident resumes after stopping');}

 // Public map metadata supplies independent physical references, not the motion edge filter.
 const obstacles:Rect[]=places.filter((place:any)=>townAssets.assets[place.assetId].category==='buildings'||place.id==='beacon').map((place:any)=>{
  const asset=townAssets.assets[place.assetId],foot=asset.footprint;
  const left=place.x-asset.anchor.x+foot.x,top=place.y-asset.anchor.y+foot.y;
  return{left,right:left+foot.width,top,bottom:top+foot.height};
 });
 const fountain=townAssets.assets.fountain,foot=fountain.footprint;
 const fountainLeft=768-fountain.anchor.x+foot.x,fountainTop=560-fountain.anchor.y+foot.y;
 obstacles.push({left:fountainLeft,right:fountainLeft+foot.width,top:fountainTop,bottom:fountainTop+foot.height});
 const halfPassage=townAssets.assets['bridge-vertical-long'].walkableFootprint.width/2;
 const water=[{left:0,right:384-halfPassage,top:96,bottom:192},
  {left:384+halfPassage,right:1152-halfPassage,top:96,bottom:192},
  {left:1152+halfPassage,right:WORLD_SIZE.width,top:96,bottom:192}];
 obstacles.push(...water);
 const town=motion(roadSegments,obstacles);town.sync(ids);
 const starts=ids.map(id=>point(town,id));let townMoved=false;
 for(let i=0;i<2400;i++){
  town.step(.05);
  ids.forEach((id,index)=>{
   const current=point(town,id);assertLegalPoint(current,roadSegments,obstacles);
   assert.ok(current.x>=0&&current.x<=WORLD_SIZE.width&&current.y>=0&&current.y<=WORLD_SIZE.height);
   townMoved||=moved(starts[index]!,current);
  });
 }
 assert.ok(townMoved,'The reference town contains a usable roaming route');
 const bridgeRoads:Road[]=[[384,64,384,224]],bridge=motion(bridgeRoads,water);bridge.sync(['agent_bridge']);
 let north=false,south=false;
 for(let i=0;i<800;i++){
  bridge.step(.05);const current=point(bridge,'agent_bridge');assertLegalPoint(current,bridgeRoads,water);
  north||=current.y<96;south||=current.y>192;
 }
 assert.ok(north&&south,'The legal bridge passage remains traversable on both sides of the river');
});

test('motion pause, hidden and held states preserve route progress while large deltas stay bounded',()=>{
 const ids=['agent_held','agent_unheld'],actual=motion(lineRoad),reference=motion(lineRoad);
 actual.sync(ids);reference.sync(ids);
 let before:MotionPoint|undefined;
 for(let i=0;i<400;i++){
  actual.step(.05);reference.step(.05);const value=point(actual,ids[0]!);
  if(value.walking&&value.x>28&&value.x<172){before=value;break;}
 }
 assert.ok(before,'Start with real movement away from either route endpoint');
 for(const options of [{paused:true},{visible:false}]){actual.step(3600,options);assert.deepEqual(point(actual,ids[0]!),before);}
 for(const dt of [0,-1]){actual.step(dt);assert.deepEqual(point(actual,ids[0]!),before);}
 const unheldStart=point(actual,ids[1]!);let unheldMoved=false;
 const heldState={...before,walking:false,frame:0};
 for(let i=0;i<300;i++){
  actual.step(.05,{heldIds:[ids[0]!]});
  assert.deepEqual(point(actual,ids[0]!),heldState);
  unheldMoved||=moved(unheldStart,point(actual,ids[1]!));
 }
 assert.ok(unheldMoved,'Holding one resident must not freeze the other resident');
 actual.step(.05);reference.step(.05);
 assert.deepEqual(point(actual,ids[0]!),point(reference,ids[0]!),'Release resumes the same route and animation clock');
 assert.ok(moved(before,point(actual,ids[0]!)),'Release continues movement instead of returning to the spawn');
 actual.step(3600);reference.step(.05);
 assert.deepEqual(point(actual,ids[0]!),point(reference,ids[0]!),'A background-sized delta advances no farther than one bounded step');
});

test('live motion points survive same-ID refresh and are removed by the real selection and authentication binding',()=>{
 const model=motion(lineRoad),source=session(ready([first,second],second.agentId)),selected:string[]=[];
 let currentTarget='';
 const consumer={setOwnedAgents(projection:Projection){model.sync(projection.agents.map(agent=>agent.agentId));currentTarget=projection.selectedAgentId;}};
 const binding=createOwnedAgentBinding(source,(id:string)=>selected.push(id));binding.attach(consumer);
 const start=point(model,second.agentId),live=advanceUntil(model,second.agentId,value=>value.walking&&moved(start,value));
 assert.equal(currentTarget,second.agentId);assert.ok(moved(start,live),'A locator consumer can read the current point rather than a fixed spawn');
 const firstBefore=point(model,first.agentId),secondBefore=point(model,second.agentId);
 source.emit({...ready([second,first,second],second.agentId),phase:'refreshing'});
 assert.deepEqual(point(model,first.agentId),firstBefore);assert.deepEqual(point(model,second.agentId),secondBefore);
 const localRead=point(model,second.agentId);localRead.x=-999;localRead.progress=-999;
 assert.deepEqual(point(model,second.agentId),secondBefore,'A consumer cannot mutate the stored route through read()');
 source.emit(ready([second],second.agentId));model.step(.05);
 assert.equal(model.read(first.agentId),null);assert.equal(currentTarget,second.agentId);
 source.emit({...ready([first,second],second.agentId),phase:'anonymous'});model.step(3600);binding.select(second.agentId,{});
 assert.equal(currentTarget,'');assert.equal(model.read(first.agentId),null);assert.equal(model.read(second.agentId),null);assert.deepEqual(selected,[]);
 source.emit(ready([other],other.agentId));binding.select(second.agentId,{});binding.select(other.agentId,{});
 assert.equal(currentTarget,other.agentId);assert.deepEqual(selected,[other.agentId]);assert.equal(model.read(second.agentId),null);assert.ok(model.read(other.agentId));
 model.clear();model.step(.05);assert.equal(model.read(other.agentId),null);
 source.emit(ready([other],other.agentId));assert.ok(model.read(other.agentId));binding.dispose();model.step(.05);
 assert.equal(model.read(other.agentId),null);assert.equal(currentTarget,'');
});
