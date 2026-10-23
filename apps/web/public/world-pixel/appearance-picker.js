import {el} from '../common.js';
import {icon} from '../hud/icons.js';
import {APPEARANCE_VERSION,resolveLook,drawLook,drawLookPlaceholder} from './look.js';
import {loadLookAssets} from './look-assets.js';
import {createLookCatalogue} from './look-catalogue.js';
import {createLookStage} from './look-stage.js';
import {paletteOptions,appearanceColors} from './appearance-palette.js';

export function createAppearancePicker(form,{changed=()=>{},isDirty=()=>false}={}){
  const input=el('input');input.type='hidden';input.id='appearance-look-id';
  const version=el('input');version.type='hidden';version.id='appearance-catalog-version';
  const hairInput=el('input');hairInput.type='hidden';hairInput.id='appearance-hair-color';hairInput.value='original';const clothingInput=el('input');clothingInput.type='hidden';clothingInput.id='appearance-clothing-color';clothingInput.value='original';
  const layout=el('div','character-layout selection-layout'),stage=createLookStage(),editor=el('div','character-editor');
  const tabs=el('nav','appearance-attribute-tabs');tabs.setAttribute('aria-label','形象属性');
  const panel=el('div','appearance-properties'),message=el('div','look-catalogue-message'),grid=el('div','look-grid'),summary=el('p','choice-summary');
  const base=el('section','appearance-base-section'),hair=el('section','appearance-hair-section'),hairColor=el('section','appearance-color-group'),clothing=el('section','appearance-color-group');
  const baseTitle=el('h3','','基础形象');base.append(baseTitle,el('p','','居民 · 当前支持的基础形象。'));const basePreview=el('div','appearance-base-preview');base.append(basePreview);
  grid.setAttribute('role','group');grid.setAttribute('aria-label','选择发型');hair.append(grid);
  const colorGroups=new Map();for(const [kind,label,node]of [['hair','发色',hairColor],['clothing','服装配色',clothing]]){const options=el('div','appearance-color-options');options.setAttribute('role','group');options.setAttribute('aria-label',label);node.append(el('strong','',label),options);colorGroups.set(kind,options);}
  panel.append(base,hair,hairColor,clothing);editor.append(tabs,message,panel);layout.append(stage.node,editor);form.prepend(input,version,hairInput,clothingInput,layout,summary);
  const catalogue=createLookCatalogue();let agent=null,editable=false,active=false,assets=null,disposed=false,assetError=false,attribute='hair';
  const attributeTabs=new Map();
  for(const [key,label]of [['base','基础形象'],['hair','发型'],['hairColor','发色'],['clothing','服装配色']]){
    const button=el('button','',label);button.type='button';button.dataset.appearanceAttribute=key;button.setAttribute('aria-pressed',String(key===attribute));button.addEventListener('click',()=>{attribute=key;showAttribute();});tabs.append(button);attributeTabs.set(key,button);
  }
  function showAttribute(){
    base.hidden=attribute!=='base';hair.hidden=attribute!=='hair';hairColor.hidden=!['hair','hairColor'].includes(attribute);clothing.hidden=!['hair','clothing'].includes(attribute);
    for(const [key,button]of attributeTabs){button.setAttribute('aria-pressed',String(key===attribute));button.setAttribute('aria-selected',String(key===attribute));}
  }
  function selected(){return input.value?{lookId:input.value,catalogVersion:version.value,...(hairInput.value!=='original'?{hairColorId:hairInput.value}:{}),...(clothingInput.value!=='original'?{clothingColorId:clothingInput.value}:{})}:null;}
  const colorsReady=data=>data?.colorCustomization?.version===1;
  function selectionLabel(value){const look=resolveLook(value),colors=appearanceColors(value);return look?[look.label,...['hair','clothing'].map(kind=>(paletteOptions(kind).find(option=>option.id===colors[kind==='hair'?'hairColorId':'clothingColorId'])?.displayName||'原色')+(kind==='hair'?'发色':'服装'))].join(' · '):'暂无法显示';}
  function saved(){return agent?.profile?.publishedAppearance??agent?.profile?.published?.avatar??null;}
  function render(){
    if(disposed)return;
    const focused=document.activeElement?.closest('[data-look-id]')?.dataset.lookId,focusedColor=document.activeElement?.closest('[data-appearance-color-id]')?.dataset,current=selected(),chosen=resolveLook(current),confirmed=resolveLook(saved()),data=catalogue.snapshot();
    basePreview.replaceChildren();const baseCanvas=el('canvas');baseCanvas.width=288;baseCanvas.height=192;baseCanvas.setAttribute('aria-label','当前居民基础形象');if(assets&&chosen)drawLook(baseCanvas.getContext('2d'),chosen,assets.images,{x:144,y:124,scale:3,still:true});basePreview.append(baseCanvas);
    stage.update(current||saved(),{displayName:agent?.profile?.published?.displayName||'',isDirty:isDirty()});grid.replaceChildren();message.replaceChildren();
    if(data.phase==='loading')message.append(el('p','','正在读取可选形象…'));
    if(data.phase==='error'){
      message.append(el('p','','暂时无法读取形象目录。当前选择已保留。'));const retry=el('button','','重试形象目录');retry.type='button';retry.addEventListener('click',()=>void catalogue.load());message.append(retry);
    }
    if(assetError){const retry=el('button','','重试形象显示');retry.type='button';retry.addEventListener('click',()=>{assetError=false;void load();});message.append(el('p','','形象素材暂时无法显示，选择已保留。'),retry);}
    const entries=data.phase==='ready'?data.data.looks:[];
    for(const item of entries){
      const art=resolveLook({...current,lookId:item.lookId,catalogVersion:data.data.catalogVersion}),button=el('button','look-option'),picture=el('span','look-portrait'),canvas=el('canvas');
      button.type='button';button.dataset.lookId=item.lookId;button.setAttribute('aria-label',item.displayName);button.setAttribute('aria-pressed',String(current?.lookId===item.lookId));button.disabled=!editable||!item.selectable;
      canvas.width=288;canvas.height=192;canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');
      if(assets)drawLook(ctx,art,assets.images,{x:144,y:124,scale:3,still:true});else drawLookPlaceholder(ctx,{x:144,y:124,scale:3});
      picture.append(canvas);button.append(picture,el('span','look-label',item.displayName));
      if(current?.lookId===item.lookId)button.append(el('span','look-selected-marker','✓'));
      if(confirmed?.key===item.lookId)button.dataset.saved='true';
      button.addEventListener('click',()=>{if(!editable||!item.selectable||catalogue.snapshot().phase!=='ready')return;input.value=item.lookId;version.value=data.data.catalogVersion;input.dispatchEvent(new Event('change',{bubbles:true}));render();});grid.append(button);
    }
    if(focused)grid.querySelector(`[data-look-id="${focused}"]`)?.focus({preventScroll:true});
    for(const [kind,node]of colorGroups){
      node.replaceChildren();const field=kind==='hair'?hairInput:clothingInput;
      for(const option of paletteOptions(kind)){const button=el('button','appearance-color-option');button.type='button';button.dataset.appearanceColorKind=kind;button.dataset.appearanceColorId=option.id;button.style.setProperty('--swatch',option.swatch);button.setAttribute('aria-label',`${kind==='hair'?'发色':'服装配色'}：${option.displayName}`);button.title=option.displayName;if(kind==='clothing'){button.classList.add('appearance-clothing-option');button.append(icon('appearance'),el('span','',option.displayName));}button.setAttribute('aria-pressed',String(field.value===option.id));button.disabled=!editable||data.phase!=='ready'||!colorsReady(data.data);button.addEventListener('click',()=>{if(button.disabled||catalogue.snapshot().phase!=='ready'||!colorsReady(catalogue.snapshot().data))return;field.value=option.id;field.dispatchEvent(new Event('change',{bubbles:true}));render();});node.append(button);}
    }
    if(focusedColor)panel.querySelector(`[data-appearance-color-kind="${focusedColor.appearanceColorKind}"][data-appearance-color-id="${focusedColor.appearanceColorId}"]`)?.focus({preventScroll:true});
    if(data.phase==='ready'&&!colorsReady(data.data))message.append(el('p','','当前服务尚未提供配色选项，已保存配色保持不变。'));
    summary.replaceChildren(el('span','','已保存：'),el('strong','',selectionLabel(saved())),el('span','','当前预览：'),el('strong','',selectionLabel(current)));
    summary.dataset.dirty=String(isDirty());showAttribute();
  }
  async function load(){try{assets=await loadLookAssets();assetError=false;}catch{assetError=true;}if(!disposed)render();}
  const stop=catalogue.subscribe(()=>{render();changed();});
  return{
    stage,node:layout,
    selection(){const value=selected(),catalog=catalogue.snapshot();if(catalog.phase!=='ready'||catalog.data.catalogVersion!==value?.catalogVersion||!catalog.data.looks.some(look=>look.lookId===value.lookId&&look.selectable))return null;if(!colorsReady(catalog.data)&&(value.hairColorId!==undefined||value.clothingColorId!==undefined))return null;return value;},
    reset(value){agent=value;const appearance=saved(),colors=appearanceColors(appearance);hairInput.value=colors.hairColorId;clothingInput.value=colors.clothingColorId;input.value=typeof appearance?.lookId==='string'?appearance.lookId:'';version.value=typeof appearance?.catalogVersion==='string'?appearance.catalogVersion:APPEARANCE_VERSION;render();},
    agent(value){agent=value;render();},refresh:render,
    editable(value){if(editable!==value){editable=value;render();}else{for(const button of grid.querySelectorAll('button'))button.disabled=!editable||!catalogue.snapshot().data?.looks.some(item=>item.lookId===button.dataset.lookId&&item.selectable);for(const button of panel.querySelectorAll('[data-appearance-color-id]'))button.disabled=!editable||catalogue.snapshot().phase!=='ready'||!colorsReady(catalogue.snapshot().data);}},
    active(value){if(active===value)return;active=value;stage.active(value);if(value){void catalogue.load();if(!assets&&!assetError)void load();}else catalogue.cancel();},
    dispose(){disposed=true;stop();catalogue.dispose();stage.dispose();},
  };
}
