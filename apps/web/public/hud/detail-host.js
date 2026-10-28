import {el} from '../common.js';
import {icon} from './icons.js';
import {createPanelTransition} from './panel-transition.js';
import {getPanelEnvironment} from './panel-environment.js';
import {msg,isMessage,bindText,bindAttribute,clearBinding} from '../i18n/core.js';
const put=(node,value)=>{clearBinding(node);if(isMessage(value))bindText(node,value.key,value.params);else node.textContent=value??'';};

// The mailbox owns one additional reader, not a stack of nested windows.
export function createDetailHost(root,underlay){
  const node=el('section','hud-window hud-detail-window');node.id='hud-detail-window';node.hidden=true;
  node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','hud-detail-title');
  const header=el('div','hud-window-header'),title=el('h2'),closeButton=el('button');title.id='hud-detail-title';title.tabIndex=-1;
  closeButton.id='hud-detail-close';closeButton.type='button';bindAttribute(closeButton,'aria-label','common:action.close');closeButton.append(icon('close'));header.append(title,closeButton);
  const footer=el('div','hud-reader-footer'),backButton=el('button','paper-reader-back',msg('common:action.back'));footer.hidden=true;backButton.type='button';header.prepend(backButton);title.remove();let backAction=null;backButton.addEventListener('click',()=>backAction?backAction():close());
  const body=el('div','hud-window-body');body.id='hud-detail-body';body.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});node.append(header,body,footer);root.append(node);
  const transition=createPanelTransition(node),environment=getPanelEnvironment();let opened=false,onClose=null,fullTitle=null,titleValue='';
  function syncFullTitle(){
    if(!opened)return;
    // Keep the fixed header compact while making every clipped title readable.
    const clipped=title.clientHeight>0&&title.scrollHeight>title.clientHeight+1;
    if(!clipped){fullTitle?.remove();fullTitle=null;return;}
    if(!fullTitle||fullTitle.parentNode!==body){fullTitle=el('h3','hud-reader-full-title');body.prepend(fullTitle);}
    put(fullTitle,titleValue);
  }
  const titleObserver=new ResizeObserver(syncFullTitle);titleObserver.observe(title);
  function close(restore=true){
    if(!opened)return;opened=false;environment.set('detail',null);
    transition.hide();const callback=onClose;onClose=null;callback?.(restore);
  }
  closeButton.addEventListener('click',()=>close());
  return{
    node,body,get isOpen(){return opened;},
    open(label,content,closed){opened=true;onClose=closed;backAction=null;footer.hidden=true;footer.replaceChildren();put(backButton,msg('common:action.back'));titleValue=label;put(title,label);body.replaceChildren(title,content);body.scrollTop=0;environment.set('detail',node);transition.show();syncFullTitle();title.focus({preventScroll:true});},
    update(label,content){if(!opened)return;titleValue=label;put(title,label);body.replaceChildren(title,content);syncFullTitle();},
    clear(){titleValue='';put(title,'');body.replaceChildren();footer.replaceChildren();footer.hidden=true;fullTitle=null;},
    setBack(label,action){put(backButton,label);backAction=action;},
    setActions(content){footer.replaceChildren(content);footer.hidden=!content?.childNodes.length;},
    focusTitle(){if(opened)title.focus({preventScroll:true});},close,
    destroy(){close(false);titleObserver.disconnect();transition.destroy();},
  };
}
