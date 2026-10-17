import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is intentionally plain JS.
import {parseOwnerBackup} from '../../apps/web/public/owner-backup.js';
const origin='https://world.kjwlabs.com';
const proof='recovery_identifier.'+'x'.repeat(43);
const setup='setup_identifier.'+'t'.repeat(43);
test('new owner backup keeps setup and independent recovery within its origin',()=>{
 const source={format:'connet-owner-v2',origin,ownerId:'f59956c9-b501-4f2a-b7bb-7d86f3b33531',setupToken:setup,recoveryToken:recovery,sessionToken:session,pendingOperation:{operationId:'operation_123',scope:'setup:setup_identifier',action:'completeSetup',input:{username:'Owner_01',email:'owner@example.test'}}};
 const actual=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(actual.recoveryToken,recovery);assert.equal(actual.pendingOperation.uncertain,true);assert.equal(actual.pendingOperation.operationId,source.pendingOperation.operationId);
});
test('backup classification rejects Agent material and foreign origins before any use',()=>{
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-agent-v1',origin}),origin),(e:any)=>e.code==='agent_material');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-owner-v2',origin:'https://38.207.178.31',ownerId:'f59956c9-b501-4f2a-b7bb-7d86f3b33531',recoveryToken:proof}),origin),(e:any)=>e.code==='different_origin');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-owner-v2',origin:'https://untrusted.invalid',ownerId:'f59956c9-b501-4f2a-b7bb-7d86f3b33531'}),origin),(e:any)=>e.code==='different_origin'&&e.originalOrigin===null);
});
test('temporary management files do not acquire recovery capability and invalid pending scope is rejected',()=>{
 const source={format:'connet-owner-v2',origin,ownerId:'f59956c9-b501-4f2a-b7bb-7d86f3b33531',sessionToken:proof};
 assert.equal(parseOwnerBackup(JSON.stringify(source),origin).recoveryToken,undefined);
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{operationId:'operation_123',scope:'owner:other_owner',action:'recover'}}),origin));
});

const session='session_identifier.'+'s'.repeat(43),recovery='recovery_next.'+'r'.repeat(43);
const ownerId='f59956c9-b501-4f2a-b7bb-7d86f3b33531';
const pending=(action:string,scope:string,input?:Record<string,unknown>)=>({operationId:'operation_new_123',action,scope,...(input?{input}:{})});

test('identifier login progress has no invented owner and stays bound to its pre-saved session',()=>{
 const source={format:'connet-owner-v2',origin,sessionToken:session,pendingOperation:pending('login','owner-login:session_identifier',{identifier:'owner_01'})};
 const parsed=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(parsed.format,source.format);assert.equal(parsed.ownerId,undefined);assert.equal(parsed.sessionToken,session);
 assert.equal(parsed.pendingOperation.scope,'owner-login:session_identifier');assert.equal(parsed.pendingOperation.input.identifier,'owner_01');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,ownerId}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,scope:'owner-login:someone_else'}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,action:'recover'}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:pending('login',`owner:${ownerId}`)}),origin));
 for(const key of ['recoveryToken','setupToken','sourceRecoveryToken'])assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,[key]:proof}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,origin:'https://38.207.178.31'}),origin),(error:any)=>error.code==='different_origin');
 const withClaim={...source,claimContext:{agentId:'agent_target_01',generation:3,handoffToken:proof}};
 assert.deepEqual(parseOwnerBackup(JSON.stringify(withClaim),origin).claimContext,withClaim.claimContext);
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...withClaim,claimContext:{...withClaim.claimContext,generation:0}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...withClaim,claimContext:{...withClaim.claimContext,setupToken:session}}),origin));
});

test('new account progress preserves exact registration input and cannot substitute a different owner attempt',()=>{
 const source={format:'connet-owner-v2',origin,ownerId,sessionToken:session,recoveryToken:recovery,pendingOperation:pending('registerOwner',`owner-registration:${ownerId}`,{attemptId:ownerId,username:'Owner_01',email:'owner@example.test'})};
 const parsed=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(parsed.pendingOperation.input.attemptId,ownerId);assert.equal(parsed.recoveryToken,recovery);
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,input:{...source.pendingOperation.input,attemptId:'37125e07-07d5-470b-a701-2b786067ab57'}}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,recoveryToken:undefined}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,scope:`owner:${ownerId}`}}),origin));
 for(const fields of [{username:' Owner_01 '},{username:'Ｏｗｎｅｒ_01'},{username:123},{email:' owner@example.test '},{email:123}]){
  assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,input:{...source.pendingOperation.input,...fields}}}),origin));
 }
});

