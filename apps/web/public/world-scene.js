import {daylightAt} from './hud/world-time.js';
// The world consumes one local design-kit subset; character frames share one sheet.
import {townAssets} from './world-town/assets.js';
import {createOwnedAgentLayer} from './world-owned-layer.js';
import {projectWorldAvatars,WORLD_PROJECTION_VERSION} from './hud/world-scene-projection.js';
import {freeAreas,worldOverlayRects} from './world-safe-area.js';
import {assertPixelSnapshot} from './world-pixel/map.js';
import {humanHitSize} from './world-pixel/human.js';
import {createTownTargets} from './world-town-targets.js';
import {createExpressionLifecycle} from './hud/world-expression-lifecycle.js';
import {createExpressionLayer} from './hud/world-expression-layer.js';
export const WORLD_SIZE = Object.freeze({ width: 1536, height: 1024 });
const W = WORLD_SIZE.width, H = WORLD_SIZE.height;
const demoNote = '这是背景演示场所，不表示真实 Agent 的到访或活动。角色位置与互动以服务器记录为准。';
export const places = [
  {id:'workshop',kind:'workshop',name:'西北工坊',area:'河岸工坊与书展街',x:352,y:384,w:164,h:112,icon:'⌘',description:'蓝顶工坊面向河岸街道，门前留下一小片整理工具与植物的空间。当前仅展示场所用途。'},
  {id:'library',kind:'library',name:'河岸书馆',area:'河岸工坊与书展街',x:576,y:384,w:144,h:124,icon:'▥',description:'沿水岸步行后，可以在这座安静的书馆门前停留。书馆是世界的阅读线索，尚无借阅或知识服务。'},
  {id:'gallery',kind:'gallery',name:'河岸展馆',area:'河岸工坊与书展街',x:1008,y:384,w:160,h:120,icon:'▧',description:'屋顶与窗带围出一个小展馆，外侧展台让河岸街道有了展示作品的场所感。当前没有真实作品目录。'},
  {id:'cottage-river',kind:'cottage',name:'河岸小屋',area:'河岸工坊与书展街',x:1216,y:384,w:112,h:112,icon:'⌂',description:'靠近东桥的小屋，留出通往河岸与横街的门前路。小屋不表示任何真实居民的房产或住所。'},
  {id:'cottage-west',kind:'cottage',name:'西园小屋',area:'西侧生活园',x:352,y:608,w:112,h:112,icon:'⌂',description:'错落小屋与草地组成西侧生活园。演示居民会沿街道停留，场景不生成真实 Agent 的生活记录。'},
  {id:'cottage-garden',kind:'cottage',name:'花园小屋',area:'西侧生活园',x:512,y:576,w:112,h:104,icon:'⌂',description:'树丛旁的第二栋小屋通过门前短路连接横街，与邻屋保持日常步行的尺度。当前仅为场所示意。'},
  {id:'beacon',kind:'beacon',name:'中央公共庭',area:'中央公共庭',x:768,y:544,w:76,h:88,icon:'◇',description:'奶油色铺地、长椅和低矮水景围绕一枚蓝白标柱。道路从两侧绕行，连接小镇的南北街道。'},
  {id:'tavern',kind:'tavern',name:'会客酒馆',area:'东侧会客街',x:1120,y:608,w:160,h:128,icon:'☷',description:'暖色雨棚与门外座椅构成会客街的停留点。酒馆与信箱只是世界线索，当前没有聊天或收发信功能。'},
  {id:'greenhouse',kind:'greenhouse',name:'南侧温室',area:'南侧温室与信息厅',x:352,y:832,w:152,h:112,icon:'♧',description:'淡青窗格下是温室的植物轮廓，门前的小路连向南侧街道。当前不提供种植、资源或资产系统。'},
  {id:'information-hall',kind:'information-hall',name:'信息厅',area:'南侧温室与信息厅',x:576,y:832,w:148,h:128,icon:'i',description:'蓝白信息厅是理解接入与管理的普通入口线索。M1 已支持让自己的 Agent 注册、设定角色、加入与主人管理。',links:[{label:'阅读 Agent 接入说明',href:'/agent/entry.md'},{label:'进入主人管理',href:'/owner'}]},
  {id:'cottage-south',kind:'cottage',name:'东南小屋',area:'东南居住花园',x:992,y:832,w:112,h:112,icon:'⌂',description:'南街旁的小屋与凉亭共享一片花园。建筑布局是演示世界的一部分，不代表真实用户或土地归属。'},
  {id:'pavilion',kind:'pavilion',name:'公共凉亭',area:'东南居住花园',x:1184,y:832,w:112,h:104,icon:'⌑',description:'开放凉亭面向南街，树丛与低矮花圃留出可停留的空间。当前仅展示公共空间的模样。'},
  {id:'wayfinding',kind:'wayfinding',name:'南门导向牌',area:'南侧温室与信息厅',x:704,y:912,w:36,h:52,icon:'↗',description:'从南门沿中街来到小镇。自己的 Agent 可通过普通 HTTP 接入，主人管理仍在独立网页中完成。',links:[{label:'阅读 Agent 接入说明',href:'/agent/entry.md'},{label:'进入主人管理',href:'/owner'}]},
  {id:'mailbox',kind:'mailbox',name:'会客街信箱',area:'东侧会客街',x:1240,y:604,w:26,h:38,icon:'▱',description:'会客街的一枚实体信箱，帮助辨认场所用途。这里只展示说明，没有信件、未读提示或发信操作。'},
  {id:'noticeboard',kind:'noticeboard',name:'河岸告示牌',area:'河岸工坊与书展街',x:848,y:384,w:64,h:80,icon:'▤',description:'从这里进入信箱，查看平台当前可公开读取的公告、计划与发生记录。演示内容逐条标明，计划不表示已经发生。',note:'告示牌是内容入口。背景与画布动画为演示，真实角色位置以服务器读取结果为准，不表示在线。'},
  {id:'exhibit',kind:'exhibit',name:'河岸展台',area:'河岸工坊与书展街',x:1120,y:350,w:38,h:42,icon:'▧',description:'展馆旁的小型展台，为日后的展示留下空间。本版没有真实展品、活动流或展览业务。'},
];

