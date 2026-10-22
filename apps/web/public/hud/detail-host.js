import {el} from '../common.js';
import {icon} from './icons.js';
import {createPanelTransition} from './panel-transition.js';
import {getPanelEnvironment} from './panel-environment.js';
import {nativeFrame} from '../world-pixel/native-ui.js';

// The mailbox owns one additional reader, not a stack of nested windows.
export function createDetailHost(root,underlay){
  const node=el('section','hud-window hud-detail-window');node.id='hud-detail-window';node.hidden=true;
  node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','hud-detail-title');
  const header=el('div','hud-window-header'),title=el('h2'),closeButton=el('button');title.id='hud-detail-title';title.tabIndex=-1;
  closeButton.id='hud-detail-close';closeButton.type='button';closeButton.setAttribute('aria-label','关闭详情');closeButton.append(icon('close'));header.append(title,closeButton);
  const footer=el('div','hud-reader-footer'),backButton=el('button','','返回信箱');backButton.type='button';footer.append(backButton);let backAction=null;backButton.addEventListener('click',()=>backAction?backAction():close());
  const body=el('div','hud-window-body');body.id='hud-detail-body';body.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});node.append(nativeFrame('lightWood'),header,body,footer);root.append(node);
  const transition=createPanelTransition(node),environment=getPanelEnvironment();let opened=false,onClose=null;
  function close(restore=true){
    if(!opened)return;opened=false;environment.set('detail',null);
    transition.hide();const callback=onClose;onClose=null;callback?.(restore);
  }
  closeButton.addEventListener('click',()=>close());
  return{
    node,body,get isOpen(){return opened;},
    open(label,content,closed){opened=true;onClose=closed;backAction=null;backButton.textContent='返回信箱';title.textContent=label;body.replaceChildren(content);environment.set('detail',node);transition.show();title.focus({preventScroll:true});},
    update(label,content){if(!opened)return;title.textContent=label;body.replaceChildren(content);},
    clear(){title.textContent='';body.replaceChildren();},
    setBack(label,action){backButton.textContent=label;backAction=action;},
    focusTitle(){if(opened)title.focus({preventScroll:true});},close,
    destroy(){close(false);transition.destroy();},
  };
}
