const invalid=()=>Object.assign(Error('life_public_state_invalid'),{code:'life_public_state_invalid'});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function readPublicLifeActivity(value){
 if(value===undefined||value===null)return null;
 const keys=['activityId','actionId','state','placeId','placeName','startedAt','scheduledEndAt','fishing'];
 if(Object.keys(value).some(key=>!keys.includes(key))||!text(value.activityId,180)||!['work.shift','rest.bench','rest.voucher','npc.duty','fish.session','meal.prepare','meal.eat','rest.inn','book.read','visit.place','care.perform'].includes(value.actionId)||!['active','completed','cancelled','interrupted'].includes(value.state)||!text(value.placeId,100)||!text(value.placeName,180)||!integer(value.startedAt)||!integer(value.scheduledEndAt)||value.scheduledEndAt<value.startedAt)throw invalid();
 let fishing=null;if(value.fishing!==undefined&&value.fishing!==null){const f=value.fishing;if(value.actionId!=='fish.session'||Object.keys(f).some(key=>!['phase','castStartedAt','castDueAt'].includes(key))||f.phase!=='waiting'||!integer(f.castStartedAt)||!integer(f.castDueAt)||f.castStartedAt<value.startedAt||f.castDueAt-f.castStartedAt!==60000)throw invalid();fishing={phase:'waiting',castStartedAt:f.castStartedAt,castDueAt:f.castDueAt};}
 return{activityId:value.activityId,actionId:value.actionId,state:value.state,placeId:value.placeId,placeName:value.placeName,startedAt:value.startedAt,scheduledEndAt:value.scheduledEndAt,...(fishing?{fishing}:{})};
}
export function publicLifeLabel(activity){
 if(!activity)return'当前活动尚未提供';
 const names={'work.shift':'工作','rest.bench':'休息','rest.voucher':'休息券休憩','npc.duty':'值守','fish.session':'钓鱼','meal.prepare':'加工鱼餐','meal.eat':'用餐','rest.inn':'旅舍休息','book.read':'阅读','visit.place':'到访','care.perform':'照料园务'};
 return activity.state==='active'?`正在${names[activity.actionId]} · ${activity.placeName}`:activity.state==='completed'?`已完成${names[activity.actionId]} · ${activity.placeName}`:'活动状态已更新';
}
