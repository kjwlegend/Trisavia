import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {createPublicCharacterReader,readPublicCharacter} from '../../apps/web/public/hud/public-character-reader.js';
const appearance={lookId:'sunnyside-human-longhair',catalogVersion:'2026-10-21.appearance-v1.1'};
const row=(id:string,version=7)=>({agentId:id,profile:{publishedVersion:version,displayName:id,appearance},placeId:'commons',position:{x:0,y:0}});
const profile=(id:string,version=7)=>({agentId:id,publishedVersion:version,membership:{state:'joined'},appearance,profile:{displayName:id,bio:'公开简介 '+id,interests:['阅读']}});
test('public card accepts only current published fields and rejects another identity or a stale publication',()=>{
 const value=readPublicCharacter({...profile('public-a'),ownerId:'PRIVATE',draft:{bio:'PRIVATE'},profile:{...profile('public-a').profile,privateEmail:'PRIVATE'}},'public-a',7);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|ownerId|draft/u);
 assert.throws(()=>readPublicCharacter(profile('public-b'),'public-a',7));assert.throws(()=>readPublicCharacter(profile('public-a',6),'public-a',7));assert.throws(()=>readPublicCharacter({...profile('public-a'),membership:{state:'left'}},'public-a',7));
 assert.equal(readPublicCharacter({...profile('public-a'),profile:{displayName:'空资料'}},'public-a',7).bio,'');
});
test('rapid A/B selection cancels and ignores a late A result; close also cancels pending work',async()=>{
 let release:(value:unknown)=>void=()=>{};const signals:AbortSignal[]=[];const reader=createPublicCharacterReader({request:async(path:string,{signal}:{signal:AbortSignal})=>{signals.push(signal);if(path.endsWith('public-a'))return new Promise(resolve=>{release=resolve;});return profile('public-b');}});
 const old=reader.open(row('public-a'));await reader.open(row('public-b'));assert.equal(signals[0]!.aborted,true);release(profile('public-a'));await old;assert.equal(reader.snapshot().data.agentId,'public-b');const pending=reader.open(row('public-a'));reader.clear();assert.equal(signals.at(-1)!.aborted,true);release(profile('public-a'));await pending;assert.equal(reader.snapshot().phase,'idle');assert.equal(reader.snapshot().data,null);reader.dispose();
});
test('movement polls keep the accepted profile stable; publication changes reread once and an unavailable source clears it',async()=>{
 let calls=0,version=7,denied=false;const reader=createPublicCharacterReader({request:async()=>{calls++;if(denied)throw Object.assign(new Error('not public'),{status:404});return profile('public-a',version);}});
 await reader.open(row('public-a'));for(let x=1;x<=5;x++)await reader.observe({...row('public-a'),version:x,position:{x,y:0}});assert.equal(calls,1);assert.equal(reader.snapshot().data.bio,'公开简介 public-a');
 version=8;await reader.observe(row('public-a',8));assert.equal(calls,2);denied=true;await reader.observe(row('public-a',9));assert.equal(reader.snapshot().phase,'error');assert.equal(reader.snapshot().data,null);assert.equal(reader.snapshot().errorStatus,404);await reader.observe(row('public-a',9));assert.equal(calls,3);reader.dispose();
});
