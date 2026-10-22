import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// @ts-expect-error Browser JavaScript modules.
import {APPEARANCE_CATALOG,APPEARANCE_VERSION,APPEARANCE_DIGEST,resolveLook,lookFrame,drawLook} from '../../apps/web/public/world-pixel/look.js';
// @ts-expect-error Browser JavaScript modules.
import {readLookCatalogue,createLookCatalogue} from '../../apps/web/public/world-pixel/look-catalogue.js';
// @ts-expect-error Browser JavaScript modules.
import {readWorldPage,projectWorldAvatars} from '../../apps/web/public/hud/world-scene-projection.js';
// @ts-expect-error Browser JavaScript modules.
import {assertPixelSnapshot} from '../../apps/web/public/world-pixel/map.js';
// @ts-expect-error Browser JavaScript modules.
import {managerInput,assertManagerResult} from '../../apps/web/public/owner-manager-commands.js';
const pair=(hair:string)=>({lookId:`sunnyside-human-${hair}`,catalogVersion:APPEARANCE_VERSION});
const catalogue=()=>({version:2,catalogVersion:APPEARANCE_VERSION,assetVersion:'2026-10-21.r3',catalogDigest:APPEARANCE_DIGEST,defaultLookId:'sunnyside-human-shorthair',looks:APPEARANCE_CATALOG.appearances.map((look:any)=>({lookId:look.key,displayName:look.label,selectable:true,preview:{kind:'layered-sprite',layers:look.clips.idle.layers.map((layer:any)=>'/assets/world-pixel/'+APPEARANCE_CATALOG.images[layer.imageKey].url),frame:{height:64,width:96,y:0,x:0},anchor:{y:39,x:48}}}))});

