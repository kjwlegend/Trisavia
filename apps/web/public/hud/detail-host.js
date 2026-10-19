import {el} from '../common.js';
import {icon} from './icons.js';
import {createPanelTransition} from './panel-transition.js';

// The mailbox owns one additional reader, not a stack of nested windows.
export function createDetailHost(root,underlay){
  const node=el('section','hud-window hud-detail-window');node.id='hud-detail-window';node.hidden=true;
  node.setAttribute('role','dialog');node.setAttribute('aria-modal','false');node.setAttribute('aria-labelledby','hud-detail-title');
  const header=el('div','hud-window-header'),title=el('h2'),closeButton=el('button');title.id='hud-detail-title';title.tabIndex=-1;
  closeButton.id='hud-detail-close';closeButton.type='button';closeButton.setAttribute('aria-label','关闭通知详情');closeButton.append(icon('close'));header.append(title,closeButton);
  const body=el('div','hud-window-body');body.id='hud-detail-body';body.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});node.append(header,body);root.append(node);
  const transition=createPanelTransition(node);let opened=false,onClose=null;
  function close(restore=true){
    if(!opened)return;opened=false;underlay.inert=false;underlay.style.pointerEvents='';underlay.removeAttribute('aria-hidden');
    transition.hide();const callback=onClose;onClose=null;callback?.(restore);
  }
  closeButton.addEventListener('click',()=>close());
  return{
    node,body,get isOpen(){return opened;},
    open(label,content,closed){opened=true;onClose=closed;title.textContent=label;body.replaceChildren(content);underlay.inert=true;underlay.style.pointerEvents='none';underlay.setAttribute('aria-hidden','true');transition.show();title.focus({preventScroll:true});},
    update(label,content){if(!opened)return;title.textContent=label;body.replaceChildren(content);},
    clear(){title.textContent='';body.replaceChildren();},
    focusTitle(){if(opened)title.focus({preventScroll:true});},close,
    destroy(){close(false);transition.destroy();},
  };
}
