import {el} from '../../common.js';
export {el};
export function button(text,handler,className=''){const node=el('button',className,text);node.type='button';node.addEventListener('click',handler);return node;}
export function link(text,href){const node=el('a','hud-link',text);node.href=href;return node;}
export function demoLabel(text='演示数据 · 与当前账号和 Agent 的真实状态无关'){return el('p','hud-demo-label',text);}
export function feedback(state,provider){const box=el('div','hud-feedback');box.setAttribute('role','status');box.append(el('p','',state.phase==='error'?'演示内容暂不可用':'正在读取演示内容…'));if(state.phase==='error')box.append(button('重试演示内容',()=>provider.load()));return box;}
export function contextKey(state){return `${state.phase==='refreshing'?'ready':state.phase}:${state.username||''}:${state.selectedAgentId||''}`;}
export function selectedAgent(state){return state.agents?.find(agent=>agent.agentId===state.selectedAgentId);}

export function focusNode(node){if(!node)return;if(!node.matches('button,input,select,a,[tabindex]'))node.tabIndex=-1;node.focus({preventScroll:true});}
