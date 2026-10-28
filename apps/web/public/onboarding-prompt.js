import {activateAccountI18n,accountNotice as notice,accountElement as el,accountMessage,accountText,accountAttribute} from './owner-i18n.js';

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
  function sync(){void activateAccountI18n(copy);const state=states[kind];copy.disabled=state.phase!=='ready';retry.hidden=!runtime&&state.phase==='ready';retry.disabled=state.phase==='loading';if(runtime)accountText(retry,()=>(state.phase==='ready'?accountMessage("entry.reloadPrompt"):accountMessage("entry.retryPrompt")));}
  function render(){const state=states[kind];if(text.textContent!==state.text)accountText(text,()=>(state.text));notice(status,state.phase==='error'?(runtime?accountMessage("entry.updateUnavailable"):accountMessage("entry.joinUnavailable")):state.phase==='loading'?(runtime?accountMessage("entry.updateLoading"):accountMessage("entry.joinLoading")):'',state.phase==='error'?'error':'');sync();}
  async function copied(){const state=states[kind];if(state.phase!=='ready'||!state.text)return;
    try{await navigator.clipboard.writeText(state.text);if(states[kind]!==state)return;notice(status,runtime?accountMessage("entry.promptCopied"):accountMessage("entry.copyComplete"),'success');}
    catch{if(states[kind]!==state)return;if(runtime){text.closest('details')?.setAttribute('open','');text.focus({preventScroll:true});}notice(status,runtime?accountMessage("entry.copyBelow"):accountMessage("entry.copyAbove"),'error');}
  }
  const retryRead=()=>void load();copy.addEventListener('click',copied);retry.addEventListener('click',retryRead);subscribers[kind].add(render);render();if(states[kind].phase==='idle')void load();
  return{sync,dispose(){subscribers[kind].delete(render);copy.removeEventListener('click',copied);retry.removeEventListener('click',retryRead);}};
}
export const bindOnboardingPrompt=options=>bindPrompt('onboarding',options);
export function createRuntimeUpdatePrompt(prefix){
  const node=el('section','manager-soft runtime-update-prompt'),controls=el('div','button-row'),copy=el('button','', accountMessage("entry.copyUpdate")),retry=el('button','text-button',accountMessage("entry.retryPrompt")),link=el('a','button',accountMessage("entry.readRules")),status=el('p','notice'),preview=el('details','entry-prompt-details'),text=el('pre','prompt');node.id=prefix;copy.id=prefix+'-copy';retry.id=prefix+'-retry';text.id=prefix+'-text';status.id=prefix+'-status';copy.type=retry.type='button';link.href='/agent/runtime.md';status.setAttribute('role','status');text.tabIndex=0;accountAttribute(text,'aria-label',()=>(accountMessage("entry.updatePromptAria")));preview.append(el('summary','',accountMessage("entry.viewOrCopy")),text);controls.append(copy,link,retry);node.append(el('h3','',accountMessage("entry.updateRulesTitle")),el('p','small-text',accountMessage("entry.updateRulesHint")),controls,status,preview);const binding=bindPrompt('runtime',{text,copy,retry,status});return{node,...binding};
}
