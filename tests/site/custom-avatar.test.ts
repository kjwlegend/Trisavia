import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
// @ts-expect-error Browser module.
import{readCustomAppearance,readAvatarManifest,drawCustomAppearance}from'../../apps/web/public/world-pixel/custom-appearance.js';
// @ts-expect-error Browser module.
import{createClipPlayer}from'../../apps/web/public/world-pixel/clip-player.js';
// @ts-expect-error Browser module.
import{readAppearance,readWorldPage}from'../../apps/web/public/hud/world-scene-projection.js';
const digest='a'.repeat(64),ref={kind:'custom',assetId:'own-fixture-asset',version:1,digest,manifestUrl:`/v1/avatar-assets/public/own-fixture-asset/1/${digest}/manifest.json`};
const manifest=JSON.parse(await readFile('apps/web/public/avatar-authoring/v1/sample.manifest.json','utf8'));
test('one strict manifest accepts complete strips and rejects missing, mismatched or extra clip declarations',()=>{
 assert.deepEqual(readAvatarManifest(manifest),manifest);for(const changed of [{...manifest,clips:{idle:manifest.clips.idle}},{...manifest,frame:{...manifest.frame,foot:{x:48,y:64}}},{...manifest,clips:{...manifest.clips,walk:{...manifest.clips.walk,frames:1}}},{...manifest,fps:10}])assert.throws(()=>readAvatarManifest(changed),/custom_avatar_invalid/);
 assert.deepEqual(readAppearance(ref),ref);assert.throws(()=>readCustomAppearance({...ref,manifestUrl:'https://outside.invalid/reference.png'}),/custom_avatar_invalid/);assert.throws(()=>readCustomAppearance({...ref,manifestUrl:ref.manifestUrl+'?image=other'}),/custom_avatar_invalid/);assert.throws(()=>readCustomAppearance({...ref,other:'unrecognized'}),/custom_avatar_invalid/);
});
test('the full custom character is drawn about the fixed foot and optional missing poses retain custom idle',()=>{
 const calls:any[]=[],ctx={save(){},restore(){},translate(...v:any[]){calls.push(['translate',...v]);},scale(...v:any[]){calls.push(['scale',...v]);},drawImage(...v:any[]){calls.push(['image',...v]);},globalAlpha:1,imageSmoothingEnabled:true},resource={key:'own-asset:1:digest',manifest,images:new Map([['idle.png','custom-idle'],['walk.png','custom-walk']])},player=createClipPlayer();
 drawCustomAppearance(ctx,resource,player,{x:10,y:20,action:'walk',facing:'left',time:1000});const next=drawCustomAppearance(ctx,resource,player,{x:10,y:20,action:'walk',facing:'left',time:1300});assert.equal(next.frameIndex,3);assert.deepEqual(calls.slice(-3),[['translate',10,20],['scale',-1,1],['image','custom-walk',288,0,96,64,-48,-39,96,64]]);
 const fallback=drawCustomAppearance(ctx,resource,player,{action:'rest',time:1400});assert.equal(fallback.action,'idle');assert.equal(fallback.fallback,true);assert.equal(calls.at(-1)[1],'custom-idle');assert.ok(calls.filter(x=>x[0]==='image').every(x=>x[1].startsWith('custom-')));
});
test('custom public projection retains resource identity without changing authoritative position or versions',()=>{
 const row={id:'avatar-fact',worldId:'default',agentId:'own-agent',version:3,status:'idle',position:{x:4,y:5},placeId:null,rulesetVersion:1,createdAt:1,updatedAt:2,profile:{agentId:'own-agent',publishedVersion:7,displayName:'Own',appearance:ref}},before=structuredClone(row),data=readWorldPage({worldId:'default',scope:'world',worldRevision:10,asOf:3,avatars:[row],npcs:[],complete:true,nextCursor:null},{worldId:'default',width:16,height:16,version:1,topologyVersion:1});assert.deepEqual(data.avatars[0].profile.appearance,ref);assert.deepEqual(row,before);assert.deepEqual(data.avatars[0].position,{x:4,y:5});assert.equal(data.avatars[0].version,3);
});