for (const place of places) {
  place.assetId = place.kind === 'exhibit' ? 'display-stand' : place.kind;
  const asset = townAssets.assets[place.assetId];
  place.w = asset.width; place.h = asset.height; place.anchor = asset.anchor; place.footprint = asset.footprint;
}

// Every crossing is split into the same graph node, including both bridges and
// the two square branches around the central beacon. No route crosses water.
export const roadSegments = [
  [96,64,1440,64],[96,224,1440,224],[384,64,384,224],[1152,64,1152,224],
  ...[416,640,864].map(y=>[192,y,1344,y]),
  [192,224,192,864],[1344,224,1344,864],[768,224,768,480],[768,576,768,944],
  [768,480,704,480],[704,480,704,576],[704,576,768,576],
  [768,480,832,480],[832,480,832,576],[832,576,768,576],
  ...places.filter(p=>townAssets.assets[p.assetId].category==='buildings').map(p=>[p.x,p.y+8,p.x,p.y<416?416:p.y<640?640:864]),
];
export function buildRoadGraph(segments=roadSegments) {
  const nodes=new Map();
  const key=(x,y)=>`${x},${y}`;
  const node=(x,y)=>{const id=key(x,y);if(!nodes.has(id))nodes.set(id,{id,x,y,neighbors:[]});return nodes.get(id);};
  for(const a of segments){
    const points=[{x:a[0],y:a[1]},{x:a[2],y:a[3]}];
    for(const b of segments){
      for(const [x,y] of [[b[0],b[1]],[b[2],b[3]]]){
        if(a[0]===a[2]&&x===a[0]&&y>=Math.min(a[1],a[3])&&y<=Math.max(a[1],a[3]))points.push({x,y});
        if(a[1]===a[3]&&y===a[1]&&x>=Math.min(a[0],a[2])&&x<=Math.max(a[0],a[2]))points.push({x,y});
      }
      if(a[1]===a[3]&&b[0]===b[2]&&b[0]>=Math.min(a[0],a[2])&&b[0]<=Math.max(a[0],a[2])&&a[1]>=Math.min(b[1],b[3])&&a[1]<=Math.max(b[1],b[3]))points.push({x:b[0],y:a[1]});
      if(a[0]===a[2]&&b[1]===b[3]&&a[0]>=Math.min(b[0],b[2])&&a[0]<=Math.max(b[0],b[2])&&b[1]>=Math.min(a[1],a[3])&&b[1]<=Math.max(a[1],a[3]))points.push({x:a[0],y:b[1]});
    }
    const ordered=[...new Map(points.map(p=>[key(p.x,p.y),p])).values()].sort((p,q)=>p.x-q.x||p.y-q.y);
    for(let i=1;i<ordered.length;i++){
      const p=node(ordered[i-1].x,ordered[i-1].y),q=node(ordered[i].x,ordered[i].y);
      if(!p.neighbors.includes(q.id))p.neighbors.push(q.id);
      if(!q.neighbors.includes(p.id))q.neighbors.push(p.id);
    }
  }
  return nodes;
}
function rng(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function rounded(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function rect(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
function line(ctx,x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function ellipse(ctx,x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function poly(ctx,points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function distanceToSegment(x,y,s){const dx=s[2]-s[0],dy=s[3]-s[1],t=Math.max(0,Math.min(1,((x-s[0])*dx+(y-s[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-s[0]-t*dx,y-s[1]-t*dy);}
// The existing tree crown spans 54x62px. A 64x72px anchor clearance
// retains the same seeded positions while leaving a gap between crown bounds.
export function treePositions() {
  const random=rng(381117),trees=[];
  for(let i=0;i<180;i++){
    const x=64+random()*(W-128),y=270+random()*(H-320);
    if(roadSegments.some(s=>distanceToSegment(x,y,s)<48)||places.some(p=>Math.abs(x-p.x)<p.w/2+36&&y>p.y-p.h-30&&y<p.y+40)||(x>558&&x<978&&y>440&&y<626))continue;
    if(trees.some(tree=>Math.abs(x-tree.x)<64&&Math.abs(y-tree.y)<72))continue;
    trees.push({x,y});
  }
  return trees;
}
function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw new Error('canvas_unavailable');return{canvas:c,ctx};}
async function loadAssets() {
  const records = [...Object.values(townAssets.assets), {...townAssets.atlas, id:'character-sheet'}];
  const images = new Map();
  const loading = Promise.all(records.map(async record => {
    const image = new Image();
    image.src = new URL(`world-town/${record.path}`, import.meta.url).href;
    await image.decode(); images.set(record.id, image);
  }));
  let timeout;
  try { await Promise.race([loading,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('asset_timeout')),15000);})]); }
  finally { clearTimeout(timeout); }
  // Decode and rasterize the complete sheet once. All 192 source rectangles
  // refer to this canvas, never to individually requested frame SVGs.
  const sheet = makeCanvas(townAssets.atlas.width,townAssets.atlas.height);
  sheet.ctx.drawImage(images.get('character-sheet'),0,0);
  images.set('character-sheet',sheet.canvas);
  return images;
}
function sprite(images,id) { const asset=townAssets.assets[id];return{canvas:images.get(id),ax:asset.anchor.x,ay:asset.anchor.y}; }
function drawTerrain(ctx,images) {
  const pattern=id=>ctx.createPattern(images.get(id),'repeat');
  ctx.fillStyle=pattern('grass');ctx.fillRect(0,0,W,H);
  rounded(ctx,252,476,312,138,28,'#d3e1c4');rounded(ctx,926,716,360,144,32,'#d1e0c5');
  ctx.fillStyle=pattern('water');ctx.fillRect(0,96,W,96);
  for(let x=0;x<W;x+=32){ctx.drawImage(images.get('bank-north'),x,88);ctx.drawImage(images.get('bank-south'),x,168);}
  ctx.fillStyle=pattern('path');ctx.fillRect(576,464,384,144);
  // 32px is the occupied road grid. The design's visible edge/paving is 20/16.
  ctx.lineCap='butt';ctx.lineJoin='round';ctx.beginPath();
  for(const [x1,y1,x2,y2] of roadSegments){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}
  ctx.strokeStyle='#D1C2A8';ctx.lineWidth=20;ctx.stroke();ctx.strokeStyle='#E7DAC5';ctx.lineWidth=16;ctx.stroke();
  // The original 32x160 long bridge spans y64..224 without stretching a short one.
  for(const x of [384,1152])ctx.drawImage(images.get('bridge-vertical-long'),x-16,64);
  for(const p of places.filter(p=>townAssets.assets[p.assetId].category==='buildings'))for(const side of [-1,1]){
    const a=townAssets.assets.planter;ctx.drawImage(images.get('planter'),p.x+side*(p.w/2-12)-a.anchor.x,p.y-a.anchor.y+8);
  }
  rounded(ctx,727,940,82,12,4,'#c5cbb6');rect(ctx,726,925,8,24,'#b4bda4');rect(ctx,802,925,8,24,'#b4bda4');
}
function makeActors(graph,count){
  const nodes=[...graph.values()];return Array.from({length:count},(_,i)=>{
    const random=rng(2244+i*7127);let node=nodes[Math.floor(random()*nodes.length)],previous='';
    const route=[node.id];
    for(let j=0;j<192;j++){const choices=node.neighbors.filter(id=>id!==previous);const next=(choices.length?choices:node.neighbors)[Math.floor(random()*(choices.length||node.neighbors.length))];previous=node.id;node=graph.get(next);route.push(next);}
    const start=graph.get(route[0]);return{id:`demo-${i}`,kind:'actor',x:start.x,y:start.y,route,index:0,progress:0,pause:random()*3.5,speed:18+random()*8,style:i%6,step:0,clock:random()*10};
  });
}
function updateActor(a,dt,graph){
  if(a.pause>0){a.pause=Math.max(0,a.pause-dt);a.step=0;return;}
  const from=graph.get(a.route[a.index]),to=graph.get(a.route[a.index+1]);
  const length=Math.hypot(to.x-from.x,to.y-from.y);a.progress=Math.min(length,a.progress+a.speed*dt);const t=a.progress/length;
  a.x=from.x+(to.x-from.x)*t;a.y=from.y+(to.y-from.y)*t;a.clock+=dt;a.step=Math.floor(a.clock*6)%4;a.dx=to.x-from.x;a.dy=to.y-from.y;
  if(t===1){a.index++;a.progress=0;a.pause=1.5+((a.index*7+a.style*3)%26)/10;
    // Reverse the exact route at its end; the endpoint stays continuous.
    if(a.index===a.route.length-1){a.route.reverse();a.index=0;}
  }
}
function drawActor(ctx,a,images) {
  const direction=a.pause>0?'S':Math.abs(a.dx||0)>Math.abs(a.dy||0)?a.dx<0?'W':'E':a.dy<0?'N':'S';
  const variant=townAssets.variants[a.style],state=a.pause>0?'idle':'walk',frame=a.pause>0?0:a.step;
  const r=townAssets.frames[`${variant}-${state}-${direction}-${frame}`],anchor=townAssets.characterAnchor;
  ctx.drawImage(images.get('character-sheet'),r.x,r.y,r.width,r.height,a.x-anchor.x,a.y-anchor.y,r.width,r.height);
}

export async function createWorldScene(root,{onSelect=()=>{},onOwnedSelect=()=>{},onChange=()=>{},onError=()=>{},signal,worldSource='demo',rendering=null,initialTime=Date.now(),clock={now:()=>Date.now()}}={}){
  const W=rendering?.mapSpec.width??WORLD_SIZE.width,H=rendering?.mapSpec.height??WORLD_SIZE.height;
  const stagePlaces=rendering?rendering.places:places;
  const images=rendering?null:await loadAssets();
  if(signal?.aborted)throw new DOMException('Scene loading cancelled','AbortError');
  const canvas=document.createElement('canvas');canvas.id='world-canvas';canvas.dataset.worldWidth=String(W);canvas.dataset.worldHeight=String(H);canvas.dataset.buildingCount=String(rendering?.buildingCount??11);canvas.className='world-canvas';canvas.dataset.rendering=rendering?'pixel-town':'legacy';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',rendering?'像素小镇世界画布。角色沿已开放街巷和公共庭活动。可用方向键平移，加减号缩放，Home 全景。':'清昼小镇演示地图。可用场所列表查看说明；聚焦后方向键平移，加减号缩放，Home 恢复全景。');
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas_unavailable');root.replaceChildren(canvas);
  const graph=buildRoadGraph(),mobile=matchMedia('(max-width:759px)').matches,reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const ground=rendering?null:makeCanvas(W,H);if(ground)drawTerrain(ground.ctx,images);
  const objects=rendering?rendering.objects:places.map(p=>({...p,sprite:sprite(images,p.assetId)}));
  if(!rendering){
  objects.push({kind:'fountain',id:'courtyard-water',x:768,y:560,sprite:sprite(images,'fountain')});
  const tree=sprite(images,'tree');
  for(const {x,y} of treePositions())objects.push({kind:'tree',x,y,sprite:tree});
  for(const [x,y]of [[128,44],[264,43],[512,43],[656,43],[848,43],[992,43],[1280,43],[1408,43]])objects.push({kind:'shrub',x,y,sprite:sprite(images,'shrub')});
  for(const [x,y]of [[620,534],[916,534],[1072,624],[1170,624],[1218,809]])objects.push({kind:'bench',x,y,sprite:sprite(images,'bench')});
  for(const [x,y]of [[256,360],[1250,774],[428,800],[656,775],[960,364]])objects.push({kind:'planter',x,y,sprite:sprite(images,'planter')});
  }
  const actors=rendering?[]:makeActors(graph,mobile?12:18);
  const blockedRects=rendering?[]:objects.flatMap(o=>{const footprint=o.footprint||townAssets.assets[o.assetId||o.kind]?.footprint;if(!footprint)return[];return[{left:o.x-o.sprite.ax+footprint.x,right:o.x-o.sprite.ax+footprint.x+footprint.width,top:o.y-o.sprite.ay+footprint.y,bottom:o.y-o.sprite.ay+footprint.y+footprint.height}];});
  // Only the existing bridge centre corridors can cross the river. The road
  // graph supplies their north/south entry ports; no route is made over water.
  if(!rendering)blockedRects.push(...[[0,376],[392,1144],[1160,W]].map(([left,right])=>({left,right,top:96,bottom:192})));
  const ownedLayer=createOwnedAgentLayer(root,graph,{blockedRects,renderer:rendering,onSelect:selectAgent,onOverlayChange:()=>{if(!destroyed)refreshOwnedHover();}});
  const townTargets=createTownTargets(root,onSelect);let townNotice=null;
  const camera={x:W/2,y:H/2,zoom:1,base:1,width:0,height:0,dpr:1};
  let zoomMotion=null;
  let hoverPointer=null,hoverProjection='';
  let mode='initial',exploring=false;
  let worldView={phase:!rendering&&worldSource==='demo'?'demo':'loading',enabled:null,rules:null,avatars:[],npcs:[],complete:false,asOf:null,worldRevision:null},ownedProjection={agents:[],selectedAgentId:''};
  let paused=reduced.matches,pauseReason=reduced.matches?'reduced':'user',visible=true,destroyed=false,broken=false,selected=null,raf=0,lastTime=null,lastDraw=0,elapsed=0,environment=true,actorLimit=worldSource==='demo'?actors.length:0,quality=0,reduceOverride=false;
  let sceneTime=initialTime,light=daylightAt(sceneTime),stillLight=daylightAt(sceneTime,{reducedMotion:true});
  const currentLight=()=>reduced.matches||reduceOverride?stillLight:light;
  let frames=0,drawMs=0,slowSamples=[],metrics={fps:0,meanDrawMs:0};
  const abort=new AbortController(),eventOptions={signal:abort.signal};
  const expressions=createExpressionLifecycle();let fullExpressions=[],expressionsUserPaused=false;
  const expressionLayer=createExpressionLayer(root,expressions,{redraw:draw,onActive:rows=>{fullExpressions=rows;document.dispatchEvent(new CustomEvent('world:expressions',{detail:{expressions:structuredClone(rows)}}));}});
  function expressionPreferences(){expressionLayer.settings({density:document.querySelector('#world-expression-density')?.value||'standard',setId:document.querySelector('#world-expression-style')?.value||'gestures'});}
  document.addEventListener('change',event=>{if(event.target.matches?.('#world-expression-density,#world-expression-style'))expressionPreferences();},eventOptions);expressionPreferences();
  function expressionBoxes(point,scale){
    const result=new Map(),add=(kind,id,name,x,y,appearance,activity,geometry)=>{const g=geometry||{width:32,height:40,anchor:{x:16,y:36},hitBox:{left:-16,right:16,top:-36,bottom:4}},b=appearance?.kind==='custom'?{left:-g.anchor.x,right:g.width-g.anchor.x,top:-g.anchor.y,bottom:g.height-g.anchor.y}:g.hitBox,p=point(x,y);result.set(kind+':'+id,{name,activity,rect:{left:p.x+b.left*scale,right:p.x+b.right*scale,top:p.y+b.top*scale,bottom:p.y+b.bottom*scale}});};
    for(const entry of ownedLayer.actors())if(entry.fact)add('agent',entry.agentId,entry.nameValue,entry.x,entry.y,entry.fact.profile.appearance,entry.fact.activity,ownedLayer.geometry(entry.agentId));
    for(const target of rendering?.npcs||[])add('npc',target.id,target.name,target.x,target.y,target.npc.appearance,target.npc.activity,rendering.avatarGeometry(target));return result;
  }
  const state=()=>({mode,exploring,minZoom:overviewScale()/camera.base,zoom:camera.zoom,paused,pauseReason,theme:light.period,lighting:structuredClone(currentLight()),reducedMotion:reduced.matches||reduceOverride,visible:visible&&!document.hidden,actorCount:actorLimit,quality,frames,...metrics,camera:{x:camera.x,y:camera.y,scale:camera.base*camera.zoom,width:camera.width,height:camera.height,sourceWidth:W,sourceHeight:H,coordinateSpace:rendering?'source-pixel':'legacy-town-pixel'},actors:actors.slice(0,actorLimit).map(a=>({id:a.id,x:a.x,y:a.y,pause:a.pause})),selectedId:selected?.id??null,
    rendering:rendering?{backend:'pixel-town',mapVersion:rendering.mapSpec.version,assetVersion:rendering.sourceVersion,imageCount:rendering.imageCount}:null,
    worldScene:{npcCatalogVersion:worldView.npcCatalogVersion??null,npcs:structuredClone(worldView.npcs||[]),phase:worldView.phase,stale:worldView.stale===true,enabled:worldView.enabled,asOf:worldView.asOf,worldRevision:worldView.worldRevision,complete:worldView.complete,errorCode:worldView.errorCode??null,errorStatus:worldView.errorStatus??null,retryAt:worldView.retryAt??null,lastSuccessAt:worldView.lastSuccessAt??null,projectionVersion:rendering?.mapSpec.version||WORLD_PROJECTION_VERSION,avatars:ownedLayer.actors().filter(row=>row.fact).map(row=>({fact:structuredClone(row.fact),x:row.x,y:row.y,walking:row.walking,renderPosition:structuredClone(row.renderPosition)}))}});
  // Projection uses the whole viewport; overview reserves room for the two overlays.
  function overviewInsets(){const phone=camera.width<760;return {top:phone?112:88,bottom:phone?116:126,left:16,right:16};}
  function overviewScale(){const i=overviewInsets();return rendering?rendering.camera.fit({width:W,height:H},camera,i):Math.max(.01,Math.min((camera.width-i.left-i.right)/W,(camera.height-i.top-i.bottom)/H));}
  function screenCenter(){if(mode!=='overview')return{x:camera.width/2,y:camera.height/2};const i=overviewInsets();return{x:(camera.width+i.left-i.right)/2,y:(camera.height+i.top-i.bottom)/2};}
  function notify(){canvas.classList.toggle('is-exploring',exploring);onChange(state());}
  function clampCamera(){const scale=camera.base*camera.zoom;for(const [axis,size,view]of [['x',W,camera.width],['y',H,camera.height]]){const half=view/(2*scale),minimum=Math.min(half,size-half),maximum=Math.max(half,size-half);camera[axis]=Math.max(minimum,Math.min(maximum,camera[axis]));}}
  function applyZoom(zoom,anchor,point){camera.zoom=zoom;const scale=camera.base*zoom;camera.x=point.x-(anchor.x-camera.width/2)/scale;camera.y=point.y-(anchor.y-camera.height/2)/scale;clampCamera();}
  function advanceZoom(time){if(!zoomMotion)return;const move=zoomMotion,t=Math.max(0,Math.min(1,(time-move.startedAt)/160)),ease=1-(1-t)**3;applyZoom(move.from+(move.to-move.from)*ease,move.anchor,move.point);if(t===1)zoomMotion=null;notify();}
  function stopZoom(){if(zoomMotion){advanceZoom(performance.now());zoomMotion=null;}}
  function fail(){if(broken)return;broken=true;cancelAnimationFrame(raf);raf=0;onError();}
  function draw(){
    if(destroyed||broken||!camera.width||!camera.height)return;
    const start=performance.now();
    try{
      ctx.setTransform(camera.dpr,0,0,camera.dpr,0,0);rect(ctx,0,0,camera.width,camera.height,'#e4ecdc');ctx.save();
      const scale=camera.base*camera.zoom;const center=screenCenter();ctx.translate(Math.round(center.x-camera.x*scale),Math.round(center.y-camera.y*scale));ctx.scale(scale,scale);if(rendering)ctx.imageSmoothingEnabled=false;else ctx.drawImage(ground.canvas,0,0);
      const lighting=currentLight(),renderFrame={elapsed:elapsed*1000,serverTime:clock.now(),stale:worldView.stale===true||worldView.phase==='paused',selectedBuildingId:selected?.buildingId||selected?.npc?.buildingId||selected?.serviceNpc?.buildingId||selected?.id,paused,reducedMotion:reduced.matches||reduceOverride,quality,scale,theme:lighting.period,lighting,avatars:ownedLayer.actors(),viewport:{left:camera.x-center.x/scale,right:camera.x+(camera.width-center.x)/scale,top:camera.y-center.y/scale,bottom:camera.y+(camera.height-center.y)/scale}};if(rendering){rendering.stepNpcs?.(renderFrame);rendering.drawGround(ctx,renderFrame);}
      // Every camera entry renders here. Re-hit the last real pointer after a
      // projection change; never carry a mouse hold onto a different screen spot.
      const canvasBox=canvas.getBoundingClientRect(),projection=[camera.x,camera.y,scale,center.x,center.y,camera.width,camera.height,canvasBox.left,canvasBox.top].join(':');
      if(projection!==hoverProjection){hoverProjection=projection;refreshOwnedHover();}
      if(!rendering&&environment){for(let i=0;i<25;i++){const x=(i*137+elapsed*3)%W,y=115+(i*29)%61;line(ctx,x,y,x+18+(i%3)*6,y,'#cce1d8',2);}}
      const sorted=[...objects,...(rendering?.npcs||[]),...actors.slice(0,actorLimit),...(rendering||worldView.phase==='demo'?ownedLayer.actors():[])].sort((a,b)=>(a.y+(rendering?.lifeSortOffset?.(a)||0))-(b.y+(rendering?.lifeSortOffset?.(b)||0))||Number(a.kind==='actor')-Number(b.kind==='actor')||String(a.id||a.kind).localeCompare(String(b.id||b.kind)));
      for(const o of sorted){if(o.kind==='actor')drawActor(ctx,o,images);else if(o.kind==='owned-agent')ownedLayer.draw(ctx,o,scale,renderFrame);else if(rendering)o.draw(ctx,renderFrame);else ctx.drawImage(o.sprite.canvas,o.x-o.sprite.ax,o.y-o.sprite.ay);}
      // Real logical positions are drawn above decorative scenery; scenery does
      // not grant a path, hide an Avatar or determine its authoritative place.
      if(!rendering&&worldView.phase!=='demo')for(const entry of ownedLayer.actors())ownedLayer.draw(ctx,entry,scale);
      if(selected){if(rendering&&selected.kind==='world-avatar'){const entry=ownedLayer.actors().find(row=>row.agentId===selected.agentId);if(entry)rendering.drawSelection(ctx,entry,scale,renderFrame);}else if(!rendering){const isActor=['actor','world-avatar'].includes(selected.kind);ctx.strokeStyle='#557f9a';ctx.lineWidth=2/Math.max(scale,.4);ctx.setLineDash([5/scale,4/scale]);ctx.beginPath();ctx.ellipse(selected.x,selected.y+3,isActor?13:Math.min(selected.w/2+12,70),isActor?6:16,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}}
      if(rendering){rendering.drawUpper?.(ctx,renderFrame);rendering.drawEffects?.(ctx,{...renderFrame,quality:environment?quality:1});for(const entry of ownedLayer.actors())if(entry.agentId===ownedProjection.selectedAgentId||entry.agentId===selected?.agentId)rendering.drawSelection(ctx,entry,scale,renderFrame);}
      ctx.restore();
      townTargets.layout({scale,point:(x,y)=>({x:(x-camera.x)*scale+center.x,y:(y-camera.y)*scale+center.y})});
      ownedLayer.layout({scale,point:(x,y)=>({x:(x-camera.x)*scale+center.x,y:(y-camera.y)*scale+center.y})});
      expressionLayer.tick({actors:()=>expressionBoxes((x,y)=>({x:(x-camera.x)*scale+center.x,y:(y-camera.y)*scale+center.y}),scale),scale,active:visible&&!document.hidden&&!expressionsUserPaused&&!worldView.stale&&worldView.complete&&['ready','refreshing'].includes(worldView.phase),reducedMotion:reduced.matches||reduceOverride,error:worldView.expressionError});
      frames++;drawMs+=performance.now()-start;
    }catch{fail();}
  }
  function running(){return visible&&!document.hidden&&!destroyed&&!broken&&(Boolean(rendering)||!paused&&!reduceOverride);}
  function frame(time){
    raf=0;if(!running()){lastTime=null;return;}
    if(lastTime===null){lastTime=time;lastDraw=time;}
    const dt=Math.min((time-lastTime)/1000,.05);lastTime=time;elapsed+=dt;
    advanceZoom(time);
    for(const actor of actors.slice(0,actorLimit))updateActor(actor,dt,graph);
    // The sprite tick is capped; received positions use the untruncated monotonic clock.
    ownedLayer.step(dt,{now:time,serverTime:clock.now(),paused,visible:visible&&!document.hidden});
    if(!mobile||time-lastDraw>=1000/30-1){
      const interval=time-lastDraw;lastDraw=time;draw();if(interval>0)slowSamples.push(interval);
      if(slowSamples.length>=120){const mean=slowSamples.reduce((a,b)=>a+b,0)/slowSamples.length;metrics={fps:Math.round(1000/mean),meanDrawMs:Math.round(drawMs/Math.max(frames,1)*100)/100};slowSamples=[];
        if(mean>48&&quality===0){quality=1;environment=false;notify();}
        else if(mean>64&&quality===1){quality=2;actorLimit=!rendering&&worldView.phase==='demo'?(mobile?8:10):0;notify();}
        else if(mean>90&&quality===2){quality=3;paused=true;pauseReason='performance';notify();}
      }
    }
    if(running())raf=requestAnimationFrame(frame);
  }
  function reconcile(){cancelAnimationFrame(raf);raf=0;lastTime=null;lastDraw=0;if(running())raf=requestAnimationFrame(frame);else{ownedLayer.step(0,{serverTime:clock.now(),paused:true,visible:false});draw();}}
  function resize(){
    stopZoom();
    const box=root.getBoundingClientRect(),oldScale=camera.base*camera.zoom;camera.width=box.width;camera.height=box.height;camera.dpr=Math.min(devicePixelRatio||1,2);camera.base=rendering?1:Math.max(.01,Math.max(box.width/W,box.height/H));
    canvas.width=Math.max(1,Math.round(box.width*camera.dpr));canvas.height=Math.max(1,Math.round(box.height*camera.dpr));
    if(mode==='initial'){camera.zoom=1;camera.x=!rendering&&box.width<760&&box.height>box.width?960:W/2;camera.y=H/2;}
    else if(mode==='overview'){camera.zoom=overviewScale()/camera.base;camera.x=W/2;camera.y=H/2;}
    else camera.zoom=Math.max(overviewScale()/camera.base,Math.min(3,oldScale/camera.base));
    clampCamera();draw();notify();
  }
  function setZoom(value,{anchor={x:camera.width/2,y:camera.height/2},immediate=false}={}){if(!Number.isFinite(value))return;advanceZoom(performance.now());const target=Math.max(overviewScale()/camera.base,Math.min(3,value)),point=worldPoint(anchor.x,anchor.y);if(Math.abs(target-camera.zoom)<1e-9){zoomMotion=null;return;}mode='custom';zoomMotion=null;if(immediate||reduced.matches||reduceOverride||!running())applyZoom(target,anchor,point);else{zoomMotion={from:camera.zoom,to:target,anchor,point,startedAt:performance.now()};applyZoom(camera.zoom,anchor,point);}draw();notify();}
  function zoomBy(direction){const base=zoomMotion?.to??camera.zoom,target=rendering?rendering.camera.nextScale(base,direction,overviewScale()):base+Math.sign(direction)*.1;setZoom(target);}
  function setExploring(value){stopZoom();exploring=Boolean(value);pointers.clear();drag=null;pinch=null;canvas.classList.remove('is-dragging');notify();}
  function fit(){zoomMotion=null;mode='overview';exploring=false;camera.zoom=overviewScale()/camera.base;camera.x=W/2;camera.y=H/2;draw();notify();}
  function reset(){if(rendering){fit();return;}mode='initial';exploring=false;resize();}
  // Opening, switching or closing a reading panel never takes the camera.
  function select(place){selected=place??null;draw();notify();}
  function setPaused(value){expressionsUserPaused=Boolean(value);paused=Boolean(value)||reduced.matches;pauseReason=reduced.matches?'reduced':'user';reconcile();notify();}
  function setTime(value){if(!Number.isFinite(value)||value<0||value>8.64e15)return;sceneTime=value;light=daylightAt(value);stillLight=daylightAt(value,{reducedMotion:true});draw();}
  function setReducedMotion(value){reduceOverride=Boolean(value);if(reduceOverride&&zoomMotion)advanceZoom(Infinity);reconcile();notify();}
  function applyAgents(){
    rendering?.setNpcs?.(worldView.complete?worldView.npcs||[]:[],worldView.rules,{stale:worldView.stale===true||worldView.phase==='paused',serverTime:worldView.serverTime??clock.now()});
    rendering?.setNotice?.(worldView.complete&&townNotice?.catalogVersion===worldView.npcCatalogVersion?townNotice:null,worldView.rules);
    townTargets.set([...(rendering?.npcs||[]),...(rendering?.serviceTargets||[]),...(rendering?.lifeTargets||[]),...stagePlaces.filter(place=>place.serviceNpc)]);
    if(!rendering&&worldView.phase==='demo')ownedLayer.set(ownedProjection);
    else{const ids=new Set(ownedProjection.agents.map(row=>row.agentId)),project=rendering?rendering.projectAvatars:projectWorldAvatars;ownedLayer.set({source:'server',stale:worldView.stale===true,serverTime:clock.now(),selectedAgentId:ownedProjection.selectedAgentId,agents:worldView.rules?project(worldView.avatars,worldView.rules,WORLD_SIZE).map(row=>({...row,owned:ids.has(row.agentId)})):[]});}
  }
  function setTownNotice(value){townNotice=value;applyAgents();draw();}
  function setOwnedAgents(projection){if(destroyed)return;ownedProjection=structuredClone(projection);applyAgents();draw();}
  function clearScene(){if(destroyed)return;worldView={...worldView,phase:'unavailable',stale:false,rules:null,avatars:[],npcs:[],expressions:[],asOf:null,complete:false,worldRevision:null};expressions.observe(worldView);actorLimit=0;selected=null;applyAgents();draw();notify();}
  function setWorldScene(value){if(destroyed)return;
    if(rendering){try{assertPixelSnapshot(value,worldView);}catch(error){clearScene();return{accepted:false,reason:error.message};}}
    worldView=structuredClone(value);if(rendering&&!value.complete){worldView.avatars=[];worldView.npcs=[];}expressions.observe(worldView);actorLimit=!rendering&&value.phase==='demo'?(quality>=2?(mobile?8:10):actors.length):0;canvas.dataset.worldSource=!rendering&&value.phase==='demo'?'demo':'server';canvas.setAttribute('aria-label',rendering?'像素小镇世界画布。角色位置来自服务器；沿开放街巷与公共庭显示真实角色，不代表在线。':value.phase==='demo'?'清昼小镇演示地图。人物与环境为演示。':'清昼小镇世界画布。角色来自服务器逻辑坐标投影；背景场所为演示，不代表在线。');applyAgents();draw();notify();return{accepted:true};}
  function selectAgent(agentId,origin){const entry=ownedLayer.actors().find(row=>row.agentId===agentId);if(!entry)return;if(entry.owned)onOwnedSelect(agentId,origin);else if(entry.fact)onSelect({...structuredClone(entry.fact),kind:'world-avatar',projectionVersion:entry.projectionVersion,x:entry.x,y:entry.y},origin);}
  function locateOwnedAgent(agentId){
    const point=ownedLayer.point(agentId);if(!point||destroyed||broken)return false;
    stopZoom();
    const scale=camera.base*camera.zoom,bounds=root.getBoundingClientRect();
    // Explicit location uses the normal full-stage projection. Compute the
    // destination before changing mode, and admit only reachable safe centres.
    const center={x:camera.width/2,y:camera.height/2};
    const header=document.querySelector('header'),top=Math.max(88,(header?.getBoundingClientRect().bottom||bounds.top+64)-bounds.top+16);
    const areas=freeAreas({left:24,right:camera.width-24,top,bottom:camera.height-24},worldOverlayRects(root,16));
    const geometry=ownedLayer.geometry(agentId),hit=geometry.hitBox,size=humanHitSize(geometry,scale),offsetX=(hit.left+hit.right)/2,offsetY=(hit.top+hit.bottom)/2,halfWidth=size.width/2,halfHeight=size.height/2;
    const area=areas.map(r=>({left:Math.max(r.left+halfWidth,center.x+(point.x-W+offsetX)*scale),right:Math.min(r.right-halfWidth,center.x+(point.x+offsetX)*scale),top:Math.max(r.top+halfHeight,center.y+(point.y-H+offsetY)*scale),bottom:Math.min(r.bottom-halfHeight,center.y+(point.y+offsetY)*scale)})).filter(r=>r.right>=r.left&&r.bottom>=r.top).sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
    if(!area)return false;
    mode='custom';
    camera.x=point.x+offsetX-((area.left+area.right)/2-center.x)/scale;camera.y=point.y+offsetY-((area.top+area.bottom)/2-center.y)/scale;
    // Explicit location may move a fitted world beneath the panel. The normal
    // full-viewport clamp would undo that pan when the world fits the viewport.
    camera.x=Math.max(0,Math.min(W,camera.x));camera.y=Math.max(0,Math.min(H,camera.y));draw();notify();return true;
  }
  function worldPoint(x,y){const s=camera.base*camera.zoom;const c=screenCenter();return{x:(x-c.x)/s+camera.x,y:(y-c.y)/s+camera.y};}
  function hit(x,y,cycle=false){
    const p=worldPoint(x,y);
    const town=[...(rendering?.npcs||[]),...(rendering?.serviceTargets||[]),...(rendering?.lifeTargets||[])].sort((a,b)=>b.y-a.y).find(o=>p.x>o.x-o.w/2-5&&p.x<o.x+o.w/2+5&&p.y>o.y-o.anchor.y-5&&p.y<o.y+o.h-o.anchor.y+5);
    const owned=ownedLayer.hit(p,camera.base*camera.zoom,cycle);if(owned){const b=ownedLayer.geometry(owned.agentId).hitBox,overBody=p.x>=owned.x+b.left&&p.x<=owned.x+b.right&&p.y>=owned.y+b.top&&p.y<=owned.y+b.bottom;if(!town||overBody)return owned;}
    // An Agent's enlarged pointer target must not cover a visible NPC or notice.
    if(town)return town;
    for(const actor of [...actors.slice(0,actorLimit)].reverse())if(Math.abs(p.x-actor.x)<12&&p.y>actor.y-34&&p.y<actor.y+7)return actor;
    return [...stagePlaces,...(rendering?.npcs||[]),...(rendering?.serviceTargets||[]),...(rendering?.lifeTargets||[])].sort((a,b)=>b.y-a.y).find(o=>!(rendering&&o.id==='commons')&&p.x>o.x-o.w/2-5&&p.x<o.x+o.w/2+5&&p.y>o.y-o.anchor.y-5&&p.y<o.y+o.h-o.anchor.y+5);
  }
  const pointers=new Map();let drag=null,pinch=null;
  const local=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const isMapPointerTarget=node=>node===canvas||node?.closest?.('.world-owned-hit')?.parentNode===ownedLayer.node||node?.closest?.('.world-town-hit')?.parentNode===townTargets.node;
  function pointerTarget(point,node,cycle=false){const direct=townTargets.target(node),spatial=hit(point.x,point.y,cycle);return direct?.kind==='life-place'&&spatial?.kind==='owned-agent'?spatial:direct||spatial;}
  function refreshOwnedHover(){
    if(!hoverPointer||(pointers.size&&drag?.moved)||!isMapPointerTarget(document.elementFromPoint(hoverPointer.clientX,hoverPointer.clientY))){ownedLayer.hover('');townTargets.hover(null);return null;}
    const p=local(hoverPointer),target=pointerTarget(p,document.elementFromPoint(hoverPointer.clientX,hoverPointer.clientY));ownedLayer.hover(target?.kind==='owned-agent'?target.agentId:'');townTargets.hover(target?.kind==='world-npc'||target?.kind==='town-notice'||target?.serviceNpc?target:null);canvas.style.cursor=target?'pointer':'grab';return target;
  }
  root.addEventListener('pointerdown',e=>{
    if(!isMapPointerTarget(e.target))return;
    if(e.pointerType==='touch'){hoverPointer=null;ownedLayer.hover('');townTargets.hover(null);}
    else hoverPointer={clientX:e.clientX,clientY:e.clientY};
    if(e.button!==0)return;stopZoom();const p=local(e);pointers.set(e.pointerId,p);canvas.setPointerCapture(e.pointerId);
    if(pointers.size===1)drag={start:p,last:p,moved:false,type:e.pointerType,origin:e.target};
    if(pointers.size===2&&exploring){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:camera.zoom};if(drag)drag.moved=true;}
  },eventOptions);
  root.addEventListener('pointermove',e=>{
    if(e.pointerType!=='touch')hoverPointer={clientX:e.clientX,clientY:e.clientY};
    const p=local(e);if(!pointers.has(e.pointerId)){refreshOwnedHover();return;}pointers.set(e.pointerId,p);
    if(pinch&&pointers.size===2){const[a,b]=[...pointers.values()];setZoom(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),{anchor:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},immediate:true});return;}
    if(!drag)return;
    if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>6){drag.moved=true;ownedLayer.hover('');townTargets.hover(null);}
    if(drag.type==='touch'&&!exploring)return;
    if(drag.moved){mode='custom';const s=camera.base*camera.zoom;camera.x-=(p.x-drag.last.x)/s;camera.y-=(p.y-drag.last.y)/s;clampCamera();canvas.classList.add('is-dragging');draw();}drag.last=p;
  },eventOptions);
  function finishPointer(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;const p=local(e),clicked=!cancelled&&drag&&!drag.moved&&pointers.size===1;
    pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(clicked){const place=pointerTarget(p,drag.origin,true),origin=drag.origin?.isConnected?drag.origin:canvas;canvas.focus({preventScroll:true});if(place?.kind==='owned-agent')selectAgent(place.agentId,origin);else if(place)onSelect(place,origin);}
    if(!pointers.size){drag=null;pinch=null;canvas.classList.remove('is-dragging');}else{pinch=null;if(drag){drag.moved=true;drag.last=[...pointers.values()][0];}}
  }
  root.addEventListener('pointerup',e=>finishPointer(e),eventOptions);root.addEventListener('pointercancel',e=>finishPointer(e,true),eventOptions);
  root.addEventListener('pointerleave',()=>{hoverPointer=null;ownedLayer.hover('');townTargets.hover(null);},eventOptions);
  window.addEventListener('avatar:resource',()=>{if(!destroyed)draw();},eventOptions);
  window.addEventListener('blur',()=>{hoverPointer=null;ownedLayer.hover('');townTargets.hover(null);},eventOptions);
  root.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey)||!e.deltaY)return;hoverPointer={clientX:e.clientX,clientY:e.clientY};e.preventDefault();const delta=Math.max(-240,Math.min(240,e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?camera.height:1)));setZoom((zoomMotion?.to??camera.zoom)*Math.exp(-delta*.0015),{anchor:local(e)});},{...eventOptions,passive:false});
  canvas.addEventListener('keydown',e=>{
    if(e.target!==canvas)return;
    if(['+','=','-','_','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
    if(e.key==='Home')fit();else if(['+','='].includes(e.key))zoomBy(1);else if(['-','_'].includes(e.key))zoomBy(-1);
    else{stopZoom();mode='custom';const step=64/(camera.base*camera.zoom);if(e.key==='ArrowLeft')camera.x-=step;if(e.key==='ArrowRight')camera.x+=step;if(e.key==='ArrowUp')camera.y-=step;if(e.key==='ArrowDown')camera.y+=step;clampCamera();draw();notify();}
  },eventOptions);
  reduced.addEventListener('change',e=>{if(e.matches){if(zoomMotion)advanceZoom(Infinity);paused=true;pauseReason='reduced';reconcile();notify();}},eventOptions);
  document.addEventListener('visibilitychange',()=>{reconcile();notify();},eventOptions);
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;reconcile();notify();},{threshold:.01});observer.observe(root);
  const resizer=new ResizeObserver(resize);resizer.observe(root);resize();reconcile();notify();
  return{canvas,setZoom,zoomBy,fit,reset,setExploring,select,setPaused,setTime,setReducedMotion,setOwnedAgents,setWorldScene,setTownNotice,clearScene,locateOwnedAgent,getState:state,getExpressions:()=>structuredClone(fullExpressions),destroy(){if(destroyed)return;destroyed=true;zoomMotion=null;cancelAnimationFrame(raf);observer.disconnect();resizer.disconnect();abort.abort();expressionLayer.dispose();expressions.clear();ownedLayer.destroy();townTargets.destroy();rendering?.dispose?.();canvas.remove();}};
}
export function placeDetails(place){
  if(place.kind==='world-avatar')return{name:place.profile.displayName,area:place.placeId==='commons'?'公共庭':'',icon:'○',description:'',note:''};
  return place.kind==='actor'?{name:'演示居民',area:'场景演示',icon:'○',description:`${['人形 01','人形 02','人形 03','机型 01','机型 02','机型 03'][place.style]}款式的演示人物。它沿预设道路行走与停留，只用于表现小镇的生活节奏。`,note:'这不是一个真实 Agent，没有真实姓名、账号或行为状态。'}:{...place,note:place.note||demoNote};
}
