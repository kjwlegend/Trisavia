import {api,ApiError} from '../common.js';
import {createLifeReadState} from './life-read-state.js';

const invalid=()=>{throw Object.assign(Error('npc_life_response_invalid'),{code:'npc_life_response_invalid'});};
const integer=v=>Number.isSafeInteger(v)&&v>=0,positive=v=>integer(v)&&v>0,id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(v),text=(v,max=100)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\p{Cc}]/u.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function object(v,names,required=names){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k))||required.some(k=>!Object.hasOwn(v,k)))invalid();return v;}
function list(v,max,read){if(!Array.isArray(v)||v.length>max)invalid();return v.map(read);}
function unique(rows,key){if(new Set(rows.map(v=>v[key])).size!==rows.length)invalid();return rows;}
function envelope(raw){if(raw?.protocolVersion!==1||!text(raw.instanceId,180)||!integer(raw.data?.asOf))invalid();return raw.data;}
function ref(v){object(v,['id','version','digest']);if(!id(v.id)||!positive(v.version)||!hash(v.digest))invalid();return structuredClone(v);}
function nullable(v,read){return v===null?null:read(v);}
const time=v=>{if(!integer(v))invalid();return v;},identifier=v=>{if(!id(v))invalid();return v;};
function coordinate(v,rules){object(v,['x','y']);if(!Number.isSafeInteger(v.x)||!Number.isSafeInteger(v.y)||!rules?.bounds||v.x<rules.bounds.minX||v.x>rules.bounds.maxX||v.y<rules.bounds.minY||v.y>rules.bounds.maxY)invalid();return{x:v.x,y:v.y};}
function introduction(v,agentId){
 object(v,['introductionId','version','npcId','agentId','planId','careKind','pointId','pointVersion','guideRef','createdAt','expiresAt','consumedByActivityId']);
 if(!id(v.introductionId)||!positive(v.version)||v.npcId!=='npc-gardener'||v.agentId!==agentId||!id(v.planId)||!['water','clear'].includes(v.careKind)||!id(v.pointId)||!positive(v.pointVersion)||!integer(v.createdAt)||!integer(v.expiresAt)||v.expiresAt<=v.createdAt||v.expiresAt-v.createdAt>1800000)invalid();
 return{...v,guideRef:ref(v.guideRef),consumedByActivityId:nullable(v.consumedByActivityId,identifier)};
}
export function readNpcLifeDirectory(raw,rules){
 const v=envelope(raw);object(v,['worldId','definitionVersion','ruleVersion','map','spatialRef','npcs','carePoints','guides','rules','asOf']);
 object(v.map,['mapId','rulesetVersion','topologyVersion','geometryDigest']);object(v.spatialRef,['url','revision','sha256']);
 if(v.worldId!=='default'||v.definitionVersion!==1||v.ruleVersion!==1||v.map.mapId!=='pixel-town-v2'||v.map.rulesetVersion!==6||v.map.topologyVersion!==6||rules?.version!==6||rules.topologyVersion!==6||v.map.mapId!==rules.mapManifest?.mapId||v.map.geometryDigest!==rules.mapManifest?.geometryDigest||!hash(v.map.geometryDigest)||!text(v.spatialRef.url,500)||!v.spatialRef.url.startsWith('/assets/')||!positive(v.spatialRef.revision)||!hash(v.spatialRef.sha256))invalid();
 const limits={version:1,durationMs:120000,energyCost:6,pointCooldownMs:3600000,actorPointCooldownMs:86400000,maxIntroductionLifetimeMs:1800000};object(v.rules,Object.keys(limits));if(Object.entries(limits).some(([k,value])=>v.rules[k]!==value))invalid();
 const guides=unique(list(v.guides,2,g=>{object(g,['id','version','digest','title','body']);ref({id:g.id,version:g.version,digest:g.digest});if(!text(g.title)||typeof g.body!=='string'||!g.body.trim()||g.body.length>8000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(g.body))invalid();return structuredClone(g);}), 'id');
 const carePoints=unique(list(v.carePoints,2,p=>{
  object(p,['pointId','version','careKind','name','placeId','cell','approachCells','available','reason','nextEligibleAt','lastCareAt','actorId','guideRef'],['pointId','version','careKind','name','placeId','cell','approachCells','available','reason','nextEligibleAt','lastCareAt','guideRef']);
  if(!id(p.pointId)||!positive(p.version)||!['water','clear'].includes(p.careKind)||!text(p.name)||!id(p.placeId)||typeof p.available!=='boolean'||p.reason!==null&&!id(p.reason))invalid();
  const guideRef=ref(p.guideRef);if(p.available&&!guides.some(g=>g.id===guideRef.id&&g.version===guideRef.version&&g.digest===guideRef.digest))invalid();
  return{...p,cell:coordinate(p.cell,rules),approachCells:list(p.approachCells,16,c=>coordinate(c,rules)),guideRef,nextEligibleAt:nullable(p.nextEligibleAt,time),lastCareAt:nullable(p.lastCareAt,time),...(Object.hasOwn(p,'actorId')?{actorId:nullable(p.actorId,identifier)}:{})};
 }), 'pointId');
 const npcs=unique(list(v.npcs,1,n=>{
  object(n,['npcId','version','name','role','position','motion','appearance','present','busy']);object(n.appearance,['kind','version','assetId','manifestUrl','digest']);
  if(n.npcId!=='npc-gardener'||!positive(n.version)||!text(n.name)||!text(n.role)||typeof n.present!=='boolean'||typeof n.busy!=='boolean'||n.appearance.kind!=='npc_sprite'||n.appearance.version!==1||!id(n.appearance.assetId)||!text(n.appearance.manifestUrl,500)||!n.appearance.manifestUrl.startsWith('/assets/')||!hash(n.appearance.digest))invalid();
  const position=coordinate(n.position,rules);let motion=null;if(n.motion!==null){const m=n.motion;object(m,['segmentId','movementId','source','from','to','startedAt','arriveAt','rulesetVersion','topologyVersion','status']);const from=coordinate(m.from,rules),to=coordinate(m.to,rules);if(!id(m.segmentId)||m.movementId!==null&&!id(m.movementId)||!['explicit','idle'].includes(m.source)||m.status!=='committed'||m.rulesetVersion!==6||m.topologyVersion!==6||!integer(m.startedAt)||!integer(m.arriveAt)||![500,1000].includes(m.arriveAt-m.startedAt)||Math.abs(from.x-to.x)+Math.abs(from.y-to.y)!==1||position.x!==to.x||position.y!==to.y)invalid();motion={...m,from,to};}
  return{...n,position,motion,appearance:structuredClone(n.appearance)};
 }), 'npcId');
 return{instanceId:raw.instanceId,data:{...v,map:{...v.map},spatialRef:{...v.spatialRef},rules:limits,npcs,carePoints,guides}};
}
export function readNpcCareOptions(raw,agentId){
 const v=envelope(raw);object(v,['agentId','definitionVersion','energy','points','asOf']);object(v.energy,['available','required']);if(v.agentId!==agentId||!id(agentId)||v.definitionVersion!==1||!integer(v.energy.available)||v.energy.available>100||v.energy.required!==6)invalid();
 const points=unique(list(v.points,2,p=>{object(p,['pointId','version','available','reason','nextEligibleAt','introduction']);if(!id(p.pointId)||!positive(p.version)||typeof p.available!=='boolean'||p.reason!==null&&!id(p.reason))invalid();const intro=nullable(p.introduction,v=>introduction(v,agentId));if(intro&&(intro.pointId!==p.pointId||intro.pointVersion!==p.version))invalid();return{...p,nextEligibleAt:nullable(p.nextEligibleAt,time),introduction:intro};}), 'pointId');
 return{instanceId:raw.instanceId,data:{...v,energy:{...v.energy},points}};
}
/** Owner transport gets only this named read; never a token, generic prefix or write operation. */
export function npcLifeReadInput(operation,input,target){
 if(operation!=='care.options')throw new ApiError('insufficient_scope',403);
 if(!id(target)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new ApiError('invalid_request',422);
 return{agentId:target};
}
export function createNpcLifeDirectoryReader({getRules,request=api,...options}={}){return createLifeReadState({...options,read:({signal})=>request('/world/npc-life/directory',{signal}),validate:raw=>readNpcLifeDirectory(raw,getRules())});}
export function createNpcCareOptionsReader(session,{read=(_operation,input,options)=>session.readNpcLife('care.options',input,options),...options}={}){return createLifeReadState({...options,session,privateScope:true,read:({signal})=>read('npc_life.care.options',{}, {signal}),validate:readNpcCareOptions});}

/** A copied goal is public task context, never a receipt or an Owner-submitted Agent plan. */
export function buildNpcCareIntent({origin,agentLabel='',directory,point,options}){
 const fail=()=>{throw Error('npc_life_intent_unavailable');};let url;try{url=new URL(origin);}catch{fail();}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||agentLabel&&!text(agentLabel,180)||directory?.definitionVersion!==1||directory.ruleVersion!==1||!Array.isArray(directory.carePoints)||!Array.isArray(directory.npcs)||options?.definitionVersion!==1||!id(options.agentId)||!Array.isArray(options.points)||!id(point?.pointId)||!positive(point.version))fail();
 const selected=directory.carePoints.find(p=>p.pointId===point.pointId&&p.version===point.version),eligibility=options.points.find(p=>p.pointId===point.pointId&&p.version===point.version),npc=directory.npcs.find(n=>n.npcId==='npc-gardener');
 if(!selected||!eligibility||!npc||!positive(npc.version)||!id(selected.placeId)||!['water','clear'].includes(selected.careKind))fail();
 const guideRef=ref(selected.guideRef),goal={definitionVersion:1,npcId:npc.npcId,pointId:selected.pointId,expectedPointVersion:selected.version,expectedNpcVersion:npc.version,placeId:selected.placeId,guideRef};
 return`请沿用你在 ${url.origin} 的已有 Trisavia 身份，不重新注册。先核对${agentLabel?`目标居民「${agentLabel}」与你本人一致`:'你本人的居民身份'}，不替其他Agent操作，不更改主人权限。
完整读取 ${url.origin}/agent/runtime.md，刷新 ${url.origin}/v1/capabilities，发现当前npc_life目录、本人照料预览与Life有限计划的精确规范；本次目标定位 ${JSON.stringify(goal)}。这里只选择这一处公共照料，不扩展为购物、赠礼或其他照料点。
自己重读本人的权限、体力、真实位置、点版本和当前说明；若该项已启用且仍合法，安排一份最多30分钟的有限计划：实际走到青禾接待位置→即时介绍步骤care.introduce→走到这个照料点→care.perform。介绍必须由本计划真实产生，后续通过本计划介绍步骤的careIntroduction类型化输出取得一次引用，不能使用别人的、旧计划的或另行伪造的引用。具体输入和stepId由你沿实时规范生成，不把这段定位当已提交载荷。
本目标0星币、0背包物品，照料120秒、最多6体力；开始只预留，完成才写本轮照料事实。介绍后释放青禾，不声称她全程陪同。点冷却、本人24小时限制、暂停或失权、无人接待或当前不可开始时自行选择延期或其他已获准生活，不盲试或请主人解除限制；不把冷却结束当作植物生长、缺水或又有落叶。
保存原commandId和完整输入，未知先查同次回执与活动；已经提交的计划不换版本或载荷，不重复预留和结算。按真实结果简短说明做成与否和自主调整，未完成不编完成；本人的感受可以自然表达，无值得分享的新内容可静默。复制不代表已经开始、完成、发币或赠送工具。`;
}
