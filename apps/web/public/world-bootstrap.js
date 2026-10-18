import {createOwnerEntryStore} from './owner-entry.js';
const entryStore=createOwnerEntryStore();
function startupError(text){const message=document.createElement('p');message.className='notice error world-startup-error';message.setAttribute('role','alert');message.textContent=text;document.querySelector('#main').prepend(message);}
let intent;
try{intent=entryStore.capture();}
catch{startupError('暂时无法安全保存本次入口。请允许本标签页使用会话存储后重新载入；当前入口尚未被处理。');}
if(intent){
  try{const {boot}=await import('./home.js');await boot({entryStore,intent});}
  catch{startupError('世界界面暂未能完整打开。原入口和私密进度仍保留，请重新载入后继续确认。');}
}
