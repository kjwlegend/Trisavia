import {el,notice} from './common.js';

function extractBlock(markdown,origin,name){
  const site=new URL(origin);if(!['http:','https:'].includes(site.protocol)||site.origin!==origin)throw new Error('invalid_prompt');
  if(typeof markdown!=='string'||markdown.length>65536)throw new Error('invalid_prompt');
  const start=`<!-- connet:${name}:start -->`,end=`<!-- connet:${name}:end -->`,parts=markdown.split(start);if(parts.length!==2||parts[0].includes(end))throw new Error('invalid_prompt');
  const block=parts[1].split(end);if(block.length!==2)throw new Error('invalid_prompt');
  const template=block[0].trim();if(!template||template.length>8000||!template.includes('{{ORIGIN}}'))throw new Error('invalid_prompt');
  const text=template.replaceAll('{{ORIGIN}}',origin);if(/\{\{[^}]*\}\}/.test(text))throw new Error('invalid_prompt');return text;
}
export const extractOnboardingPrompt=(markdown,origin)=>extractBlock(markdown,origin,'copy-prompt');
export function extractRuntimeUpdatePrompt(markdown,origin){
  const site=new URL(origin);if(!['http:','https:'].includes(site.protocol)||site.origin!==origin)throw new Error('invalid_prompt');
  const text=extractBlock(markdown,origin,'runtime-update'),urls=[...text.matchAll(/https?:\/\/[^\s<>()（）\[\]`"'，。；、！？]+/g)].map(match=>match[0].replace(/[，。；、]+$/u,''));
  const allowed=new Set([origin+'/agent/runtime.md',origin+'/agent/entry.md']);
  if(!urls.includes(origin+'/agent/runtime.md')||urls.some(url=>!allowed.has(url))||/\/(?:owner|residents)(?:\b|[/?#])|\/v1\/(?:owner|agents)\b|\b(?:javascript|data|file):/i.test(text))throw new Error('invalid_prompt');return text;
}

// The same public document supplies independently validated joining/update sections.
const states={onboarding:{phase:'idle',text:''},runtime:{phase:'idle',text:''}},subscribers={onboarding:new Set(),runtime:new Set()};let inFlight=null;
function publish(kind,value){states[kind]=value;for(const subscriber of subscribers[kind])subscriber();}
async function load(){
  if(inFlight)return inFlight;
  for(const kind of Object.keys(states))publish(kind,{phase:'loading',text:''});
  inFlight=(async()=>{
    try{
      const response=await fetch('/agent/prompt.md',{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('prompt_unavailable');const markdown=await response.text();
      for(const[kind,extract]of [['onboarding',extractOnboardingPrompt],['runtime',extractRuntimeUpdatePrompt]]){try{publish(kind,{phase:'ready',text:extract(markdown,location.origin)});}catch{publish(kind,{phase:'error',text:''});}}
    }catch{for(const kind of Object.keys(states))publish(kind,{phase:'error',text:''});}
    finally{inFlight=null;}
  })();return inFlight;
}
// Owner invitation copy uses the same approved public registration block.
// A failed source never falls back to an obsolete, separately generated prompt.
export async function readOnboardingPrompt(){if(states.onboarding.phase!=='ready')await load();if(states.onboarding.phase!=='ready'||!states.onboarding.text)throw new Error('prompt_unavailable');return states.onboarding.text;}
function bindPrompt(kind,{text,copy,retry,status}){
  const runtime=kind==='runtime';
  function sync(){const state=states[kind];copy.disabled=state.phase!=='ready';retry.hidden=!runtime&&state.phase==='ready';retry.disabled=state.phase==='loading';if(runtime)retry.textContent=state.phase==='ready'?'重新读取提示':'重试加载提示';}
  function render(){const state=states[kind];if(text.textContent!==state.text)text.textContent=state.text;notice(status,state.phase==='error'?(runtime?'更新提示暂时无法加载。请重试或阅读参与规则。':'接入提示暂时无法加载。你可以阅读接入说明，或重试。'):state.phase==='loading'?(runtime?'正在加载更新提示…':'正在加载接入提示…'):'',state.phase==='error'?'error':'');sync();}
  async function copied(){const state=states[kind];if(state.phase!=='ready'||!state.text)return;
    try{await navigator.clipboard.writeText(state.text);if(states[kind]!==state)return;notice(status,runtime?'提示词已复制，请交给你自己的 Agent。':'已复制。把这段提示交给你的 Agent 即可。','success');}
    catch{if(states[kind]!==state)return;if(runtime){text.closest('details')?.setAttribute('open','');text.focus({preventScroll:true});}notice(status,runtime?'浏览器未允许复制。请选中下方提示手动复制。':'浏览器未允许复制。请选中上方短提示手动复制。','error');}
  }
  const retryRead=()=>void load();copy.addEventListener('click',copied);retry.addEventListener('click',retryRead);subscribers[kind].add(render);render();if(states[kind].phase==='idle')void load();
  return{sync,dispose(){subscribers[kind].delete(render);copy.removeEventListener('click',copied);retry.removeEventListener('click',retryRead);}};
}
export const bindOnboardingPrompt=options=>bindPrompt('onboarding',options);
export function createRuntimeUpdatePrompt(prefix){
  const node=el('section','manager-soft runtime-update-prompt'),controls=el('div','button-row'),copy=el('button','', '复制更新提示'),retry=el('button','text-button','重试加载提示'),link=el('a','button','阅读参与规则'),status=el('p','notice'),preview=el('details','entry-prompt-details'),text=el('pre','prompt');node.id=prefix;copy.id=prefix+'-copy';retry.id=prefix+'-retry';text.id=prefix+'-text';status.id=prefix+'-status';copy.type=retry.type='button';link.href='/agent/runtime.md';status.setAttribute('role','status');text.tabIndex=0;text.setAttribute('aria-label','更新参与规则提示');preview.append(el('summary','','查看或手动复制提示'),text);controls.append(copy,link,retry);node.append(el('h3','','更新参与规则'),el('p','small-text','把提示交给你自己的 Agent。网页只提供指引，不会更新本地任务。'),controls,status,preview);const binding=bindPrompt('runtime',{text,copy,retry,status});return{node,...binding};
}
