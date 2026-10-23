import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';

test('finite palette changes only hair and clothing pixels in idle/walk, leaving original art and skin intact',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.M1_TEST_CHROMIUM_PATH?{executablePath:process.env.M1_TEST_CHROMIUM_PATH}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1000,height:520}}),root=resolve('apps/web/public');
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://palette.invalid')return route.abort();if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#f7f3e8"></body>'});const file=resolve(root,url.pathname.slice(8));if(!file.startsWith(root+'/'))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.json':'application/json','.png':'image/png'} as Record<string,string>)[extname(file)]||'application/octet-stream'});}catch{return route.abort();}});await page.goto('https://palette.invalid');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error Browser production module.
  const {appearanceLayer,APPEARANCE_COLORS}=await import('/assets/world-pixel/appearance-palette.js');
  // @ts-expect-error Browser production module.
  const {resolveLook,drawLook,APPEARANCE_CATALOG}=await import('/assets/world-pixel/look.js');
  // @ts-expect-error Browser production module.
  const {readAppearance}=await import('/assets/hud/world-scene-projection.js');
  const images=new Map<string,HTMLImageElement>(),reports:Array<{key:string,changed:number,skinChanged:number,alphaChanged:number}>=[];
  for(const [key,definition]of Object.entries(APPEARANCE_CATALOG.images) as Array<[string,{url:string}]>){if(!key.startsWith('human_'))continue;const image=new Image();image.src='/assets/world-pixel/'+definition.url;await image.decode();images.set(key,image);}
  for(const [key,image]of images){const kind=key.includes('_base_')?'clothing':'hair',colored=appearanceLayer(image,kind,kind==='hair'?'blue':'forest'),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const before=ctx.getImageData(0,0,image.width,image.height).data;ctx.clearRect(0,0,image.width,image.height);ctx.drawImage(colored,0,0);const after=ctx.getImageData(0,0,image.width,image.height).data;let changed=0,skinChanged=0,alphaChanged=0;for(let i=0;i<before.length;i+=4){const different=before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2];if(different)changed++;if(before[i+3]!==after[i+3])alphaChanged++;if(different&&before[i]!>180&&before[i+1]!>140&&before[i+2]!>100)skinChanged++;}reports.push({key,changed,skinChanged,alphaChanged});if(appearanceLayer(image,kind,'original')!==image)throw Error('original_art_replaced');}
  for(const action of ['idle','walk'])for(const [index,hair]of APPEARANCE_COLORS.hairColors.entries()){const canvas=document.createElement('canvas');canvas.width=180;canvas.height=220;canvas.style.imageRendering='pixelated';canvas.setAttribute('aria-label',action+' '+hair.displayName);const look=resolveLook({lookId:'sunnyside-human-longhair',catalogVersion:APPEARANCE_CATALOG.version,hairColorId:hair.id,clothingColorId:index%2?'clay':'forest'});drawLook(canvas.getContext('2d'),look,images,{x:90,y:190,scale:6,action,still:true});document.body.append(canvas);}
  const appearance=readAppearance({lookId:'sunnyside-human-longhair',catalogVersion:APPEARANCE_CATALOG.version,hairColorId:'blue',clothingColorId:'forest'});let rejects=false;try{readAppearance({...appearance,hairColorId:'unknown'});}catch{rejects=true;}return{reports,appearance,rejects};
 });
 assert.ok(result.reports.length===14&&result.reports.every(row=>row.changed>0&&row.alphaChanged===0&&row.skinChanged===0),JSON.stringify(result.reports));assert.equal(result.appearance.hairColorId,'blue');assert.equal(result.rejects,true);await mkdir('outputs/paper-hud-v3',{recursive:true});await page.screenshot({path:'outputs/paper-hud-v3/appearance-colors-idle-walk.png',fullPage:true});
});
