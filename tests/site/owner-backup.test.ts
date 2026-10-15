import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {parseOwnerBackup} from '../../apps/web/public/owner-backup.js';
const origin='https://world.kjwlabs.com';
const proof='recovery_identifier.'+'x'.repeat(43);
test('owner backup keeps old setup command and recovery independently without editing its origin',()=>{
 const source={format:'connet-owner-v1',origin,ownerId:'owner_123456',setupToken:proof,recoveryToken:proof,sessionToken:proof,pendingOperation:{operationId:'operation_123',scope:'setup:recovery_identifier',action:'completeSetup',kind:'setup'}};
 const actual=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(actual.recoveryToken,proof);assert.equal(actual.pendingOperation.uncertain,true);assert.equal(actual.pendingOperation.operationId,source.pendingOperation.operationId);
});
test('backup classification rejects Agent material and foreign origins before any use',()=>{
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-agent-v1',origin}),origin),(e:any)=>e.code==='agent_material');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-owner-v1',origin:'https://38.207.178.31',ownerId:'owner_123456',recoveryToken:proof}),origin),(e:any)=>e.code==='different_origin'&&e.originalOrigin==='https://38.207.178.31');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-owner-v1',origin:'https://untrusted.invalid',ownerId:'owner_123456'}),origin),(e:any)=>e.code==='different_origin'&&e.originalOrigin===null);
});
test('temporary management files do not acquire recovery capability and invalid pending scope is rejected',()=>{
 const source={format:'connet-owner-v1',origin,ownerId:'owner_123456',sessionToken:proof};
 assert.equal(parseOwnerBackup(JSON.stringify(source),origin).recoveryToken,undefined);
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{operationId:'operation_123',scope:'owner:other_owner',action:'recover'}}),origin));
});
