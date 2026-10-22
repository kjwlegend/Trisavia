import {el} from '../common.js';
import {APPEARANCE_VERSION,lookFor,resolveLook,drawLook,drawLookPlaceholder} from './look.js';
import {loadLookAssets} from './look-assets.js';
import {createLookCatalogue} from './look-catalogue.js';
import {createLookStage} from './look-stage.js';
import {nativeFrame,selectionCorners} from './native-ui.js';
export function createAppearancePicker(form,{changed=()=>{},isDirty=()=>false}={}){
  const input=el('input');input.type='hidden';input.id='appearance-look-id';const version=el('input');version.type='hidden';version.id='appearance-catalog-version';
  const layout=el('div','character-layout selection-layout'),stage=createLookStage(),editor=el('div','character-editor'),heading=el('div','selection-heading'),grid=el('div','look-grid'),summary=el('p','choice-summary'),message=el('div','look-catalogue-message');heading.append(el('h3','','选择你的角色'));grid.setAttribute('role','group');grid.setAttribute('aria-label','选择角色');editor.append(heading,message,grid,summary);layout.append(stage.node,editor);form.prepend(input,version,layout);
  const catalogue=createLookCatalogue();let agent=null,editable=false,active=false,assets=null,disposed=false,assetError=false;
  function selected(){return input.value?{lookId:input.value,catalogVersion:version.value}:null;}
  function saved(){return agent?.profile?.publishedAppearance??agent?.profile?.published?.avatar??null;}
  function render(){
    if(disposed)return;const focused=document.activeElement?.closest('[data-look-id]')?.dataset.lookId;const current=selected(),chosen=resolveLook(current),confirmed=resolveLook(saved()),data=catalogue.snapshot();
    stage.update(current||saved(),{displayName:agent?.profile?.published?.displayName||'',isDirty:isDirty()});grid.replaceChildren();message.replaceChildren();
    if(data.phase==='loading')message.append(el('p','','正在读取可选角色…'));
    if(data.phase==='error'){message.append(el('p','','暂时无法读取可选角色。当前选择已保留。'));const retry=el('button','','重试角色目录');retry.type='button';retry.addEventListener('click',()=>void catalogue.load());message.append(retry);}
    if(assetError){const retry=el('button','','重试形象显示');retry.type='button';retry.addEventListener('click',()=>{assetError=false;void load();});message.append(el('p','','形象素材暂时无法显示，选择已保留。'),retry);}
    const entries=data.phase==='ready'?data.data.looks:[];
    for(const [index,item]of entries.entries()){
      const art=lookFor(item.lookId),button=el('button','look-option'),picture=el('span','look-portrait'),canvas=el('canvas'),label=el('span','look-label',item.displayName);button.type='button';button.dataset.lookId=item.lookId;button.setAttribute('aria-label',item.displayName);button.setAttribute('aria-pressed',String(current?.lookId===item.lookId));button.disabled=!editable||!item.selectable;
      canvas.width=288;canvas.height=192;canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');if(assets)drawLook(ctx,art,assets.images,{x:144,y:124,scale:3,still:true});else drawLookPlaceholder(ctx,{x:144,y:124,scale:3});picture.append(canvas);button.append(nativeFrame('darkWood'),el('span','look-number',String(index+1).padStart(2,'0')),picture,label);
      if(current?.lookId===item.lookId)button.append(selectionCorners(),el('span','look-selected-marker','✓'));
      if(confirmed?.key===item.lookId)button.append(el('span','look-saved-label','已保存'));
      button.addEventListener('click',()=>{if(!editable||!item.selectable||catalogue.snapshot().phase!=='ready')return;input.value=item.lookId;version.value=data.data.catalogVersion;input.dispatchEvent(new Event('change',{bubbles:true}));render();});grid.append(button);
    }
    if(focused)grid.querySelector(`[data-look-id="${focused}"]`)?.focus({preventScroll:true});
    summary.replaceChildren(el('span','','当前已保存'),el('strong','',confirmed?.label||'暂无法显示'));if(isDirty())summary.append(el('span','','正在预览'),el('strong','',chosen?.label||'暂无法显示'));
  }
  async function load(){try{assets=await loadLookAssets();assetError=false;}catch{assetError=true;}if(!disposed)render();}
  const stop=catalogue.subscribe(()=>{render();changed();});
  return{stage,node:layout,selection(){const value=selected(),catalog=catalogue.snapshot();return catalog.phase==='ready'&&catalog.data.catalogVersion===value?.catalogVersion&&catalog.data.looks.some(look=>look.lookId===value.lookId&&look.selectable)?value:null;},reset(value){agent=value;const appearance=saved();input.value=typeof appearance?.lookId==='string'?appearance.lookId:'';version.value=typeof appearance?.catalogVersion==='string'?appearance.catalogVersion:APPEARANCE_VERSION;render();},agent(value){agent=value;render();},refresh:render,editable(value){if(editable!==value){editable=value;render();}else for(const button of grid.querySelectorAll('button'))button.disabled=!editable||!catalogue.snapshot().data?.looks.some(item=>item.lookId===button.dataset.lookId&&item.selectable);},active(value){if(active===value)return;active=value;stage.active(value);if(value){void catalogue.load();if(!assets&&!assetError)void load();}else catalogue.cancel();},dispose(){disposed=true;stop();catalogue.dispose();stage.dispose();}};
}
