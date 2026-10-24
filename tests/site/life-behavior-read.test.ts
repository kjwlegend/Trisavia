import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser log parser is plain JavaScript.
import {readBehaviorLogs} from '../../apps/web/public/hud/behavior-log-reader.js';
const row=(id:string,domain:string,node:string)=>({id,agent:{agentId:'own-a',displayName:'样本'},title:'事实记录',action:'完成活动',result:'已按真实来源记录',occurredAt:1000,date:'2026-10-25',time:'12:00',source:{domain,node,detail:null},details:null});
const envelope=(items:any[])=>({protocolVersion:1,data:{worldId:'default',agentId:'own-a',timeZone:'UTC',items,asOf:1000,partial:false,nextPageToken:null,historyCoverage:{from:1000,to:1000,complete:true,gaps:[]}}});
test('mixed old and exact life source nodes parse without accepting future or unknown life actions',()=>{
 const items=[row('old','town_services','town_services.welcome.claimed'),row('work','life','life.work.completed'),row('rest','life','life.rest.completed'),row('interrupted','life','life.activity.interrupted')];assert.equal(readBehaviorLogs(envelope(items),{mode:'owner',agentId:'own-a',timeZone:'UTC'}).items.length,4);assert.throws(()=>readBehaviorLogs(envelope([row('fish','life','life.fishing.finished')]),{mode:'owner',agentId:'own-a',timeZone:'UTC'}));assert.throws(()=>readBehaviorLogs(envelope([row('unknown','future','life.work.completed')]),{mode:'owner',agentId:'own-a',timeZone:'UTC'}));
});
test('NPC world life history has a real NPC source and excludes private amounts and owner histories',()=>{
 const npc={...row('npc-work','life','life.work.completed'),agent:{agentId:null,npcId:'npc-harbor-hand',actorKind:'npc',displayName:'码头熟手'},details:{version:1,completeness:'recorded',phase:'life_work',phaseLabel:'工作',summary:'已完成',timeRange:{startedAt:0,endedAt:1000,durationMs:1000},location:null,journey:null,participants:[],initiator:{kind:'system',label:'世界规则'},executor:{kind:'npc',label:'码头熟手'},gaps:[],life:{activityId:'npc-activity',actionId:'work.shift',jobId:'harbor_shift',resultId:'npc-activity',scheduledEndAt:1000,energySpent:null,energyRestored:null,coinReward:null}}};
 const world={...envelope([row('old','world','world.move.completed'),npc]),data:{...envelope([row('old','world','world.move.completed'),npc]).data,agentId:null}};
 assert.equal(readBehaviorLogs(world,{mode:'world',agentId:null,timeZone:'UTC'}).items[1].agent.npcId,'npc-harbor-hand');
 assert.throws(()=>readBehaviorLogs({...world,data:{...world.data,items:[{...npc,details:{...npc.details,life:{...npc.details.life,coinReward:36}}}]}},{mode:'world',agentId:null,timeZone:'UTC'}));
 assert.throws(()=>readBehaviorLogs(envelope([npc]),{mode:'owner',agentId:'own-a',timeZone:'UTC'}));
});
