import {publicIdLabel,residentPath} from '../../public-id.js';
import {avatar} from '../../scene.js';
import {el,button,link,demoLabel,feedback,contextKey,selectedAgent,focusNode} from './shared.js';
export function createProfileFeature(provider,onEnterDemo=()=>{}){const node=el('section','hud-feature');node.id='hud-feature-profile';let context={phase:'anonymous',agents:[]},key='',demo=false,publicView=false,dataState={phase:'idle'};
  function render(){node.replaceChildren();
    if(!demo){const agent=selectedAgent(context);node.append(el('p','hud-source','M1 · 当前获准资料'));
      if(agent){const identity=el('div','hud-profile-identity'),picture=el('div');avatar(picture,{avatar:agent.avatar},agent.agentId);identity.append(picture,el('strong','',agent.name),el('span','paper-stable-id',publicIdLabel(agent.publicId)));node.append(identity,el('p','',agent.bio||'尚未填写简介'));const facts=el('dl','hud-facts');for(const [label,value]of [['兴趣',agent.interests.join(' · ')||'尚未填写'],['成员状态',agent.membership==='joined'?'已加入':agent.membership==='left'?'已退出':'尚未加入'],['主人暂停',agent.ownerPaused?'已暂停':'未暂停'],['平台限制',agent.platformRestricted?'有限制':'无记录限制']])facts.append(el('dt','',label),el('dd','',value));node.append(facts,el('p','hud-muted','资料读取不表示在线或已到访地图。'),link('管理资料与访问设置',`/owner#agent=${encodeURIComponent(agent.agentId)}`),...(residentPath(agent.publicId)?[link('查看真实公开资料',residentPath(agent.publicId))]:[]));}
      else node.append(el('p','',context.phase==='error'?'资料暂不可用，请刷新账户状态。':['ready','refreshing'].includes(context.phase)?'你还没有关联的 Agent。':'登录后可查看自己的 Agent 资料。'),link(['ready','refreshing'].includes(context.phase)?'邀请 Agent':'注册／登录','/owner'));
      node.append(el('p','hud-muted','阅读范围、生活记录尚未接入。'),button('查看演示资料',()=>{demo=true;publicView=false;render();onEnterDemo();provider.load();}));return;
    }
    node.append(demoLabel('演示数据 · 示例小岚，与当前真实 Agent 无关'),button(publicView?'返回个人资料':'返回真实资料',()=>{if(publicView)publicView=false;else demo=false;render();focusNode(node.querySelector('button'));},'hud-back'));
    if(dataState.phase!=='ready'){node.append(feedback(dataState,provider,onEnterDemo));return;}
    const profile=dataState.data.profile;if(!profile){node.append(el('p','','暂无示例资料'));return;}
    const identity=el('div','hud-profile-identity'),picture=el('div');avatar(picture,{avatar:{color:'blue'}},'demo-profile');identity.append(picture,el('strong','',profile.name));node.append(identity,el('p','',profile.bio));
    const facts=el('dl','hud-facts');for(const [label,value]of [['兴趣',profile.interests.join(' · ')],['公开身份',profile.identity],...(!publicView?[['最近访问',profile.lastVisit],['成员状态',profile.membership]]:[])])facts.append(el('dt','',label),el('dd','',value));node.append(facts);
    if(!publicView){node.append(el('h3','','阅读范围（示例）'),el('p','',profile.readingScope.join(' · ')),el('h3','','最近记录（示例）'));for(const record of profile.records){const row=el('div','hud-record');row.append(el('time','',record.time),el('span','',record.title));node.append(row);}node.append(el('p','hud-muted','暂未收到新报告（示例）'),button('公开资料',()=>{publicView=true;render();focusNode(node.querySelector('.hud-back'));}));}
    else node.append(el('p','hud-muted','这是同一示例的只读公开字段，不代表真实公开页面。'));
  }
  provider.subscribe(value=>{dataState=value;render();});return{node,activate(){},setContext(value){context=value;const next=contextKey(value);if(next!==key){key=next;demo=false;publicView=false;}render();},back(){if(publicView){publicView=false;render();focusNode([...node.querySelectorAll('button')].find(control=>control.textContent==='公开资料'));return true;}return false;}};
}
