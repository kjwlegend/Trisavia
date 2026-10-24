const invalid=()=>Object.assign(Error('life_public_state_invalid'),{code:'life_public_state_invalid'});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function readPublicLifeActivity(value){
 if(value===undefined||value===null)return null;
 const keys=['activityId','actionId','state','placeId','placeName','startedAt','scheduledEndAt'];
 if(Object.keys(value).some(key=>!keys.includes(key))||!text(value.activityId,180)||!['work.shift','rest.bench','rest.voucher','npc.duty'].includes(value.actionId)||!['active','completed','cancelled','interrupted'].includes(value.state)||!text(value.placeId,100)||!text(value.placeName,180)||!integer(value.startedAt)||!integer(value.scheduledEndAt)||value.scheduledEndAt<value.startedAt)throw invalid();
 return{activityId:value.activityId,actionId:value.actionId,state:value.state,placeId:value.placeId,placeName:value.placeName,startedAt:value.startedAt,scheduledEndAt:value.scheduledEndAt};
}
export function publicLifeLabel(activity){
 if(!activity)return'当前活动尚未提供';
 const names={'work.shift':'工作','rest.bench':'休息','rest.voucher':'休息券休憩','npc.duty':'值守'};
 return activity.state==='active'?`正在${names[activity.actionId]} · ${activity.placeName}`:activity.state==='completed'?`已完成${names[activity.actionId]} · ${activity.placeName}`:'活动状态已更新';
}
