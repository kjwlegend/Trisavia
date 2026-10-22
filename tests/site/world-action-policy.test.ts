import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser modules are plain JavaScript.
import {readWorldActionPolicy} from '../../apps/web/public/owner-world-action-policy.js';
// @ts-expect-error Browser modules are plain JavaScript.
import {managerInput,managerRequest,assertManagerResult} from '../../apps/web/public/owner-manager-commands.js';
// @ts-expect-error Browser module is plain JavaScript.
import {worldAccessAdoptionText} from '../../apps/web/public/world-access-status.js';
test('missing-record policy reads are authoritative autonomous version zero while invalid or crossed targets are rejected',()=>{
 const value={agentId:'agent-a',version:0,mode:'autonomous',updatedAt:null,asOf:1,source:'current'};assert.deepEqual(readWorldActionPolicy({...value,privateField:'PRIVATE'},'agent-a'),value);
 for(const invalid of [{...value,agentId:'agent-b'},{...value,mode:'observe_only'},{...value,version:-1},{...value,source:'fallback'},{...value,updatedAt:'unknown'}])assert.throws(()=>readWorldActionPolicy(invalid,'agent-a'));
});
test('policy writes preserve the exact zero-version target and use the original manager receipt path',()=>{
 assert.deepEqual(managerInput('saveWorldActionPolicy',{expectedVersion:0,mode:'observe'}),{expectedVersion:0,mode:'observe'});assert.throws(()=>managerInput('saveWorldActionPolicy',{expectedVersion:0,mode:'observe_only'}));assert.throws(()=>managerInput('saveWorldAccess',{expectedVersion:0,intervalSeconds:60}));
 const pending={action:'saveWorldActionPolicy',operationId:'operation-a',scope:'owner:owner-a',targetId:'agent-a',input:{expectedVersion:0,mode:'observe'}};assert.deepEqual(managerRequest(pending),{path:'/owner/agents/agent-a/world-action-policy',method:'PUT'});const result={agentId:'agent-a',operationId:'operation-a',version:1,mode:'observe',changed:true};assert.doesNotThrow(()=>assertManagerResult(result,pending,'owner-a'));assert.throws(()=>assertManagerResult({...result,agentId:'agent-b'},pending,'owner-a'));assert.throws(()=>assertManagerResult({...result,mode:'autonomous'},pending,'owner-a'));
});

test('adoption distinguishes current reports, lag and unknown without claiming a verified job',()=>{
 const report={appliedVersion:2,jobState:'scheduled',reportedAt:1,status:'current',source:'agent_report'};assert.equal(worldAccessAdoptionText({version:2,adoption:report}),'Agent 已报告采用。');assert.match(worldAccessAdoptionText({version:3,adoption:{...report,status:'awaiting'}}),/等待同步/u);assert.equal(worldAccessAdoptionText({version:3,adoption:report}),'采用情况：未知。');assert.equal(worldAccessAdoptionText({version:2,adoption:{...report,jobState:'stopped'}}),'Agent 已报告停止本地任务。');assert.equal(worldAccessAdoptionText({version:2}),'采用情况：未知。');
});
