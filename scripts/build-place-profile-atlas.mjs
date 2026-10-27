// Reproduce the existing map renderer's daylight scenery, with no actors or selection.
// This creates a source atlas for authored profile frames; it does not modify the map.
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {chromium} from '@playwright/test';
import {registerSiteRoutes} from '../apps/platform/transport/http/site-routes.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=resolve(root,'apps/web/public');
const destination=resolve(web,'world-life/place-profiles-map-v1.png');
const app=Fastify({logger:false});
app.get('/place-profile-atlas-source',(_req,reply)=>reply.type('text/html').send('<!doctype html><html><body></body></html>'));
registerSiteRoutes(app,{assetMode:'source',repoRoot:root,webRoot:web});
let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});
 const address=app.server.address();if(!address||typeof address==='string')throw Error('atlas_source_unavailable');
 browser=await chromium.launch({headless:true,executablePath:process.env.M1_TEST_CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+address.port+'/place-profile-atlas-source');
 const result=await page.evaluate(async()=>{
  const {loadPixelTown}=await import('/assets/world-pixel/town.js');
  const town=await loadPixelTown(),canvas=document.createElement('canvas');canvas.width=town.mapSpec.width;canvas.height=town.mapSpec.height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const frame={elapsed:0,serverTime:0,stale:false,paused:true,reducedMotion:true,quality:'high',scale:1,theme:'day',lighting:{people:1},avatars:[],viewport:{left:0,top:0,right:canvas.width,bottom:canvas.height}};
  town.drawGround(ctx,frame);
  for(const object of [...town.objects].sort((a,b)=>a.y-b.y||String(a.id||a.kind).localeCompare(String(b.id||b.kind))))object.draw(ctx,frame);
  const value={width:canvas.width,height:canvas.height,data:canvas.toDataURL('image/png').split(',')[1]};town.dispose();return value;
 });
 const bytes=Buffer.from(result.data,'base64');await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
 const sourcePaths=['apps/web/public/world-pixel/town.js','apps/web/public/world-pixel/town-v2-art.js','apps/web/public/world-pixel/asset-kit.js','apps/web/public/world-pixel/life-art.js','apps/web/public/world-pixel/life-c-art.js','apps/web/public/world-life/world-map-expansion-v1.json'];
 const sources=await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')})));
 const metadata={version:1,url:'/assets/world-life/place-profiles-map-v1.png',width:result.width,height:result.height,sha256:createHash('sha256').update(bytes).digest('hex'),scope:'Existing renderer scenery only: no NPCs, Agent avatars, speech, selection or fabricated service state.',sources};
 await writeFile(resolve(web,'world-life/place-profiles-map-v1.json'),JSON.stringify(metadata,null,2)+'\n');
 console.log(JSON.stringify({file:destination,width:result.width,height:result.height,bytes:bytes.length,sha256:metadata.sha256}));
}finally{await browser?.close();await app.close();}
