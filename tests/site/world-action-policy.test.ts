import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {readWorldActionPolicy} from '../../apps/web/public/owner-world-action-policy.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {managerInput,managerRequest,assertManagerResult} from '../../apps/web/public/owner-manager-commands.js';
// @ts-expect-error Browser module is plain JavaScript.
import {worldAccessAdoptionText,worldAccessSchedulingText} from '../../apps/web/public/world-access-status.js';
test('missing-record policy reads are authoritative autonomous version zero while invalid or crossed targets are rejected',()=>{
 const value={agentId:'agent-a',version:0,mode:'autonomous',updatedAt:null,asOf:1,source:'current'};assert.deepEqual(readWorldActionPolicy({...value,privateField:'PRIVATE'},'agent-a'),value);
 for(const mode of ['manual','observe'])assert.equal(readWorldActionPolicy({...value,mode},'agent-a').mode,mode);
 for(const invalid of [{...value,agentId:'agent-b'},{...value,mode:'observe_only'},{...value,version:-1},{...value,source:'fallback'},{...value,updatedAt:'unknown'}])assert.throws(()=>readWorldActionPolicy(invalid,'agent-a'));
});
test('policy writes preserve the exact zero-version target and use the original manager receipt path',()=>{
 assert.deepEqual(managerInput('saveWorldActionPolicy',{expectedVersion:4,mode:'manual'}),{expectedVersion:4,mode:'manual'});
 assert.deepEqual(managerInput('saveWorldActionPolicy',{expectedVersion:0,mode:'observe'}),{expectedVersion:0,mode:'observe'});assert.throws(()=>managerInput('saveWorldActionPolicy',{expectedVersion:0,mode:'observe_only'}));assert.throws(()=>managerInput('saveWorldAccess',{expectedVersion:0,intervalSeconds:60}));
 const pending={action:'saveWorldActionPolicy',operationId:'operation-a',scope:'owner:owner-a',targetId:'agent-a',input:{expectedVersion:0,mode:'observe'}};assert.deepEqual(managerRequest(pending),{path:'/owner/agents/agent-a/world-action-policy',method:'PUT'});const result={agentId:'agent-a',operationId:'operation-a',version:1,mode:'observe',changed:true};assert.doesNotThrow(()=>assertManagerResult(result,pending,'owner-a'));assert.throws(()=>assertManagerResult({...result,agentId:'agent-b'},pending,'owner-a'));assert.throws(()=>assertManagerResult({...result,mode:'autonomous'},pending,'owner-a'));
});

// @ts-expect-error Browser module is plain JavaScript.
import {accountLabel} from '../../apps/web/public/owner-i18n.js';
test('adoption distinguishes current reports, lag and unknown without claiming a verified job',()=>{
 const report={appliedVersion:2,jobState:'scheduled',reportedAt:1,status:'current',source:'agent_report'};
 assert.equal(worldAccessAdoptionText({version:2,adoption:report}),accountLabel('access.adoptedReport'));
 assert.equal(worldAccessAdoptionText({version:3,adoption:{...report,status:'awaiting'}}),accountLabel('access.awaiting'));
 assert.equal(worldAccessAdoptionText({version:3,adoption:report}),accountLabel('access.unknown'));
 assert.equal(worldAccessAdoptionText({version:2,adoption:{...report,jobState:'stopped'}}),accountLabel('access.stoppedReport'));
 const policy={agentId:'agent-a',version:4,mode:'manual'},access={agentId:'agent-a',version:2,intervalSeconds:3600,scheduling:{version:1,mode:'manual',policyVersion:4,effectiveState:'off',reason:'manual',source:'server_intent',serverControlsJob:false},adoption:{...report,jobState:'stopped'}};
 assert.equal(worldAccessAdoptionText(access,policy),accountLabel('access.awaiting'),'interval-only old report never proves manual stopped');
 assert.equal(worldAccessAdoptionText({...access,adoption:{...access.adoption,appliedPolicyVersion:3}},policy),accountLabel('access.awaiting'));
 assert.equal(worldAccessAdoptionText({...access,adoption:{...access.adoption,appliedPolicyVersion:4}},policy),accountLabel('access.stoppedReport'));
 assert.equal(worldAccessAdoptionText({...access,adoption:{...report,appliedPolicyVersion:4}},policy),accountLabel('access.unknown'));
 assert.equal(worldAccessSchedulingText(access,{...policy,version:5}),accountLabel('access.unknown'));
 assert.equal(worldAccessSchedulingText({...access,scheduling:{...access.scheduling,effectiveState:'on'}},policy),accountLabel('access.unknown'));
 assert.equal(worldAccessAdoptionText({version:2}),accountLabel('access.unknown'));
});
