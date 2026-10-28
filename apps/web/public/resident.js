import {readPublicId,publicIdLabel} from './public-id.js';
import {$,el,api} from './common.js';
import {avatar} from './scene.js';
import {nativeFrame} from './world-pixel/native-ui.js';
import {readPublicCharacter} from './hud/public-character-reader.js';
import {createHumanBehaviorLogReader as createBehaviorLogReader} from './hud/behavior-log-reader.js';
import {createBehaviorLogView} from './hud/behavior-log-view.js';
import {mountPublicNavigation} from './public-navigation.js';
import {getLocale,t,onLocaleChange,stripLocalePath,localePath} from './i18n/core.js';
const navigation=mountPublicNavigation();await navigation.ready;
for(const sheet of document.querySelectorAll('.resident-sheet'))sheet.prepend(nativeFrame('lightWood'));
const logs=createBehaviorLogReader({mode:'recent'}),logView=createBehaviorLogView(logs,{mode:'recent'});$('#resident-logs').append(logView.node);
let generation=0,controller=null,loaded=false,rechecking=false,profile=null,asOf=null,errorKey=null;
let agentId='';try{agentId=decodeURIComponent(stripLocalePath(location.pathname).split('/').filter(Boolean).at(-1)||'');}catch{}
const validId=Boolean(readPublicId(agentId))||/^[A-Za-z0-9_-]{8,100}$/.test(agentId);
function labels(){document.title=profile?t('public:resident.profileTitle',{name:profile.displayName}):t('public:resident.title');if(profile&&!profile.bio)$('#resident-bio').textContent=t('public:resident.emptyBio');if(profile){const target=new URL(localePath('/'),location.origin);target.searchParams.set('resident',profile.publicId||agentId);$('#resident-locate').href=target.pathname+target.search;$('#resident-asof').textContent=Number.isSafeInteger(asOf)?new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(asOf):t('public:resident.notProvided');}if(errorKey)$('#public-error-text').textContent=t(errorKey);}
function clearProfile(){loaded=false;profile=null;asOf=null;logs.setActive(false);$('#public-resident').hidden=true;$('#resident-locate').removeAttribute('href');$('#public-avatar').replaceChildren();$('#resident-name').textContent='';$('#resident-bio').textContent='';$('#resident-interests').replaceChildren();labels();}
async function load({recheck=false}={}){
 const turn=++generation;controller?.abort();controller=new AbortController();rechecking=recheck;
 if(!recheck){clearProfile();$('#public-status').hidden=false;$('#public-error').hidden=true;}
 try{
  if(!validId)throw Object.assign(new Error('not_found'),{status:404});
  const response=await api(`/public/agents/${encodeURIComponent(agentId)}`,{signal:controller.signal}),data=readPublicCharacter(response,agentId,1);if(turn!==generation)return;
  profile=data;asOf=response.asOf;errorKey=null;$('#resident-name').textContent=data.displayName;$('#resident-bio').textContent=data.bio||t('public:resident.emptyBio');$('#resident-interests').replaceChildren(...data.interests.map(text=>el('span','character-card-tag',text)));$('#resident-interests-empty').hidden=data.interests.length>0;
  avatar($('#public-avatar'),data,data.agentId);$('#resident-id').textContent=publicIdLabel(data.publicId);$('#resident-version').textContent=String(data.publishedVersion);labels();
  loaded=true;$('#public-error').hidden=true;$('#public-resident').hidden=false;logs.target(data.agentId);logs.setActive(true);
 }catch(error){
  if(turn!==generation||error.name==='AbortError')return;
  if(recheck&&![403,404].includes(error.status))return;
  clearProfile();errorKey=[403,404].includes(error.status)?'public:resident.hidden':'public:resident.unavailable';labels();$('#public-retry').hidden=[403,404].includes(error.status);$('#public-error').hidden=false;
 }finally{if(turn===generation){rechecking=false;$('#public-status').hidden=true;}}
}
const stopLogs=logs.subscribe(value=>{if(loaded&&!rechecking&&value.phase==='forbidden'&&[403,404].includes(value.errorStatus))void load({recheck:true});});
$('#public-retry').addEventListener('click',()=>void load());
const stopLocale=onLocaleChange(labels);window.addEventListener('pagehide',event=>{if(!event.persisted){generation++;controller?.abort();stopLocale();stopLogs();logs.dispose();logView.dispose();}});
void load();
