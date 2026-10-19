import {notice} from './common.js';

const start='<!-- connet:copy-prompt:start -->',end='<!-- connet:copy-prompt:end -->';
export function extractOnboardingPrompt(markdown,origin){
  if(typeof markdown!=='string'||markdown.length>65536)throw new Error('invalid_prompt');
  const parts=markdown.split(start);if(parts.length!==2||parts[0].includes(end))throw new Error('invalid_prompt');
  const block=parts[1].split(end);if(block.length!==2)throw new Error('invalid_prompt');
  const template=block[0].trim();if(!template||template.length>8000||!template.includes('{{ORIGIN}}'))throw new Error('invalid_prompt');
  const text=template.replaceAll('{{ORIGIN}}',origin);if(/\{\{[^}]*\}\}/.test(text))throw new Error('invalid_prompt');return text;
}

// Both visible entry points consume this one same-origin, public text source.
let state={phase:'idle',text:''},inFlight=null;
const subscribers=new Set();
function publish(value){state=value;for(const subscriber of subscribers)subscriber();}
async function load(){
  if(inFlight)return inFlight;
  publish({phase:'loading',text:''});
  inFlight=(async()=>{
    try{
      const response=await fetch('/agent/prompt.md',{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('prompt_unavailable');
      const text=extractOnboardingPrompt(await response.text(),location.origin);publish({phase:'ready',text});
    }catch{publish({phase:'error',text:''});}
    finally{inFlight=null;}
  })();
  return inFlight;
}
export function bindOnboardingPrompt({text,copy,retry,status}){
  function sync(){copy.disabled=state.phase!=='ready';retry.hidden=state.phase==='ready';retry.disabled=state.phase==='loading';}
  function render(){
    if(text.textContent!==state.text)text.textContent=state.text;
    notice(status,state.phase==='error'?'接入提示暂时无法加载。你可以阅读接入说明，或重试。':state.phase==='loading'?'正在加载接入提示…':'',state.phase==='error'?'error':'');sync();
  }
  copy.addEventListener('click',async()=>{
    if(state.phase!=='ready'||!state.text)return;
    try{await navigator.clipboard.writeText(state.text);notice(status,'已复制。把这段提示交给你的 Agent 即可。','success');}
    catch{notice(status,'浏览器未允许复制。请选中上方短提示手动复制。','error');}
  });
  retry.addEventListener('click',()=>void load());subscribers.add(render);render();
  if(state.phase==='idle')void load();
  return{sync};
}
