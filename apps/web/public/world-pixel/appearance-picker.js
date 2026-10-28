import {accountElement as el,accountMessage,accountText,accountAttribute} from '../owner-i18n.js';
import {appearanceLookLabel,appearanceColorLabel} from './appearance-ui.js';
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
  const tabs=el('nav','appearance-attribute-tabs');accountAttribute(tabs,'aria-label',()=>(accountMessage("avatar.picker.attributesAria")));
  const panel=el('div','appearance-properties'),message=el('div','look-catalogue-message'),grid=el('div','look-grid'),summary=el('p','choice-summary');
  const base=el('section','appearance-base-section'),hair=el('section','appearance-hair-section'),hairColor=el('section','appearance-color-group'),clothing=el('section','appearance-color-group');
  const baseTitle=el('h3','',accountMessage("avatar.picker.base"));base.append(baseTitle,el('p','',accountMessage("avatar.picker.baseDescription")));const basePreview=el('div','appearance-base-preview');base.append(basePreview);
  grid.setAttribute('role','group');accountAttribute(grid,'aria-label',()=>(accountMessage("avatar.picker.chooseHairAria")));hair.append(grid);
  const colorGroups=new Map();for(const [kind,label,node]of [['hair',accountMessage("avatar.picker.hairColor"),hairColor],['clothing',accountMessage("avatar.picker.clothingColor"),clothing]]){const options=el('div','appearance-color-options');options.setAttribute('role','group');accountAttribute(options,'aria-label',()=>(label));node.append(el('strong','',label),options);colorGroups.set(kind,options);}
  panel.append(base,hair,hairColor,clothing);editor.append(tabs,message,panel);layout.append(stage.node,editor);form.prepend(input,version,hairInput,clothingInput,layout,summary);
  const catalogue=createLookCatalogue();let agent=null,editable=false,active=false,assets=null,disposed=false,assetError=false,attribute='hair',explicitOriginal={hair:false,clothing:false};
  const attributeTabs=new Map();
  for(const [key,label]of [['base',accountMessage("avatar.picker.base")],['hair',accountMessage("avatar.picker.hairstyle")],['hairColor',accountMessage("avatar.picker.hairColor")],['clothing',accountMessage("avatar.picker.clothingColor")]]){
    const button=el('button','',label);button.type='button';button.dataset.appearanceAttribute=key;button.setAttribute('aria-pressed',String(key===attribute));button.addEventListener('click',()=>{attribute=key;showAttribute();});tabs.append(button);attributeTabs.set(key,button);
  }
  function showAttribute(){
    base.hidden=attribute!=='base';hair.hidden=attribute!=='hair';hairColor.hidden=!['hair','hairColor'].includes(attribute);clothing.hidden=!['hair','clothing'].includes(attribute);
    for(const [key,button]of attributeTabs){button.setAttribute('aria-pressed',String(key===attribute));button.setAttribute('aria-selected',String(key===attribute));}
  }
  function selected(){return input.value?{lookId:input.value,catalogVersion:version.value,...(hairInput.value!=='original'||explicitOriginal.hair?{hairColorId:hairInput.value}:{}),...(clothingInput.value!=='original'||explicitOriginal.clothing?{clothingColorId:clothingInput.value}:{})}:null;}
  const colorsReady=data=>data?.colorCustomization?.version===1;
  function selectionLabel(value){
    if(value?.kind==='custom')return accountMessage('avatar.picker.customApplied');const look=resolveLook(value),colors=appearanceColors(value);
    return look?[appearanceLookLabel(look),...['hair','clothing'].map(kind=>accountMessage(kind==='hair'?'avatar.picker.hairSelection':'avatar.picker.clothingSelection',{colorName:appearanceColorLabel(kind,paletteOptions(kind).find(option=>option.id===colors[kind==='hair'?'hairColorId':'clothingColorId']))}))].join(' · '):accountMessage('avatar.picker.unavailable');
  }
  function saved(){return agent?.profile?.publishedAppearance??agent?.profile?.published?.avatar??null;}
  function render(){
    if(disposed)return;
    const focused=document.activeElement?.closest('[data-look-id]')?.dataset.lookId,focusedColor=document.activeElement?.closest('[data-appearance-color-id]')?.dataset,current=selected(),chosen=resolveLook(current),confirmed=resolveLook(saved()),data=catalogue.snapshot();
    basePreview.replaceChildren();const baseCanvas=el('canvas');baseCanvas.width=288;baseCanvas.height=192;accountAttribute(baseCanvas,'aria-label',()=>(accountMessage("avatar.picker.basePreviewAria")));if(assets&&chosen)drawLook(baseCanvas.getContext('2d'),chosen,assets.images,{x:144,y:124,scale:3,still:true});basePreview.append(baseCanvas);
    stage.update(current||saved(),{displayName:agent?.profile?.published?.displayName||'',isDirty:isDirty()});grid.replaceChildren();message.replaceChildren();
    if(data.phase==='loading')message.append(el('p','',accountMessage("avatar.picker.loading")));
    if(data.phase==='error'){
      message.append(el('p','',accountMessage("avatar.picker.catalogUnavailable")));const retry=el('button','',accountMessage("avatar.picker.retryCatalog"));retry.type='button';retry.addEventListener('click',()=>void catalogue.load());message.append(retry);
    }
    if(assetError){const retry=el('button','',accountMessage("avatar.picker.retryDisplay"));retry.type='button';retry.addEventListener('click',()=>{assetError=false;void load();});message.append(el('p','',accountMessage("avatar.picker.assetsUnavailable")),retry);}
    const entries=data.phase==='ready'?data.data.looks:[];
    for(const item of entries){
      const art=resolveLook({...current,lookId:item.lookId,catalogVersion:data.data.catalogVersion}),button=el('button','look-option'),picture=el('span','look-portrait'),canvas=el('canvas');
      button.type='button';button.dataset.lookId=item.lookId;accountAttribute(button,'aria-label',()=>(appearanceLookLabel({key:item.lookId,label:item.displayName})));button.setAttribute('aria-pressed',String(current?.lookId===item.lookId));button.disabled=!editable||!item.selectable;
      canvas.width=288;canvas.height=192;canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');
      if(assets)drawLook(ctx,art,assets.images,{x:144,y:124,scale:3,still:true});else drawLookPlaceholder(ctx,{x:144,y:124,scale:3});
      picture.append(canvas);button.append(picture,el('span','look-label',appearanceLookLabel({key:item.lookId,label:item.displayName})));
      if(current?.lookId===item.lookId)button.append(el('span','look-selected-marker','✓'));
      if(confirmed?.key===item.lookId)button.dataset.saved='true';
      button.addEventListener('click',()=>{if(!editable||!item.selectable||catalogue.snapshot().phase!=='ready')return;input.value=item.lookId;version.value=data.data.catalogVersion;input.dispatchEvent(new Event('change',{bubbles:true}));render();});grid.append(button);
    }
    if(focused)grid.querySelector(`[data-look-id="${focused}"]`)?.focus({preventScroll:true});
    for(const [kind,node]of colorGroups){
      node.replaceChildren();const field=kind==='hair'?hairInput:clothingInput;
      for(const option of paletteOptions(kind)){const button=el('button','appearance-color-option');button.type='button';button.dataset.appearanceColorKind=kind;button.dataset.appearanceColorId=option.id;button.style.setProperty('--swatch',option.swatch);accountAttribute(button,'aria-label',()=>(accountMessage("avatar.picker.colorOptionAria",{colorKind:kind==='hair'?accountMessage("avatar.picker.hairColor"):accountMessage("avatar.picker.clothingColor"),colorName:appearanceColorLabel(kind,option)})));accountAttribute(button,'title',()=>(appearanceColorLabel(kind,option)));if(kind==='clothing'){button.classList.add('appearance-clothing-option');button.append(icon('appearance'),el('span','',appearanceColorLabel(kind,option)));}button.setAttribute('aria-pressed',String(field.value===option.id));button.disabled=!editable||data.phase!=='ready'||!colorsReady(data.data);button.addEventListener('click',()=>{if(button.disabled||catalogue.snapshot().phase!=='ready'||!colorsReady(catalogue.snapshot().data))return;field.value=option.id;field.dispatchEvent(new Event('change',{bubbles:true}));render();});node.append(button);}
    }
    if(focusedColor)panel.querySelector(`[data-appearance-color-kind="${focusedColor.appearanceColorKind}"][data-appearance-color-id="${focusedColor.appearanceColorId}"]`)?.focus({preventScroll:true});
    if(data.phase==='ready'&&!colorsReady(data.data))message.append(el('p','',accountMessage("avatar.picker.colorsUnavailable")));
    const savedText=el('strong'),previewText=el('strong');accountText(savedText,()=>selectionLabel(saved()));accountText(previewText,()=>selectionLabel(current||saved()));summary.replaceChildren(el('span','',accountMessage('avatar.picker.savedLabel')),savedText,el('span','',accountMessage('avatar.picker.previewLabel')),previewText);
    summary.dataset.dirty=String(isDirty());showAttribute();
  }
  async function load(){try{assets=await loadLookAssets();assetError=false;}catch{assetError=true;}if(!disposed)render();}
  const stop=catalogue.subscribe(()=>{render();changed();});
  return{
    stage,node:layout,
    selection(){const value=selected(),catalog=catalogue.snapshot();if(catalog.phase!=='ready'||catalog.data.catalogVersion!==value?.catalogVersion||!catalog.data.looks.some(look=>look.lookId===value.lookId&&look.selectable))return null;if(!colorsReady(catalog.data)&&(value.hairColorId!==undefined||value.clothingColorId!==undefined))return null;return value;},
    reset(value){agent=value;const appearance=saved(),colors=appearanceColors(appearance);explicitOriginal={hair:Object.hasOwn(appearance||{},'hairColorId'),clothing:Object.hasOwn(appearance||{},'clothingColorId')};hairInput.value=colors.hairColorId;clothingInput.value=colors.clothingColorId;input.value=typeof appearance?.lookId==='string'?appearance.lookId:'';version.value=typeof appearance?.catalogVersion==='string'?appearance.catalogVersion:APPEARANCE_VERSION;render();},
    agent(value){agent=value;render();},refresh:render,
    editable(value){if(editable!==value){editable=value;render();}else{for(const button of grid.querySelectorAll('button'))button.disabled=!editable||!catalogue.snapshot().data?.looks.some(item=>item.lookId===button.dataset.lookId&&item.selectable);for(const button of panel.querySelectorAll('[data-appearance-color-id]'))button.disabled=!editable||catalogue.snapshot().phase!=='ready'||!colorsReady(catalogue.snapshot().data);}},
    active(value){if(active===value)return;active=value;stage.active(value);if(value){void catalogue.load();if(!assets&&!assetError)void load();}else catalogue.cancel();},
    dispose(){disposed=true;stop();catalogue.dispose();stage.dispose();},
  };
}
