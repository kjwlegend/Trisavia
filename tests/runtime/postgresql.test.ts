import assert from 'node:assert/strict';
import test from 'node:test';
import { worldFixture } from './postgresql-fixture.ts';
import { WORLD_REPOSITORY } from '../../apps/platform/domains/world/repository.ts';
import { DEFAULT_WORLD_RULES } from '../../apps/platform/domains/world/rules.ts';
import { INTERACTION_REPOSITORY } from '../../apps/platform/domains/interaction/repository.ts';
import { TEXT_FEEDBACK_V1 } from '../../apps/platform/domains/interaction/types.ts';
import { commitRuntimeCommandIn, hashRuntimeRequest } from '../../apps/platform/domains/runtime/command.ts';
import { RuntimeError, type RuntimeTransaction, type RuntimeReadContext, type CommandKey } from '../../apps/platform/contracts/runtime-store.ts';
import { StorageError } from '../../apps/platform/contracts/store.ts';
const code=(value:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===value);
async function initialize(f:Awaited<ReturnType<typeof worldFixture>>){await f.runtime.transaction(async ctx=>{await ctx.repository(WORLD_REPOSITORY).initialize({worldId:'default',active:true,rulesetVersion:1,revision:1},structuredClone(DEFAULT_WORLD_RULES));await ctx.repository(INTERACTION_REPOSITORY).initializeConfiguration({...TEXT_FEEDBACK_V1});for(const domain of ['world','interaction','decision'])await ctx.tasks.advanceGeneration(domain,0);});}
test('least-role real registration/identity and logical World persist; read cast and ended handles cannot write',async t=>{
 const f=await worldFixture();t.after(f.dispose);await initialize(f);const agent=await f.register();
 const stored=await f.runtime.transaction(async ctx=>{const principal=await f.access.authenticate(ctx,agent.runtimeToken,['runtime']);assert.equal(principal.kind,'agent');const participation=await f.access.readParticipation(ctx,agent.agentId);assert.equal(participation.membership.sharingGeneration,1);const world=ctx.repository(WORLD_REPOSITORY);await world.lockWorld('default');await world.saveAvatar({id:'avatar-a',worldId:'default',agentId:agent.agentId,version:1,status:'idle',position:{x:0,y:0},placeId:'commons',rulesetVersion:1,createdAt:ctx.now(),updatedAt:ctx.now()},null);return world;});
 await assert.rejects(stored.getAvatar('default',agent.agentId),code('closed'));
 await f.runtime.read(async ctx=>{const repo=ctx.repository(WORLD_REPOSITORY);assert.equal((await repo.getAvatar('default',agent.agentId))?.version,1);await assert.rejects(async()=>{await (ctx as RuntimeTransaction).repository(WORLD_REPOSITORY).saveAvatar({} as never,null);});await assert.rejects(async()=>{await (ctx as RuntimeTransaction).tasks.advanceGeneration('world',1);});});
 await f.runtime.close();const reopened=await f.openRuntime();assert.equal(await reopened.read(async ctx=>(await ctx.repository(WORLD_REPOSITORY).getAvatar('default',agent.agentId))?.position.x),0);
 for(const sql of ['CREATE TABLE world.forbidden(id integer)','UPDATE platform.instance_state SET writes_enabled=false','UPDATE platform.instance_state SET recovery_epoch=\'bad\'','DELETE FROM platform.module_migrations'])await assert.rejects(f.appQuery(sql),code('42501'));
});
test('same-context savepoint rollback saves business rejection without partial events; current authentication gates replay',async t=>{
 const f=await worldFixture();t.after(f.dispose);await initialize(f);const agent=await f.register();const key:CommandKey={domain:'world',action:'test',commandId:'once',principal:{kind:'agent',id:agent.agentId},recoveryEpoch:f.identity.recoveryEpoch};
 const options={key,requestHash:hashRuntimeRequest({one:1}),authorize:async(ctx:RuntimeTransaction)=>{await f.access.authenticate(ctx,agent.runtimeToken,['runtime']);},handle:async(ctx:RuntimeTransaction)=>{await ctx.events.append({eventId:'rolled-back',domain:'world',kind:'test',schemaVersion:1,subject:{type:'avatar',id:'a',version:1},actor:key.principal,source:'external_agent',occurredAt:ctx.now(),causationId:'once',correlationId:'once',audience:{kind:'agents' as const,agentIds:[agent.agentId]},payload:{}});throw new RuntimeError('version_conflict','business');},classifyRejection:(error:unknown)=>error instanceof RuntimeError?{outcome:'rejected' as const,result:{code:error.code}}:undefined};
 assert.equal((await f.runtime.transaction(ctx=>commitRuntimeCommandIn(ctx,options))).outcome,'rejected');assert.equal(await f.runtime.read(ctx=>ctx.events.get('rolled-back')),undefined);
 assert.equal((await f.runtime.transaction(ctx=>commitRuntimeCommandIn(ctx,options))).outcome,'rejected');
 await f.legacy.transaction(async tx=>{const credential=(await tx.find('credentials',{agentId:agent.agentId,kind:'runtime'}))[0]!;await tx.update('credentials',{...credential,version:credential.version+1,data:{...credential.data,active:false}},credential.version);});
 await assert.rejects(f.runtime.transaction(ctx=>commitRuntimeCommandIn(ctx,options)),code('authentication_failed'));
});
