import {icon,illustration} from '../icons.js';
import {el,button,demoLabel,feedback,contextKey,focusNode} from './shared.js';
export function createMailFeature(provider){const node=el('section','hud-feature');node.id='hud-feature-mail';let key='',demo=false,tab='private',filter='全部通知',selected={private:'',world:''},detailOnly=false,sourcePreview=null,compact=false,state={phase:'idle'};
  function focusMessage(){focusNode([...node.querySelectorAll('[data-message-id]')].find(control=>control.dataset.messageId===selected[tab]));}
  function render(){node.replaceChildren();
    if(!demo){node.append(el('p','','此内容尚未接入。'),el('p','hud-muted','尚未接入真实通知，也未确认私人消息阅读范围。'),button('查看演示信箱',()=>{demo=true;render();provider.load();}));return;}
    node.append(demoLabel('演示数据 · 示例阅读者，不是当前账号的消息'),el('p','hud-muted','示例阅读者：lin · 获准通知摘要（演示）'));
    if(state.phase!=='ready'){node.append(feedback(state,provider));return;}
    if(sourcePreview){node.append(button('返回信箱详情',()=>{sourcePreview=null;render();focusNode(node.querySelector('#hud-mail-detail button'));},'hud-back'),el('h3','',sourcePreview.name),illustration(sourcePreview.art),el('p','',sourcePreview.description),el('p','hud-muted','来源详情为同一夹具的演示内容。'));return;}
    const toolbar=el('div','hud-filters');for(const [value,label]of [['private','私人通知'],['world','世界动态（公开）']]){const control=button(label,()=>{tab=value;detailOnly=false;render();focusNode([...node.querySelectorAll('[data-tab]')].find(control=>control.dataset.tab===value));});control.dataset.tab=value;control.setAttribute('aria-pressed',String(tab===value));toolbar.append(control);}node.append(toolbar);
    if(tab==='private'){const label=el('label','hud-filter-label','通知筛选'),select=el('select');select.setAttribute('aria-label','通知筛选');for(const text of ['全部通知','待处理']){const option=el('option','',text);option.value=text;option.selected=filter===text;select.append(option);}select.addEventListener('change',()=>{filter=select.value;detailOnly=false;render();focusNode(node.querySelector('select'));});label.append(select);node.append(label);}
    const messages=tab==='private'?state.data.messages.filter(message=>filter==='全部通知'||message.status==='待处理'&&message.available):state.data.announcements;
    if(!messages.some(message=>message.id===selected[tab]))selected[tab]=messages[0]?.id||'';
    const message=messages.find(message=>message.id===selected[tab]);const columns=el('div','hud-columns'),list=el('div','hud-messages');list.setAttribute('aria-label',tab==='private'?'示例私人通知':'示例公共公告');list.hidden=detailOnly;
    for(const entry of messages){const control=button('',()=>{selected[tab]=entry.id;detailOnly=compact;render();if(compact)focusNode(node.querySelector('#hud-mail-detail button')||node.querySelector('#hud-mail-detail h3'));else focusMessage();});control.dataset.messageId=entry.id;control.setAttribute('aria-pressed',String(entry.id===selected[tab]));const text=el('span');text.append(el('strong','',entry.source),el('span','',entry.title));control.append(icon(entry.source==='资料服务'?'document':'notice'),text,el('time','',entry.time));list.append(control);}
    const details=el('section','hud-mail-detail');details.id='hud-mail-detail';details.hidden=!message||(compact&&!detailOnly);
    if(message){if(detailOnly)details.append(button('返回通知列表',()=>{detailOnly=false;render();focusMessage();},'hud-back'));details.append(el('h3','',message.available?message.title:'此示例内容不可查看'));
      if(message.available){details.append(el('p','',`来源：${message.source} · 示例时刻 ${message.time}`),el('p','',message.body),el('p','hud-muted',message.status));const source=state.data.items.find(item=>item.id===message.sourceItemId);if(source)details.append(button('查看内容',()=>{sourcePreview=source;render();focusNode(node.querySelector('.hud-back'));}));}
      else details.append(el('p','hud-muted','正文、图像及来源动作当前不可用。返回列表可选择其他示例。'));
    }
    if(!messages.length)columns.append(el('p','hud-feedback','此筛选下暂无示例通知'));else columns.append(list,details);node.append(columns);
  }
  provider.subscribe(value=>{state=value;render();});return{node,activate(){},setCompact(value){if(compact!==value){compact=value;if(!compact)detailOnly=false;render();}},setContext(value){const next=contextKey(value);if(next!==key){key=next;demo=false;tab='private';filter='全部通知';selected={private:'',world:''};detailOnly=false;sourcePreview=null;render();}},back(){if(sourcePreview){sourcePreview=null;render();focusNode(node.querySelector('#hud-mail-detail button'));return true;}if(detailOnly){detailOnly=false;render();focusMessage();return true;}return false;}};
}
