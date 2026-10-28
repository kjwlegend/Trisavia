import {el} from '../common.js';
import {t,bindText,bindAttribute,getLocale,onLocaleChange} from '../i18n/core.js';
import {readOfficialPresentation} from './official-content.js';
export const lifeTime=value=>new Date(value).toLocaleString(getLocale(),{hour12:false});
export const lifeDuration=seconds=>t(seconds%60===0?'public:life.duration.minutes':'public:life.duration.seconds',{count:seconds%60===0?seconds/60:seconds});
/** The catalog revision is not a guide/schema, activity version or item holding version. */
export function lifeNameSource(catalog,row,kind='action'){
 let id,version=catalog.catalogRevision,selector={};
 if(kind==='place')id=row.placeId;
 else if(kind==='item')id=row.id;
 else if(kind==='book'){id=row.bookId;version=row.version;}
 else{id=row.actionId;selector=row.jobId?{jobId:row.jobId}:row.spotId?{spotId:row.spotId}:{placeId:row.placeId};if(id==='care.introduce'||id==='care.perform')version=catalog.npcLife?.definitionVersion;}
 return{namespace:'life-content',spec:{id,ref:id,version,selector,values:kind==='book'?{title:row.title,authorDisplay:row.authorDisplay}:{name:row.name}},field:kind==='book'?'title':'name'};
}
/** Only display bindings and current public source proofs; no reads of Agent state or business operations. */
export function createLifePresentation(){
 const note=el('p','hud-muted official-content-note');note.hidden=true;let generation=0;const stops=[],proofs=[];
 function annotate(){const failed=proofs.flat().filter(v=>v.status!=='matched');note.hidden=getLocale()==='zh-CN'||!failed.length;note.textContent=note.hidden?'':t(failed.some(v=>v.status==='changed')?'public:content.sourceChanged':'public:content.unavailable');}
 function bind(node,attribute,key,params,sources={}){
  const turn=generation,values={},getParams=()=>({...(typeof params==='function'?params():params),...Object.fromEntries(Object.entries(values).map(([param,value])=>[param,value.proof.text(value.field)]))}),apply=()=>attribute?bindAttribute(node,attribute,key,getParams):bindText(node,key,getParams);
  let off=apply();stops.push(()=>off());const entries=Object.entries(sources).filter(([,source])=>source),index=proofs.push([])-1;
  if(entries.length)void Promise.all(entries.map(async([param,source])=>({param,field:source.field,proof:await readOfficialPresentation(source.namespace,source.spec)}))).then(results=>{if(turn!==generation)return;for(const result of results)values[result.param]=result;proofs[index]=results.map(result=>result.proof);off();off=apply();node.dataset.contentSource=results.every(r=>r.proof.status==='matched')?'matched':results.some(r=>r.proof.status==='changed')?'changed':'unavailable';annotate();});
  return node;
 }
 function clear(){generation++;for(const stop of stops.splice(0))stop();proofs.length=0;note.hidden=true;}
 const stopLocale=onLocaleChange(annotate);
 return{note,label:(node,key,params,sources)=>bind(node,null,key,params,sources),attribute:(node,attribute,key,params,sources)=>bind(node,attribute,key,params,sources),clear,dispose(){clear();stopLocale();}};
}