test('new Agent claim progress pins owner, target, generation and one private capability',()=>{
 const claim={format:'connet-owner-v2',origin,ownerId,sessionToken:session,claimContext:{agentId:'agent_target_01',generation:3,handoffToken:proof},pendingOperation:pending('claimAgent',`owner:${ownerId}`,{agentId:'agent_target_01',expectedGeneration:3})};
 const parsed=parseOwnerBackup(JSON.stringify(claim),origin);
 assert.equal(parsed.claimContext.agentId,'agent_target_01');assert.equal(parsed.claimContext.handoffToken,proof);
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...claim,claimContext:{...claim.claimContext,agentId:'different_agent'}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...claim,claimContext:{...claim.claimContext,generation:4}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...claim,claimContext:{...claim.claimContext,setupToken:session}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...claim,claimContext:{agentId:'agent_target_01',generation:3}}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...claim,sessionToken:undefined}),origin));
});

test('imported progress never supplies an executable arbitrary action or request destination',()=>{
 const source={format:'connet-owner-v2',origin,sessionToken:session,pendingOperation:{...pending('login','owner-login:session_identifier',{identifier:'owner_01'}),path:'https://untrusted.invalid/upload',method:'DELETE',kind:'runtime'}};
 const parsed=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(parsed.pendingOperation.path,undefined);assert.equal(parsed.pendingOperation.method,undefined);
 assert.notEqual(parsed.pendingOperation.kind,'runtime');
 assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,pendingOperation:{...source.pendingOperation,action:'completeAccount'}}),origin));
});

test('unfinished setup exchange preserves its exact target and proofs without importing a request destination',()=>{
 const setupToken='setup_identifier.'+'t'.repeat(43);
 const exchange={operationId:'exchange_operation_01',ownerId,agentId:'agent_target_01',generation:3,handoffToken:proof,setupToken};
 const source={format:'connet-owner-v2',origin,ownerId,setupToken,setupExchange:exchange};
 assert.deepEqual(parseOwnerBackup(JSON.stringify(source),origin).setupExchange,exchange);
 for(const fields of [{ownerId:'different_owner'},{agentId:'short'},{operationId:'short'},{generation:0},{generation:1.5},{generation:Number.MAX_SAFE_INTEGER+1},{handoffToken:'invalid'},{setupToken:session}]){
  assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,setupExchange:{...exchange,...fields}}),origin));
 }
 for(const claimContext of [
  {agentId:exchange.agentId,generation:3,handoffToken:proof},
  {agentId:exchange.agentId,generation:3,setupToken},
 ])assert.deepEqual(parseOwnerBackup(JSON.stringify({...source,claimContext}),origin).setupExchange,exchange);
 for(const claimContext of [
  {agentId:'different_agent',generation:3,handoffToken:proof},
  {agentId:exchange.agentId,generation:4,handoffToken:proof},
  {agentId:exchange.agentId,generation:3,handoffToken:session},
  {agentId:exchange.agentId,generation:3,setupToken:session},
 ])assert.throws(()=>parseOwnerBackup(JSON.stringify({...source,claimContext}),origin));
 const imported=parseOwnerBackup(JSON.stringify({...source,setupExchange:{...exchange,path:'https://untrusted.invalid/upload',method:'DELETE'}}),origin);
 assert.equal(imported.setupExchange.path,undefined);assert.equal(imported.setupExchange.method,undefined);
 const loginOnly={format:'connet-owner-v2',origin,sessionToken:session,pendingOperation:pending('login','owner-login:session_identifier',{identifier:'owner_01'}),setupExchange:exchange};
 assert.throws(()=>parseOwnerBackup(JSON.stringify(loginOnly),origin));
});


test('new owner format rejects legacy owner material and non-UUID account metadata',()=>{
 for(const format of ['connet-owner-v1','connet-owner-pending-v1'])assert.throws(()=>parseOwnerBackup(JSON.stringify({format,origin,ownerId,sessionToken:session}),origin));
 assert.throws(()=>parseOwnerBackup(JSON.stringify({format:'connet-owner-v2',origin,ownerId:'owner_legacy',sessionToken:session}),origin));
});

test('new account recovery retains successor proofs and the original command without importing a password',()=>{
 const source={format:'connet-owner-v2',origin,ownerId,sessionToken:session,recoveryToken:recovery,sourceRecoveryToken:proof,password:'must-not-import',pendingOperation:pending('recover',`owner:${ownerId}`)};
 const parsed=parseOwnerBackup(JSON.stringify(source),origin);
 assert.equal(parsed.sourceRecoveryToken,proof);assert.equal(parsed.recoveryToken,recovery);assert.equal(parsed.password,undefined);
 assert.equal(parsed.pendingOperation.scope,`owner:${ownerId}`);
});
