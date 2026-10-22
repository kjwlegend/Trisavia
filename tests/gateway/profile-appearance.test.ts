import assert from 'node:assert/strict';
import test from 'node:test';
import {avatarCatalog,APPEARANCE_CATALOG_VERSION,DEFAULT_LOOK_ID} from '../../apps/platform/domains/profile/appearance-catalog.ts';
import {projectAvatar,resolveAppearance,readAppearance,validateAvatarInput} from '../../apps/platform/domains/profile/appearance.ts';
import {defaultPublicProfile,validateFields} from '../../apps/platform/domains/profile/profile-rules.ts';
import {meteredRead} from '../../apps/platform/domains/perception/read-budget.ts';
import {StorageError,type M1Transaction} from '../../apps/platform/contracts/store.ts';

test('the actual six-person catalogue and registration default share stable keys and fixed same-origin preview resources',()=>{
 const catalog=avatarCatalog();assert.equal(catalog.version,2);assert.equal(catalog.catalogVersion,APPEARANCE_CATALOG_VERSION);assert.equal(catalog.assetVersion,'2026-10-21.r3');assert.equal(catalog.catalogDigest,'30c00558d539a194e6936b24e0179a2558cad4b047251265231388e9c63c2b82');assert.equal(catalog.defaultLookId,DEFAULT_LOOK_ID);
 const looks=catalog.looks as {lookId:string;selectable:boolean;preview:{kind:string;layers:string[];frame:unknown;anchor:unknown}}[];
 assert.deepEqual(looks.map(look=>look.lookId),['shorthair','longhair','curlyhair','bowlhair','mophair','spikeyhair'].map(hair=>`sunnyside-human-${hair}`));
 for(const look of looks){assert.equal(look.selectable,true);assert.equal(look.preview.kind,'layered-sprite');assert(look.preview.layers.every(url=>url.startsWith('/assets/world-pixel/assets/')));assert.deepEqual(look.preview.frame,{x:0,y:0,width:96,height:64});assert.deepEqual(validateAvatarInput({lookId:look.lookId,catalogVersion:catalog.catalogVersion}),{lookId:look.lookId,catalogVersion:catalog.catalogVersion});}
 assert.deepEqual(defaultPublicProfile('agent-with-no-world-avatar').avatar,{lookId:DEFAULT_LOOK_ID,catalogVersion:APPEARANCE_CATALOG_VERSION});
 looks[0]!.preview.layers[0]='untrusted';assert.notEqual(((avatarCatalog().looks as typeof looks)[0]!).preview.layers[0],'untrusted');
});
test('new selections validate current selectable keys while exact legacy input remains supported',()=>{
 for(const avatar of [{lookId:'not-a-person',catalogVersion:APPEARANCE_CATALOG_VERSION},{lookId:DEFAULT_LOOK_ID,catalogVersion:'old-unselectable-version'},{lookId:DEFAULT_LOOK_ID,catalogVersion:APPEARANCE_CATALOG_VERSION,template:'basic'},{lookId:DEFAULT_LOOK_ID,catalogVersion:APPEARANCE_CATALOG_VERSION,url:'https://untrusted.invalid/image'}])assert.throws(()=>validateFields({avatar}));
 for(const color of ['olive','cream','blue','coral'])assert.deepEqual(validateFields({avatar:{template:'basic',color}}),{avatar:{template:'basic',color}});
 assert.throws(()=>validateFields({avatar:{template:'basic',color:'amber'}}));
 const retained={lookId:'retired-known-person',catalogVersion:'retained-old-version'};assert.deepEqual(projectAvatar(retained),retained,'Reading retained facts is separate from making a new selection');
});
test('legacy presentation uses the actual Avatar fact id, fixed historical order and explicit colour branches only',()=>{
 const legacy={template:'basic',color:'olive'};
 assert.deepEqual(resolveAppearance(legacy),legacy,'Missing identity stays unresolved; it is not a default choice');
 assert.equal(resolveAppearance({template:'basic',color:'blue'})!.lookId,'sunnyside-human-curlyhair');
 assert.equal(resolveAppearance({template:'basic',color:'amber'})!.lookId,'sunnyside-human-longhair');
 assert.equal(resolveAppearance(legacy,{avatarId:'a'})!.lookId,'sunnyside-human-longhair');
 assert.equal(resolveAppearance(legacy,{avatarId:'b'})!.lookId,'sunnyside-human-curlyhair');
 assert.equal(resolveAppearance(legacy,{avatarId:'c'})!.lookId,'sunnyside-human-bowlhair');
 const selected={lookId:'sunnyside-human-mophair',catalogVersion:APPEARANCE_CATALOG_VERSION};assert.deepEqual(resolveAppearance(selected,{avatarId:'a'}),selected);
 assert.deepEqual(legacy,{template:'basic',color:'olive'});
});
test('the read-only identity seam distinguishes real absence from a failed or ended session and does not query for explicit selections',async()=>{
 const context={},legacy={template:'basic',color:'olive'};let calls=0;
 const absent=async(session:object,input:{agentId:string;worldId:'default'})=>{assert.equal(session,context);assert.equal(input.agentId,'agent-real-id');assert.equal(input.worldId,'default');calls++;return null;};
 assert.deepEqual(await readAppearance(context,'agent-real-id',legacy,absent),legacy);assert.equal(calls,1);
 const selected={lookId:DEFAULT_LOOK_ID,catalogVersion:APPEARANCE_CATALOG_VERSION};assert.deepEqual(await readAppearance(context,'agent-real-id',selected,absent),selected);assert.equal(calls,1);
 await assert.rejects(readAppearance(context,'agent-real-id',legacy,async()=>{throw new StorageError('closed','Scope ended');}),error=>error instanceof StorageError&&error.code==='closed');
});
test('a metered appearance lookup keeps the original session capability, charges one row, shares duplicates and checks deadlines',async t=>{
 let clock=1_000,calls=0;t.mock.method(Date,'now',()=>clock);const original={get:async()=>undefined,scan:async()=>[],find:async()=>[],count:async()=>0,quotaCount:async()=>0,insert:async()=>{throw new Error('No writes');},update:async()=>{throw new Error('No writes');},remove:async()=>{throw new Error('No writes');}} as unknown as M1Transaction;
 const exhausted=meteredRead(original,{maxScannedRows:1,deadlineMs:250},{started:clock});
 await assert.rejects(exhausted.readAuxiliary('legacy-avatar:agent',async()=>{calls++;return {avatarId:'a'};}),error=>(error as {code:string}).code==='budget_too_small');assert.equal(calls,0);
 const meter=meteredRead(original,{maxScannedRows:2,deadlineMs:250},{started:clock}),lookup=()=>meter.readAuxiliary('legacy-avatar:agent',async()=>{calls++;assert.notEqual(meter.reader,original);return {avatarId:'a'};});
 assert.deepEqual(await lookup(),{avatarId:'a'});assert.deepEqual(await lookup(),{avatarId:'a'});assert.equal(calls,1);
 const slow=meteredRead(original,{maxScannedRows:2,deadlineMs:250},{started:clock});await assert.rejects(slow.readAuxiliary('legacy-avatar:slow',async()=>{clock+=251;return null;}),error=>(error as {code:string}).code==='budget_too_small');
});
