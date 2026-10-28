import {t} from '../i18n/core.js';
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
 if(!activity)return t('public:activity.unavailable');
 const names={'work.shift':'work','rest.bench':'restBench','rest.voucher':'restVoucher','npc.duty':'duty','fish.session':'fishing','meal.prepare':'prepareMeal','meal.eat':'meal','rest.inn':'inn','book.read':'reading','visit.place':'visit','care.perform':'care'};
 return activity.state==='active'||activity.state==='completed'?t(activity.state==='active'?'public:activity.active':'public:activity.completed',{activity:t('public:life.activity.'+names[activity.actionId]),place:activity.placeName}):t('public:activity.updated');
}
