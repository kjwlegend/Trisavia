import {illustration} from '../icons.js';
import {projectInventoryView} from '../view-model.js';
import {el,button,demoLabel,feedback,focusNode} from './shared.js';

export function createInventoryFeature(provider,onEnterDemo=()=>{},{store,context}={}){
  const node=el('section','hud-feature hud-inventory'),results=el('div','hud-inventory-grid-scroll'),details=el('section','hud-item-detail');
  node.id='hud-feature-inventory';results.id='hud-item-results';details.id='hud-item-detail';
  let local=store.snapshot(),source={phase:'idle'},demo=false,preview=false,revision=local.revision,scrollTimer=0,detailTimer=0,resultsLease=null,disposed=false;
  const view=()=>projectInventoryView(local,source);
  function rememberScroll(){clearTimeout(scrollTimer);clearTimeout(detailTimer);const lease=store.lease();store.inventory(lease,{scrollTop:results.scrollTop,detailScrollTop:details.scrollTop});}
  results.addEventListener('scroll',()=>{if(!demo||preview||source.phase!=='ready'||!resultsLease)return;clearTimeout(scrollTimer);const lease=resultsLease,top=results.scrollTop;scrollTimer=setTimeout(()=>store.inventory(lease,{scrollTop:top}),100);},{passive:true});
  details.addEventListener('scroll',()=>{if(!demo||preview||source.phase!=='ready'||!resultsLease)return;clearTimeout(detailTimer);const lease=resultsLease,top=details.scrollTop;detailTimer=setTimeout(()=>store.inventory(lease,{detailScrollTop:top}),100);},{passive:true});
  function restoreScroll(){results.scrollTop=local.state.inventory.scrollTop;details.scrollTop=local.state.inventory.detailScrollTop;}
  function focusItem(){focusNode([...results.querySelectorAll('[data-item-id]')].find(control=>control.dataset.itemId===view().selectedId));}
  function unavailable(){
    const current=context.snapshot();
    if(current.phase==='error')node.append(el('p','hud-feedback','演示内容暂不可用。'),button('重试演示内容',()=>context.load()));
    else node.append(el('p','hud-feedback',current.phase==='pending'?'请先确认当前账号状态，再查看演示。':'正在准备演示内容…'));
  }
  function renderResults(){
    const projection=view(),lease=store.lease();resultsLease=null;results.replaceChildren();details.replaceChildren();
    if(!projection.ready)return;
    if(projection.selectedId!==local.state.inventory.selectedId){clearTimeout(detailTimer);store.inventory(lease,{selectedId:projection.selectedId,detailScrollTop:0});}
    const grid=el('div','hud-items');grid.setAttribute('aria-label','示例物品');
    for(const item of projection.items){
      const control=button('',()=>{if(!store.isCurrent(lease))return;rememberScroll();store.inventory(lease,{selectedId:item.id,detailScrollTop:0});renderResults();restoreScroll();focusItem();});
      control.dataset.itemId=item.id;control.title=item.name;control.setAttribute('aria-label',item.name);control.setAttribute('aria-pressed',String(item.id===projection.selectedId));
      const slot=el('span','hud-item-slot');slot.append(illustration(item.art,Number(item.id.split('-')[1])));control.append(slot,el('span','hud-item-name',item.name),el('span','hud-item-full-name',item.name));grid.append(control);
    }
    if(!projection.items.length){results.append(el('p','hud-feedback','没有找到符合条件的物品'),button('清除筛选',()=>{if(store.inventory(lease,{category:'all',query:'',scrollTop:0})){render();focusNode(node.querySelector('#hud-item-search'));}}));return;}
    results.append(grid);resultsLease=lease;const item=projection.selected;
    details.append(illustration(item.art,Number(item.id.split('-')[1])),el('h3','',item.name),el('p','hud-item-category',item.category),el('p','',item.description));
    if(item.author)details.append(el('p','hud-muted',`作者声明：${item.author}`));if(item.source)details.append(el('p','hud-muted',`来源：${item.source}`));
    if(item.category==='作品'&&item.description)details.append(button('查看作品',()=>{if(!store.isCurrent(lease))return;rememberScroll();preview=true;render();focusNode(node.querySelector('.hud-back'));}));
  }
  function render(){
    if(disposed)return;
    node.replaceChildren();
    if(!demo){const lease=store.lease(),enter=button('查看演示背包',()=>{if(!store.isCurrent(lease))return;demo=true;render();onEnterDemo();provider.load();});enter.disabled=!local.scope;node.append(el('p','','此内容尚未接入。'),el('p','hud-muted','示例物品不代表当前账号或 Agent 的真实资产。'),enter);if(!local.scope)unavailable();return;}
    node.append(demoLabel('示例物品 · 非真实资产'));
    if(!local.scope){unavailable();return;}
    if(local.persistence==='memory')node.append(el('p','hud-muted','此浏览器暂时无法保存演示记录，本次更改只保留在当前页面。'));
    if(source.phase!=='ready'){node.append(feedback(source,provider,onEnterDemo));return;}
    const projection=view(),lease=store.lease();
    if(preview&&projection.selected){const item=projection.selected;node.append(button('返回背包详情',()=>{if(!store.isCurrent(lease))return;preview=false;render();restoreScroll();focusItem();},'hud-back'),el('h3','',item.name),illustration(item.art),el('p','',item.description),el('p','hud-muted','示例作品预览 · 作者声明不证明版权或交易权。'));return;}
    preview=false;
    const columns=el('div','hud-inventory-layout'),browser=el('div','hud-inventory-browser'),toolbar=el('div','hud-filters');
    for(const [category,label]of [['all','全部'],['artwork','作品'],['item','虚拟道具']]){
      const control=button(label,()=>{if(!store.isCurrent(lease))return;rememberScroll();if(!store.inventory(lease,{category,scrollTop:0}))return;render();focusNode(node.querySelector(`[data-filter="${category}"]`));});
      control.dataset.filter=category;control.setAttribute('aria-pressed',String(local.state.inventory.category===category));toolbar.append(control);
    }
    const searchLabel=el('label','hud-search','搜索示例物品'),search=el('input');search.type='search';search.id='hud-item-search';search.maxLength=100;search.value=local.state.inventory.query;
    search.addEventListener('input',()=>{if(!store.isCurrent(lease))return;rememberScroll();if(!store.inventory(lease,{query:search.value,scrollTop:0}))return;renderResults();results.scrollTop=0;details.scrollTop=local.state.inventory.detailScrollTop;});
    searchLabel.append(search);browser.append(toolbar,searchLabel,results);columns.append(browser,details);node.append(columns);renderResults();restoreScroll();
  }
  const stops=[store.subscribe(value=>{if(disposed)return;const changed=value.revision!==revision;local=value;if(changed){revision=value.revision;clearTimeout(scrollTimer);clearTimeout(detailTimer);resultsLease=null;demo=false;preview=false;results.replaceChildren();details.replaceChildren();render();}}),context.subscribe(()=>{if(!local.scope)render();}),provider.subscribe(value=>{source=value;render();})];
  return{node,activate(){if(demo&&!preview)restoreScroll();},deactivate(){if(demo&&!preview&&local.scope)rememberScroll();},setCompact(){},setContext(){},back(){if(!preview)return false;preview=false;render();restoreScroll();focusItem();return true;},dispose(){disposed=true;clearTimeout(scrollTimer);clearTimeout(detailTimer);for(const stop of stops)stop?.();}};
}
