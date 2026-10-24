import {publicIdLabel} from '../public-id.js';
import {el} from '../common.js';
import {avatar} from '../scene.js';
import {createCharacterFriendship} from './friendship-ui.js';
import {createBehaviorLogReader} from './behavior-log-reader.js';
import {createBehaviorLogView} from './behavior-log-view.js';
const put=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
export function createPublicCharacterCard(reader,{session}={}){
  const node=el('section','public-character-card'),content=el('div','character-card-content'),hero=el('div','character-card-hero'),portrait=el('div','character-card-portrait'),identity=el('div','character-card-identity'),name=el('h3','character-card-name'),place=el('span','character-card-place'),bio=el('p','character-card-bio'),interestGroup=el('section','character-card-interests'),interestTitle=el('h3','','兴趣爱好'),tags=el('div','character-card-tags'),empty=el('p','character-card-empty','尚未填写兴趣。'),status=el('p','character-card-status'),retry=el('button','','重新读取');
  node.hidden=true;const number=el('p','paper-stable-id');identity.append(name,number,place);hero.append(portrait,identity);interestGroup.append(interestTitle,tags,empty);retry.type='button';retry.addEventListener('click',()=>void reader.retry());status.setAttribute('role','status');content.append(hero,status,bio,interestGroup,retry);node.append(content);
  const friendship=session?createCharacterFriendship(session):null;if(friendship)node.append(friendship.node);
  const recent=el('details','character-recent-records'),logReader=createBehaviorLogReader({mode:'recent'}),logs=createBehaviorLogView(logReader,{mode:'recent'});let logTarget='',logAvailable=false;recent.append(el('summary','','最近记录'),logs.node);content.append(recent);recent.addEventListener('toggle',()=>logReader.setActive(recent.open&&logAvailable));
  let portraitKey='',tagKey='';const picture=el('div','character-card-sprite');portrait.append(picture);
  const stop=reader.subscribe(value=>{
    const readable=Boolean(value.data),visible=['loading','ready','refreshing','recovering'].includes(value.phase),data=value.data,scene=value.scene,identityData=data||(visible&&scene?{displayName:scene.profile.displayName,appearance:scene.profile.appearance}:null);
    friendship?.update({agentId:scene?.agentId||'',visible:value.phase==='ready'&&!value.stale});
    const target=scene?.agentId||'';logAvailable=value.phase==='ready';if(logTarget!==target){recent.open=false;logReader.setActive(false);logTarget=target;logReader.target(target);}if(!logAvailable)logReader.setActive(false);else logReader.setActive(recent.open);recent.hidden=!logAvailable;
    hero.hidden=!identityData;bio.hidden=interestGroup.hidden=!readable;retry.hidden=!['error','recovering'].includes(value.phase)||[403,404].includes(value.errorStatus);
    put(name,identityData?.displayName||'');put(number,publicIdLabel(data?.publicId||scene?.publicId||scene?.profile?.publicId));put(place,visible&&scene?.placeId==='commons'?'公共庭':'');place.hidden=!place.textContent;
    const key=identityData?JSON.stringify([scene.agentId,identityData.appearance]):'';if(key!==portraitKey){portraitKey=key;picture.replaceChildren();if(identityData)avatar(picture,{displayName:identityData.displayName,appearance:identityData.appearance},scene.agentId);}
    put(bio,data?.bio?.trim()?data.bio:'尚未填写简介。');
    const interests=data?.interests||[],nextTags=JSON.stringify(interests);if(nextTags!==tagKey){tagKey=nextTags;tags.replaceChildren(...interests.map(text=>el('span','character-card-tag',text)));}empty.hidden=interests.length>0;
    put(status,value.stale?'上次公开资料已过期，正在尝试更新。':value.phase==='loading'?'正在读取公开资料…':value.phase==='error'?[403,404].includes(value.errorStatus)?'这位角色的公开资料暂不可查看。':'公开资料暂时无法读取，请稍后重试。':'');status.hidden=!status.textContent;
  });
  return{node,dispose(){stop();friendship?.dispose();logs.dispose();logReader.dispose();}};
}
