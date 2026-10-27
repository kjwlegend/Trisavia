import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {currentNpcIdentity,withCurrentNpcIdentity} from '../../apps/platform/domains/town-services/npc-identity.ts';
import {npcLifeFixture} from '../npc-life/fixture.ts';

test('only the approved eight current identities share exact authored stories without changing authority or enabling reserved NPCs',()=>{
 const ids=['npc-mayor','npc-tavern','npc-innkeeper','npc-harbor-hand','npc-fishing-clerk','npc-librarian','npc-neighbor','npc-gardener'],names=['周望','许舟','林素','陈大川','唐越','顾宁','阿迟','青禾'];
 ids.forEach((npcId,i)=>{const old={npcId,name:'旧岗位显示',role:'原身份',position:{x:i,y:2},appearance:{lookId:'unchanged'},serviceIds:['unchanged']},before=structuredClone(old),view=withCurrentNpcIdentity(old),identity=currentNpcIdentity(npcId)!;assert.equal(view.name,names[i]);assert.equal(view.role,identity.role);assert.deepEqual(old,before);assert.deepEqual(view.position,old.position);assert.deepEqual(view.appearance,old.appearance);assert.deepEqual(view.serviceIds,old.serviceIds);assert.equal(identity.digest,createHash('sha256').update(identity.story,'utf8').digest('hex'));assert.equal(identity.ref,'npc-personas/'+npcId+'@1');});
 assert.equal(currentNpcIdentity('npc-tea-companion'),undefined);assert.equal(currentNpcIdentity('npc-trail-guide'),undefined);assert.equal(currentNpcIdentity('江屿'),undefined);
});

test('actual current gardener directory and Life identity read share the persona while persisted definition and geometry stay intact',async()=>{
 const f=await npcLifeFixture(),before=structuredClone(f.d),n=(await f.service.query(f.context,null,'npc_life.directory',{})).npcs as any[],life=await f.engine.readNpcIdentity(f.context,'npc-gardener'),current=(await f.service.currentNpcs(f.context))[0]!;
 assert.equal(n[0].name,'青禾');assert.equal(n[0].role,'松荫漫步园园务员');assert.deepEqual(n[0].identity,currentNpcIdentity('npc-gardener'));assert.equal(life!.name,n[0].name);assert.deepEqual(current.identity,n[0].identity);assert.deepEqual(f.d,before);assert.deepEqual(n[0].position,before.npcs[0]!.initialPosition);assert.deepEqual(n[0].appearance,before.npcs[0]!.appearance);
});
