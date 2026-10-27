import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {RuntimeReadContext} from '../../apps/platform/contracts/runtime-store.ts';
import source from '../../docs/workstreams/ws02-perception/product/place-profiles-20261027/profiles.v1.json' with {type:'json'};
import {publishedPlaceProfileCatalog} from '../../apps/platform/domains/world/place-profile-catalog.ts';
import {createPublishedWorldPlaceProfilesService} from '../../apps/platform/application/world-place-profiles-source.ts';
import {townExpansionRules,TOWN_EXPANSION_LAYOUT_SHA256} from '../../apps/platform/domains/world/town-expansion-v1.ts';

const root=new URL('../../',import.meta.url),read=(path:string)=>readFileSync(new URL(path,root));
const layout=JSON.parse(read('apps/web/public/world-life/world-map-expansion-v1.json').toString());
const spatial=JSON.parse(read('apps/web/public/world-life/spatial-manifest-expansion-v1.json').toString());
const actualLife=JSON.parse(read('apps/web/public/world-life/spatial-manifest-c-v1.json').toString());
export const profileRules=townExpansionRules(layout,TOWN_EXPANSION_LAYOUT_SHA256,spatial);
test('all 48 real click targets have exact authored text, source image frames and nullable ownership',async()=>{
  const expected=['commons',...layout.buildings.map((b:any)=>b.id),...layout.districts.filter((d:any)=>d.newRegion).map((d:any)=>'region:'+d.id),...actualLife.places.map((p:any)=>'life-place:'+p.placeId),'npc-care-board'];
  assert.equal(expected.length,48);assert.deepEqual(new Set(source.profiles.map(p=>p.target.id)),new Set(expected));assert.equal(publishedPlaceProfileCatalog.profiles.length,48);
  const service=createPublishedWorldPlaceProfilesService({async readPublicRules(){return{rules:profileRules,asOf:1234};}},()=>({name:'Provider must never become owner'}));
  for(const authored of source.profiles){
    const value=await service.query({} as RuntimeReadContext,null,'world.place_profile',{targetId:authored.target.id}),p=value.profile as any;
    assert.equal(p.profileId,authored.profileId);assert.equal(p.placeId,authored.placeId);assert.equal(p.description,authored.description);assert.equal(p.name,authored.name);assert.equal(p.ownerNpcId,null);assert.equal(p.owner,null);assert.deepEqual(p.image.frame,authored.image.sourceRect);
    if(p.kind==='building'){
      const b=layout.buildings.find((b:any)=>b.id===p.profileId),[x,y,w,h]=p.image.frame;
      assert.ok(b);assert.ok(x<=b.topLeft[0]&&y<=b.topLeft[1]&&x+w>=b.topLeft[0]+b.size[0]&&y+h>=b.topLeft[1]+b.size[1],p.profileId+' must include the complete building');
      assert.equal(p.placeId,null);
    }
  }
  assert.deepEqual(publishedPlaceProfileCatalog.profiles.find(p=>p.profileId==='npc-care-board')!.image.frame,[0,0,32,32]);
});
test('published images are byte-exact approved source files, with no new generated art or startup rendering',()=>{
  for(const [sourceId,path]of [['town-expanded','apps/web/public/world-life/place-profiles-map-v1.png'],['care-watering','apps/web/public/npc-life-v1/assets/care-watering.png']] as const){
    const original=source.images[sourceId],bytes=read(path);assert.equal(createHash('sha256').update(bytes).digest('hex'),original.sha256);assert.deepEqual(bytes,read(original.path));
  }
});
