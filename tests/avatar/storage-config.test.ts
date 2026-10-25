import {tmpdir} from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';
import {avatarStorageRoot} from '../../apps/platform/configuration/avatar-storage.ts';
test('default binary roots are stable OS data directories partitioned by instance; explicit paths must be absolute',()=>{
 assert.equal(avatarStorageRoot('instance-test',{},'darwin','/Users/example'),'/Users/example/Library/Application Support/Trisavia/avatar-assets/instance-test');
 assert.equal(avatarStorageRoot('instance-test',{},'linux','/home/example'),'/home/example/.local/share/Trisavia/avatar-assets/instance-test');
 assert.equal(avatarStorageRoot('instance-other',{XDG_DATA_HOME:'/var/private/data'},'linux','/home/example'),'/var/private/data/Trisavia/avatar-assets/instance-other');
 assert.equal(avatarStorageRoot('instance-test',{AVATAR_ASSET_ROOT:'/var/private/test-fixture'},'linux','/home/example'),'/var/private/test-fixture');
 const old=process.cwd(),before=avatarStorageRoot('instance-cwd',{},'darwin','/Users/example');try{process.chdir(tmpdir());assert.equal(avatarStorageRoot('instance-cwd',{},'darwin','/Users/example'),before);}finally{process.chdir(old);}
 assert.throws(()=>avatarStorageRoot('instance-test',{AVATAR_ASSET_ROOT:'outputs/assets'}));
});
