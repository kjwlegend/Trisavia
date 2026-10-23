import {createBehaviorLogReader} from './behavior-log-reader.js';
import {createBehaviorLogView} from './behavior-log-view.js';
export function createWorldLogFeature(session){
 const reader=createBehaviorLogReader({mode:'world',session}),view=createBehaviorLogView(reader,{mode:'world'});view.node.id='hud-feature-logs';
 return{node:view.node,activate:()=>reader.setActive(true),deactivate:()=>reader.setActive(false),setContext(){},back:()=>view.back(),dispose(){view.dispose();reader.dispose();}};
}
export function mountOwnerBehaviorLogs(node,session){
 const reader=createBehaviorLogReader({mode:'owner',session}),view=createBehaviorLogView(reader,{mode:'owner',chooseAgent:()=>document.dispatchEvent(new Event('hud:choose-agent'))});node.append(view.node);
 const sync=()=>reader.setActive(!document.hidden&&!node.closest('[hidden],[data-panel-state="closing"],[data-panel-state="closed"]')&&node.getClientRects().length>0),observer=new MutationObserver(sync);observer.observe(document.querySelector('#hud-root')||node.parentNode,{subtree:true,attributes:true,attributeFilter:['hidden','class','style','data-panel-state']});sync();
 return{dispose(){observer.disconnect();view.dispose();reader.dispose();}};
}