test('six fixed looks retain byte-identical source images and their declared catalogue digest',async()=>{
 const bytes=await readFile('apps/web/public/world-pixel/appearance-catalog.json');assert.equal(createHash('sha256').update(bytes).digest('hex'),APPEARANCE_DIGEST);assert.equal(APPEARANCE_CATALOG.appearances.length,6);
 for(const [key,image]of Object.entries(APPEARANCE_CATALOG.images) as Array<[string,any]>){const bytes=await readFile('apps/web/public/world-pixel/'+image.url);assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256,key);}
});
test('identity resolves explicit stable keys and only evidenced legacy facts, never Agent or name defaults',()=>{
 for(const look of APPEARANCE_CATALOG.appearances){assert.equal(resolveLook({lookId:look.key,catalogVersion:APPEARANCE_VERSION}).key,look.key);}
 assert.equal(resolveLook(pair('curlyhair')).nativeHairKey,'curlyhair');assert.equal(resolveLook({template:'basic',color:'blue'}).nativeHairKey,'curlyhair');assert.equal(resolveLook({template:'basic',color:'cream'}),null);assert.equal(resolveLook({template:'basic',color:'cream'},{agentId:'unrelated'}),null);assert.equal(resolveLook({...pair('curlyhair'),catalogVersion:'unknown'}),null);assert.equal(resolveLook({lookId:'not-real',catalogVersion:APPEARANCE_VERSION}),null);
 assert.equal(resolveLook({template:'basic',color:'cream'},{rendererHair:'longhair'}).nativeHairKey,'longhair');const fact={template:'basic',color:'cream'};const before=structuredClone(fact);const a=resolveLook(fact,{avatarId:'synthetic-original-fact'});assert.equal(a.key,resolveLook(fact,{avatarId:'synthetic-original-fact',agentId:'changed'}).key);assert.deepEqual(fact,before);
});
test('shared sprite composition uses synchronized native frames and mirrors about the fixed foot',()=>{
 const calls:any[]=[],ctx={save(){},restore(){},translate(...args:any[]){calls.push(['translate',...args]);},scale(...args:any[]){calls.push(['scale',...args]);},drawImage(...args:any[]){calls.push(['draw',...args]);},imageSmoothingEnabled:true,globalAlpha:1};const look=resolveLook(pair('longhair')),images=new Map([['human_base_walk','body'],['human_longhair_walk','hair']]);assert.equal(drawLook(ctx,look,images,{x:264,y:136,scale:3,facing:'left',action:'walk',elapsed:701}),true);assert.deepEqual(calls,[['translate',264,136],['scale',-3,3],['draw','body',672,0,96,64,-48,-39,96,64],['draw','hair',672,0,96,64,-48,-39,96,64]]);assert.deepEqual(lookFrame('walk',701,true).rect,[0,0,96,64]);assert.equal(ctx.imageSmoothingEnabled,false);
});
test('public published appearance changes independently of world, Avatar or position versions',()=>{
 const rules={worldId:'default',version:1,topologyVersion:1,width:16,height:16},row={id:'synthetic-fact',worldId:'default',agentId:'a',version:1,status:'idle',position:{x:1,y:1},placeId:'commons',rulesetVersion:1,createdAt:1,updatedAt:1,profile:{agentId:'a',publishedVersion:1,displayName:'Original',appearance:pair('longhair')}};
 const scene=(value:any,asOf:number)=>readWorldPage({worldId:'default',worldRevision:7,asOf,scope:'world',avatars:[value],complete:true,nextCursor:null},rules),first=scene(row,1),next=scene({...row,profile:{...row.profile,publishedVersion:2,appearance:pair('bowlhair')}},2);assert.doesNotThrow(()=>assertPixelSnapshot({...next,phase:'ready',rules},{...first,phase:'ready',rules}));const p=projectWorldAvatars(next.avatars,rules)[0];assert.equal(resolveLook(p.fact.profile.appearance).key,pair('bowlhair').lookId);assert.deepEqual(p.fact.position,row.position);assert.equal(p.fact.version,1);assert.equal(next.worldRevision,7);
});
test('live directory validates its finite preview whitelist independent of JSON key order or menu order',()=>{
 const data=catalogue();data.looks.reverse();data.looks[0].selectable=false;const read=readLookCatalogue(data);assert.equal(read.looks[0].selectable,false);assert.equal(read.defaultLookId,'sunnyside-human-shorthair');const external=catalogue();external.looks[0].preview.layers[0]='https://outside.invalid/human.png';assert.throws(()=>readLookCatalogue(external),/catalog_unavailable/);assert.throws(()=>readLookCatalogue({...data,catalogDigest:'wrong'}),/catalog_unavailable/);assert.throws(()=>readLookCatalogue({...data,looks:[data.looks[0],data.looks[0]]}),/catalog_unavailable/);
});
test('cancelled or superseded public catalogue results cannot reopen stale choices',async()=>{
 const replies:Array<(value:any)=>void>=[],reader=createLookCatalogue({request:()=>new Promise(resolve=>replies.push(resolve))}),old=reader.load();reader.cancel();replies[0]!(catalogue());await old;assert.notEqual(reader.snapshot().phase,'ready');const next=reader.load(),newer=reader.load();replies[2]!(catalogue());await newer;replies[1]!({...catalogue(),catalogDigest:'old'});await next;assert.equal(reader.snapshot().phase,'ready');reader.dispose();
});
test('new look and name-only saves preserve the original operation and legacy unknown receipt payload',()=>{
 const fields={avatar:pair('mophair')},input={expectedVersion:7,expectedPolicyVersion:3,fields};assert.deepEqual(managerInput('saveProfile',input),input);assert.deepEqual(managerInput('saveProfile',{...input,fields:{displayName:'Name only'}}).fields,{displayName:'Name only'});const legacy={operationId:'old-op',scope:'owner:o',targetId:'a',action:'saveProfile',input:{expectedVersion:7,expectedPolicyVersion:3,fields:{avatar:{template:'basic',color:'blue'}}}},before=JSON.stringify(legacy);assertManagerResult({operationId:'old-op',agentId:'a',version:8,saveEffect:'public',published:{displayName:'Saved',avatar:{template:'basic',color:'blue'}}},legacy,'o');assert.equal(JSON.stringify(legacy),before);assert.throws(()=>managerInput('saveProfile',{...input,fields:{avatar:{lookId:'invented',catalogVersion:APPEARANCE_VERSION}}}),/invalid_backup/);
});
