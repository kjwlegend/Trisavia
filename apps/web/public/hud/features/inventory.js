import {illustration} from '../icons.js';
import {el,button,demoLabel,feedback,contextKey,focusNode} from './shared.js';

export function createInventoryFeature(provider){
  const node=el('section','hud-feature'),results=el('div');
  node.id='hud-feature-inventory';results.id='hud-item-results';
  let demo=false,key='',filter='全部',query='',selected='',detailOnly=false,preview=false,compact=false,state={phase:'idle'};
  const visibleItems=()=>state.data.items.filter(item=>(filter==='全部'||item.category===filter)&&item.name.includes(query));
  function selectVisible(items){if(!items.some(item=>item.id===selected))selected=items[0]?.id||'';return items.find(item=>item.id===selected);}
  function focusItem(){focusNode([...node.querySelectorAll('[data-item-id]')].find(control=>control.dataset.itemId===selected));}
  function returnToDetail(){preview=false;render();focusNode(node.querySelector('#hud-item-detail button'));}

  // Search updates only the results: keep the focused input and IME composition intact.
  function renderResults(){
    const items=visibleItems(),item=selectVisible(items),columns=el('div','hud-columns'),grid=el('div','hud-items');
    grid.setAttribute('aria-label','示例物品');grid.hidden=detailOnly;
    for(const entry of items){
      const control=button('',()=>{selected=entry.id;detailOnly=compact;renderResults();if(compact)focusNode(node.querySelector('#hud-item-detail button'));else focusItem();});
      control.dataset.itemId=entry.id;control.setAttribute('aria-pressed',String(entry.id===selected));
      const slot=el('span','hud-item-slot');slot.append(illustration(entry.art,Number(entry.id.split('-')[1])));
      control.append(slot,el('span','hud-item-name',entry.name));grid.append(control);
    }
    const details=el('section','hud-item-detail');details.id='hud-item-detail';details.hidden=!item||(compact&&!detailOnly);
    if(item){
      if(detailOnly)details.append(button('返回物品列表',()=>{detailOnly=false;renderResults();focusItem();},'hud-back'));
      details.append(el('h3','',item.name),illustration(item.art,Number(item.id.split('-')[1])),el('p','',`类别：${item.category}`),el('p','',`来源：${item.source}`),el('p','',`作者声明：${item.author}`),el('p','',item.description));
      if(item.category==='作品')details.append(button('查看作品',()=>{preview=true;render();focusNode(node.querySelector('.hud-back'));}));
    }
    if(!items.length)columns.append(el('p','hud-feedback','此筛选下暂无示例物品'));else columns.append(grid,details);
    results.replaceChildren(columns);
  }
  function render(){
    node.replaceChildren();
    if(!demo){node.append(el('p','','此内容尚未接入。'),el('p','hud-muted','尚无真实持有物来源，不显示资产数量或余额。'),button('查看演示背包',()=>{demo=true;render();provider.load();}));return;}
    node.append(demoLabel('演示数据 · 示例持有物，非当前账号或 Agent 的资产'));
    if(state.phase!=='ready'){node.append(feedback(state,provider));return;}
    const item=selectVisible(visibleItems());
    if(preview&&item){node.append(button('返回背包详情',returnToDetail,'hud-back'),el('h3','',item.name),illustration(item.art,Number(item.id.split('-')[1])),el('p','',item.description),el('p','hud-muted','示例作品预览 · 作者声明不证明版权或交易权。'));return;}
    preview=false;
    const toolbar=el('div','hud-filters');
    for(const text of ['全部','作品','虚拟道具']){
      const control=button(text,()=>{filter=text;detailOnly=false;render();focusNode([...node.querySelectorAll('[data-filter]')].find(control=>control.dataset.filter===text));});
      control.dataset.filter=text;control.setAttribute('aria-pressed',String(filter===text));toolbar.append(control);
    }
    const searchLabel=el('label','hud-search','搜索示例物品'),search=el('input');
    search.type='search';search.value=query;search.id='hud-item-search';
    search.addEventListener('input',()=>{query=search.value;detailOnly=false;renderResults();});
    searchLabel.append(search);node.append(toolbar,searchLabel,results);renderResults();
  }
  provider.subscribe(value=>{state=value;render();});
  return{
    node,activate(){},
    setCompact(value){if(compact!==value){compact=value;if(!compact)detailOnly=false;render();}},
    setContext(value){const next=contextKey(value);if(next!==key){key=next;demo=false;filter='全部';query='';selected='';detailOnly=false;preview=false;render();}},
    back(){if(preview){returnToDetail();return true;}if(detailOnly){detailOnly=false;renderResults();focusItem();return true;}return false;},
  };
}
