import { RuntimeError, type CommandKey, type CommandReceipt, type RuntimeEvent, type RuntimeEventDraft, type RuntimeReadContext, type RuntimeStore, type RuntimeTask, type RuntimeTaskDraft, type RuntimeTransaction, type WorkLease, type OutboxEntry, type OutboxDraft, type RuntimeRepositoryPort } from '../../apps/platform/contracts/runtime-store.ts';
import type { AgentParticipation, IdentityAccess, Principal } from '../../apps/platform/domains/access/public.ts';
import type { WorldAvatar, WorldMovement, WorldRuleset, WorldState } from '../../apps/platform/domains/world/types.ts';
import type { WorldRepository } from '../../apps/platform/domains/world/repository.ts';
import type { InteractionRepository } from '../../apps/platform/domains/interaction/repository.ts';
import type { ArtifactRevision, FeedbackActivity, FeedbackConfiguration, FeedbackContribution, InteractionInvitation, InteractionPairPolicy } from '../../apps/platform/domains/interaction/types.ts';
import type { DecisionIntentSink } from '../../apps/platform/domains/decision/public.ts';
import type { DecisionIntent } from '../../apps/platform/domains/decision/repository.ts';
import { fail } from '../../apps/platform/domains/common/errors.ts';

const copy = <T>(value: T): T => structuredClone(value);
const keyOf = (key: CommandKey) => JSON.stringify(key);
const pairKey = (a: string, b: string) => JSON.stringify([a, b]);
interface State {
  movements: Map<string, WorldMovement>; worlds: Map<string, WorldState>; rules: Map<string, WorldRuleset>; avatars: Map<string, WorldAvatar>;
  configs: Map<number, FeedbackConfiguration>; artifacts: Map<string, ArtifactRevision>; pairs: Map<string, InteractionPairPolicy>;
  invitations: Map<string, InteractionInvitation>; activities: Map<string, FeedbackActivity>; feedback: Map<string, FeedbackContribution>;
  receipts: Map<string, CommandReceipt>; events: RuntimeEvent[]; outbox: Map<string, OutboxEntry>; tasks: Map<string, RuntimeTask>; generations: Map<string, number>;
  decisions: Map<string, DecisionIntent>; participants: Map<string, AgentParticipation>;
}
/** Pure in-memory public-port fixture. It verifies C business logic, not PostgreSQL locks or A credential authentication. */
export function coreFixture() {
  let stamp = 1_000_000, state: State = { movements: new Map(), worlds: new Map(), rules: new Map(), avatars: new Map(), configs: new Map(), artifacts: new Map(), pairs: new Map(),
    invitations: new Map(), activities: new Map(), feedback: new Map(), receipts: new Map(), events: [], outbox: new Map(), tasks: new Map(), generations: new Map(), decisions: new Map(), participants: new Map() };
  let failAt = '';
  function fault(at: string) { if (failAt === at) throw new Error('injected storage failure: ' + at); }
  function save<T extends { version: number }>(map: Map<string, T>, id: string, next: T, expected: number | null) {
    const old = map.get(id); if (expected === null ? old !== undefined : old?.version !== expected) throw new RuntimeError('version_conflict', 'CAS failed'); map.set(id, copy(next));
  }
  const world: WorldRepository = {
    async initialize(w, r) { if (!state.worlds.has(w.worldId)) { state.worlds.set(w.worldId, copy(w)); state.rules.set(w.worldId + ':' + r.version, copy(r)); } },
    async getWorld(id) { return copy(state.worlds.get(id)); }, async lockWorld(id) { return copy(state.worlds.get(id)); },
    async getRuleset(id, v) { return copy(state.rules.get(id + ':' + v)); },
    async advanceRevision(id, expected) { const old = state.worlds.get(id); if (!old || old.revision !== expected) throw new RuntimeError('version_conflict', 'World changed'); old.revision++; return old.revision; },
    async getAvatar(w, a) { return copy(state.avatars.get(pairKey(w, a))); },
    async saveAvatar(a, expected) { fault('avatar'); save(state.avatars, pairKey(a.worldId, a.agentId), a, expected); },
    async getMovement(id) { return copy(state.movements.get(id)); }, async getActiveMovement(w,a) { return copy([...state.movements.values()].find(m=>m.worldId===w&&m.agentId===a&&['pending','running'].includes(m.state))); },
    async saveMovement(m,expected) { fault('movement'); save(state.movements,m.id,m,expected); },
    async countAtPlace(w, p, excluding) { return [...state.avatars.values()].filter(a => a.worldId === w && a.placeId === p && a.agentId !== excluding && a.status !== 'left').length; },
    async listAvatars(w, o) { return copy([...state.avatars.values()].filter(a => a.worldId === w && a.status !== 'left' && (!o.afterAgentId || a.agentId > o.afterAgentId)).sort((a,b) => a.agentId.localeCompare(b.agentId)).slice(0,o.limit)); },
  };
  const interaction: InteractionRepository = {
    async initializeConfiguration(c) { if (!state.configs.has(c.configVersion)) state.configs.set(c.configVersion, copy(c)); }, async getConfiguration(v) { return copy(state.configs.get(v)); },
    async getArtifact(r) { return copy(state.artifacts.get(pairKey(r.artifactId, String(r.revision)))); },
    async saveArtifact(a, expected) { save(state.artifacts, pairKey(a.artifactId, String(a.revision)), a, expected); },
    async lockPair(a,b) { const id = pairKey(a,b); if (!state.pairs.has(id)) state.pairs.set(id, { firstAgentId:a,secondAgentId:b,version:1,blockedByAgentIds:[],sharedGeneration:0,updatedAt:stamp }); return copy(state.pairs.get(id)!); },
    async getPair(a,b) { return copy(state.pairs.get(pairKey(a,b))); }, async savePair(p, expected) { save(state.pairs,pairKey(p.firstAgentId,p.secondAgentId),p,expected); },
    async getInvitation(id) { return copy(state.invitations.get(id)); }, async saveInvitation(i, expected) { fault('invitation'); save(state.invitations,i.id,i,expected); },
    async findActiveInvitation(w,a,b,r,g,pg) { return copy([...state.invitations.values()].find(i => i.worldId === w && i.fromAgentId === a && i.toAgentId === b && i.artifact.artifactId === r.artifactId && i.artifact.revision === r.revision && i.sharedGeneration === g && i.participantGenerations.from === pg.from && i.participantGenerations.to === pg.to && (i.state === 'pending' || i.state === 'accepted' && [...state.activities.values()].some(s => s.invitationId === i.id && ['waiting_feedback','waiting_ack'].includes(s.state))))); },
    async getActivity(id) { return copy(state.activities.get(id)); }, async getActivityByInvitation(id) { return copy([...state.activities.values()].find(a => a.invitationId === id)); },
    async saveActivity(a, expected) { fault('activity'); save(state.activities,a.id,a,expected); }, async getFeedback(id) { return copy(state.feedback.get(id)); }, async saveFeedback(f, expected) { save(state.feedback,f.id,f,expected); },
    async listInvitations(a,o) { return copy([...state.invitations.values()].filter(i => [i.fromAgentId,i.toAgentId].includes(a) && (!o.afterId || i.id > o.afterId)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,o.limit)); },
  };
  const context: RuntimeTransaction = {
    instanceId:'world-core-c-unit', recoveryEpoch:'epoch-c', now:()=>stamp,
    repository<R,W extends R>(port: RuntimeRepositoryPort<R,W>): W { if (port.name === 'world') return world as W; if (port.name === 'interaction') return interaction as W; throw new Error('Unknown repository'); },
    async attempt(work) { const before = copy(state); try { return await work(context); } catch (error) { state = before; throw error; } },
    commands: { async get(key) { return copy(state.receipts.get(keyOf(key))); }, async insert(r) { fault('receipt'); if (state.receipts.has(keyOf(r.key))) throw new RuntimeError('command_conflict','Duplicate receipt'); state.receipts.set(keyOf(r.key),copy(r)); } },
    events: { async append(e: RuntimeEventDraft) { fault('event'); const event = {...copy(e),position:state.events.length+1,committedAt:stamp}; state.events.push(event); return copy(event); }, async get(id) { return copy(state.events.find(e=>e.eventId===id)); }, async list(o) { return copy(state.events.filter(e=>(!o.domain||e.domain===o.domain)&&(!o.subjectId||e.subject.id===o.subjectId)&&(!o.worldId||e.worldId===o.worldId)&&(!o.afterPosition||e.position>o.afterPosition)).slice(0,o.limit)); } },
    tasks: {
      async currentGeneration(d) { return state.generations.get(d)??0; }, async advanceGeneration(d,expected) { const old=state.generations.get(d)??0;if(old!==expected)throw new RuntimeError('version_conflict','Generation changed');state.generations.set(d,old+1);return old+1; },
      async schedule(t: RuntimeTaskDraft) { fault('task'); const existing=[...state.tasks.values()].find(x=>x.domain===t.domain&&x.dedupeKey===t.dedupeKey);if(existing)return copy(existing);const task:RuntimeTask={...copy(t),version:1,state:'pending',attempts:0,fence:0,lease:null,lastErrorCode:null,completedAt:null};state.tasks.set(t.taskId,task);return copy(task); },
      async get(id) { return copy(state.tasks.get(id)); }, async list(o) { return copy([...state.tasks.values()].filter(t=>(!o.domain||t.domain===o.domain)&&(!o.targetId||t.target.id===o.targetId)&&(!o.state||t.state===o.state)&&(!o.afterId||t.taskId>o.afterId)).slice(0,o.limit)); },
      async claimDue(o) { const tasks=[...state.tasks.values()].filter(t=>t.dueAt<=o.now&&(!o.kinds||o.kinds.includes(t.kind))&&(t.state==='pending'||t.state==='leased'&&t.lease!.expiresAt<=o.now)).slice(0,o.limit);for(const t of tasks){t.fence++;t.state='leased';t.attempts++;t.lease={id:t.taskId,token:t.taskId+':'+t.fence,workerId:o.workerId,fence:t.fence,generation:t.generation,expiresAt:o.now+o.leaseMs};}return copy(tasks); },
      async assertLease(l,now) { const t=state.tasks.get(l.id); if(!t||t.state!=='leased'||t.lease?.token!==l.token||t.fence!==l.fence||l.generation!==(state.generations.get(t.domain)??0)||now>=l.expiresAt)throw new RuntimeError('lease_lost','Lease lost');return copy(t); },
      async complete(l,now) { await context.tasks.assertLease(l,now);const t=state.tasks.get(l.id)!;t.state='completed';t.completedAt=now;t.lease=null;t.version++; },
      async retry(l,o) { await context.tasks.assertLease(l,o.now);const t=state.tasks.get(l.id)!;t.state='pending';t.dueAt=o.dueAt;t.lease=null;t.lastErrorCode=o.errorCode; },
      async cancel(id,v,now) { const t=state.tasks.get(id);if(!t||t.version!==v)return false;t.state='cancelled';t.completedAt=now;t.lease=null;t.version++;return true; },
    },
    outbox: { async enqueue(e: OutboxDraft) { fault('outbox'); const row:OutboxEntry={...copy(e),version:1,state:'pending',attempts:0,fence:0,lease:null,lastErrorCode:null,completedAt:null};state.outbox.set(e.outboxId,row);return copy(row); }, async get(id){return copy(state.outbox.get(id));},async list(o){return copy([...state.outbox.values()].filter(x=>(!o.consumerId||x.consumerId===o.consumerId)&&(!o.state||x.state===o.state)&&(!o.afterId||x.outboxId>o.afterId)).slice(0,o.limit));},async claimDue(){return[];},async assertLease(){throw new RuntimeError('lease_lost','Not implemented in C fixture');},async complete(){throw new Error('Not used');},async retry(){throw new Error('Not used');},async cancel(){return false;} },
  };
  const store: RuntimeStore = { instanceId:context.instanceId,recoveryEpoch:context.recoveryEpoch,async read(work){return work(context);},async transaction(work){const before=copy(state);try{return await work(context);}catch(error){state=before;throw error;}},async close(){} };
  const identity: IdentityAccess<RuntimeReadContext> = { async authenticate(){throw new Error('No credentials used in C pure tests');},async authorizeAgent(_context,p,id){if(p.expiresAt!==null&&p.expiresAt<=stamp||!state.participants.get(id)?.runtimeActive||p.kind==='agent'&&p.agentId!==id||p.kind==='owner'&&p.ownerId!=='owner-'+id)fail('insufficient_scope',403,'Not authorized');return {agentId:id,authorizationVersion:p.authorizationVersion,binding:p.kind==='owner'?{id:'binding',version:1}:null};},async readParticipation(_context,id){const p=state.participants.get(id);if(!p)fail('target_not_accessible',404,'Target is not accessible');return copy(p);} };
  const decisions: DecisionIntentSink = {async ensure(_ctx,intent){fault('decision');const id=intent.agentId+':'+intent.deduplicationKey;state.decisions.set(id,copy(intent));return {decisionId:id,version:1};},async cancel(_ctx,id,key){state.decisions.delete(id+':'+key);} };
  function addAgent(id:string):Principal {state.participants.set(id,{agentId:id,runtimeActive:true,runtimeVersion:1,membership:{worldId:'default',version:1,state:'joined',ownerPaused:false,ownerPauseVersion:1,platformRestricted:false,platformVersion:1,sharingGeneration:1}});return {kind:'agent',agentId:id,runtimeVersion:1,source:'external_agent',credentialId:'credential-'+id,credentialVersion:1,recoveryEpoch:context.recoveryEpoch,authorizationVersion:'auth-'+id,expiresAt:null};}
  let command=0;
  return {store,context,world,interaction,identity,decisions,addAgent, membership(id:string,patch:Partial<AgentParticipation['membership']>){const old=state.participants.get(id)!;state.participants.set(id,{...old,membership:{...old.membership,...patch}});},get state(){return state;},get now(){return stamp;},set now(value:number){stamp=value;},set failAt(value:string){failAt=value;},key(p:Principal,action:string,id='c-'+(++command)):CommandKey{return{domain:action.startsWith('world.')?'world':'interaction',action,commandId:id,principal:{kind:p.kind,id:p.kind==='agent'?p.agentId:p.ownerId},recoveryEpoch:context.recoveryEpoch};}};
}
