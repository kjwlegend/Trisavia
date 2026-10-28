import {publicLifeLabel} from './life-public-state.js';
import {publicIdLabel} from '../public-id.js';
import {el} from '../common.js';
import {msg,t,isMessage,bindText,clearBinding} from '../i18n/core.js';
import {avatar} from '../scene.js';
import {createCharacterFriendship} from './friendship-ui.js';
import {createHumanBehaviorLogReader as createBehaviorLogReader} from './behavior-log-reader.js';
import {createBehaviorLogView} from './behavior-log-view.js';
import {expressionPolicy} from './world-expression-reader.js';
const m=(key,params)=>msg('public:character.'+key,params);
const put=(node,text)=>{clearBinding(node);if(isMessage(text))bindText(node,text.key,text.params);else if(node.textContent!==text)node.textContent=text;};
export function createPublicCharacterCard(reader,{session,getExpressions=()=>[]}={}){
  const node=el('section','public-character-card'),content=el('div','character-card-content'),hero=el('div','character-card-hero'),portrait=el('div','character-card-portrait'),identity=el('div','character-card-identity'),name=el('h3','character-card-name'),place=el('span','character-card-place'),bio=el('p','character-card-bio'),interestGroup=el('section','character-card-interests'),interestTitle=el('h3','',m('interests')),tags=el('div','character-card-tags'),empty=el('p','character-card-empty',m('noInterests')),status=el('p','character-card-status'),retry=el('button','',m('retry'));
  node.hidden=true;const number=el('p','paper-stable-id');identity.append(name,number,place);hero.append(portrait,identity);interestGroup.append(interestTitle,tags,empty);retry.type='button';retry.addEventListener('click',()=>void reader.retry());status.setAttribute('role','status');const activity=el('p','character-life-activity');content.append(hero,status,activity,bio,interestGroup,retry);node.append(content);
  const friendship=session?createCharacterFriendship(session):null;if(friendship)node.append(friendship.node);
  const expression=el('section','character-current-expression'),expressionLabel=el('strong'),expressionText=el('p');expression.hidden=true;expression.append(expressionLabel,expressionText);content.append(expression);
  const recent=el('details','character-recent-records'),logReader=createBehaviorLogReader({mode:'recent'}),logs=createBehaviorLogView(logReader,{mode:'recent'});let logTarget='',logAvailable=false;recent.append(el('summary','',m('recent')),logs.node);content.append(recent);recent.addEventListener('toggle',()=>logReader.setActive(recent.open&&logAvailable));
  let portraitKey='',tagKey='';const picture=el('div','character-card-sprite');portrait.append(picture);
  function render(value){
    const readable=Boolean(value.data),visible=['loading','ready','refreshing','recovering'].includes(value.phase),data=value.data,scene=value.scene,identityData=data||(visible&&scene?{displayName:scene.profile.displayName,appearance:scene.profile.appearance}:null);
    friendship?.update({agentId:scene?.agentId||'',visible:value.phase==='ready'&&!value.stale});
    const target=scene?.agentId||'';logAvailable=value.phase==='ready';if(logTarget!==target){recent.open=false;logReader.setActive(false);logTarget=target;logReader.target(target);}if(!logAvailable)logReader.setActive(false);else logReader.setActive(recent.open);recent.hidden=!logAvailable;
    hero.hidden=!identityData;bio.hidden=interestGroup.hidden=!readable;retry.hidden=!['error','recovering'].includes(value.phase)||[403,404].includes(value.errorStatus);
    const activityReadable=readable&&visible&&Boolean(scene?.activity);activity.hidden=!activityReadable;put(activity,activityReadable?msg('public:life.name',()=>{let activity=publicLifeLabel(scene.activity);if(scene.sceneStale||value.stale)activity=t('public:character.activityStale',{activity});if(scene.activity.actionId==='fish.session'&&data.appearance?.kind==='custom')activity=t('public:character.customFishing',{activity});return{name:activity};}):'');
    put(name,identityData?.displayName||'');put(number,publicIdLabel(data?.publicId||scene?.publicId||scene?.profile?.publicId));put(place,visible&&scene?.placeId==='commons'?m('commons'):'');place.hidden=!place.textContent;
    const key=identityData?JSON.stringify([scene.agentId,identityData.appearance]):'',changedPortrait=key!==portraitKey;if(changedPortrait){portraitKey=key;picture.replaceChildren();}if(identityData&&(changedPortrait||identityData.appearance?.kind==='custom'))avatar(picture,{displayName:identityData.displayName,appearance:identityData.appearance,activity:readable&&visible?scene?.activity:null,stale:scene?.sceneStale||value.stale},scene.agentId);
    put(bio,data?.bio?.trim()?data.bio:m('emptyBio'));
    const interests=data?.interests||[],nextTags=JSON.stringify(interests);if(nextTags!==tagKey){tagKey=nextTags;tags.replaceChildren(...interests.map(text=>el('span','character-card-tag',text)));}empty.hidden=interests.length>0;
    put(status,value.stale?m('profileStale'):value.phase==='loading'?m('profileLoading'):value.phase==='error'?m([403,404].includes(value.errorStatus)?'profileHidden':'profileError'):'');status.hidden=!status.textContent;
    const current=scene&&readable&&value.phase==='ready'&&!value.stale&&!scene?.sceneStale?getExpressions().find(row=>row.actor.kind==='agent'&&row.actor.id===scene.agentId&&['speech','emote'].includes(row.kind)):null;expression.hidden=!current;put(expressionLabel,current?identityData.displayName:'');put(expressionText,current?current.kind==='speech'?current.text:expressionPolicy.emotes.some(e=>e.id===current.emoteId)?m('emote.'+current.emoteId):'':'');
  }
  const stop=reader.subscribe(render),changed=()=>render(reader.snapshot());document.addEventListener('world:expressions',changed);
  return{node,dispose(){stop();document.removeEventListener('world:expressions',changed);friendship?.dispose();logs.dispose();logReader.dispose();}};
}
