import { RuntimeError } from '../../contracts/runtime-store.ts';
import { RELATIONSHIPS_REPOSITORY, type RelationshipsReader, type RelationshipsRepository } from '../../domains/relationships/runtime-repository.ts';
import type { Friendship, FriendshipInvitation } from '../../domains/relationships/types.ts';
import { canonicalFriendshipPair } from '../../domains/relationships/transitions.ts';
import {relationshipOrder,relationshipSearch,relationshipState,type RelationshipPage} from '../../domains/relationships/queries.ts';
import { hashRuntimeRequest } from '../../domains/runtime/command.ts';
import type { JsonObject } from '../../contracts/store.ts';
import { checkVersion, integer, number, text, type RuntimeSql } from './runtime-sql.ts';

type Row = Record<string, any>;
const millis = (value: unknown) => integer(value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value)));
const date = (value: number) => new Date(integer(value));
const friendship = (row: Row): Friendship => ({ id: row.id, version: number(row.version), firstAgentId: row.first_agent_id, secondAgentId: row.second_agent_id, status: row.status, confirmedAt: millis(row.confirmed_at), firstConfirmationId: row.first_confirmation_id, secondConfirmationId: row.second_confirmation_id, intimacyScore: number(row.intimacy_score) });
const invitation = (row: Row): FriendshipInvitation => ({ id: row.id, version: number(row.version), fromAgentId: row.from_agent_id, toAgentId: row.to_agent_id, message: row.message, state: row.state, createdAt: millis(row.created_at), deadline: millis(row.deadline), respondedAt: row.responded_at === null ? null : millis(row.responded_at), friendshipId: row.friendship_id,
  sentBy: { kind: row.sender_actor_kind, id: row.sender_actor_id }, respondedBy: row.response_actor_kind === null ? null : { kind: row.response_actor_kind, id: row.response_actor_id }, senderConfirmationId: row.sender_confirmation_id, responseConfirmationId: row.response_confirmation_id, invalidationCode: row.invalidation_code,
  sharedGeneration: number(row.shared_generation), participantGenerations: { from: number(row.from_sharing_generation), to: number(row.to_sharing_generation) } });
const fixedHash = (value: object, mutable: string[]) => hashRuntimeRequest(Object.fromEntries(Object.entries(value).filter(([key]) => !mutable.includes(key))) as JsonObject);
const relationFields = ['firstAgentId', 'secondAgentId', 'status', 'confirmedAt', 'firstConfirmationId', 'secondConfirmationId', 'intimacyScore'];
const invitationFields = ['fromAgentId', 'toAgentId', 'message', 'state', 'createdAt', 'deadline', 'respondedAt', 'friendshipId', 'senderActorKind', 'senderActorId', 'responseActorKind', 'responseActorId', 'senderConfirmationId', 'responseConfirmationId', 'invalidationCode', 'sharedGeneration', 'fromSharingGeneration', 'toSharingGeneration'];

function seek(input:RelationshipPage,column:'confirmed_at'|'created_at'){
  integer(input.limit,1,100);const search=relationshipSearch(input.search);
  if(input.after&&(!input.order||input.afterId!==undefined))throw new RuntimeError('invalid_usage','Time seek requires one explicit order');
  const direction=input.order===undefined?'ASC':relationshipOrder(input.order)==='newest'?'DESC':'ASC',comparison=direction==='DESC'?'<':'>';
  return {search,order:input.order===undefined?'r.id COLLATE "C" ASC':`r.${column} ${direction},r.id COLLATE "C" ${direction}`,
    condition:`($2::text IS NULL OR r.id>$2 COLLATE "C") AND ($4::timestamptz IS NULL OR (r.${column},r.id COLLATE "C")${comparison}($4::timestamptz,$5::text COLLATE "C"))`,
    values:[input.afterId===undefined?null:text(input.afterId),input.limit,input.after?date(input.after.at):null,input.after?text(input.after.id):null,search]};
}
// This is a candidate restriction, never an authorization join. The application
// reuses the public identity and relationship source guards before projecting/counting.
const profileJoin=(other:string)=>`LEFT JOIN profiles.agent_profiles p ON p.agent_id=${other} LEFT JOIN profiles.profile_contents pc ON pc.parent_id=p.id AND pc.stage='published'`;
const nameMatch=(other:string)=>`($6::text='' OR strpos(lower(${other}),$6)>0 OR strpos(lower(pc.display_name),$6)>0)`;

export function createRelationshipsRepository(sql: RuntimeSql): { port: typeof RELATIONSHIPS_REPOSITORY; reader: RelationshipsReader; writer: RelationshipsRepository } {
  const repo: RelationshipsRepository = {
    async lockPair(a, b) { sql.writable(); const pair = canonicalFriendshipPair(a, b); await sql.mutate('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['relationships', ...pair])]); },
    async getFriendship(id) { const row = (await sql.query('SELECT * FROM relationships.friendships WHERE id=$1', [text(id)]))[0]; return row ? friendship(row) : undefined; },
    async getFriendshipForPair(a, b) { const row = (await sql.query('SELECT * FROM relationships.friendships WHERE first_agent_id=$1 AND second_agent_id=$2', canonicalFriendshipPair(a, b)))[0]; return row ? friendship(row) : undefined; },
    async getPendingInvitation(a, b) { const row = (await sql.query("SELECT * FROM relationships.friendship_invitations WHERE first_agent_id=$1 AND second_agent_id=$2 AND state='pending'", canonicalFriendshipPair(a, b)))[0]; return row ? invitation(row) : undefined; },
    async getInvitation(id) { const row = (await sql.query('SELECT * FROM relationships.friendship_invitations WHERE id=$1', [text(id)]))[0]; return row ? invitation(row) : undefined; },
    async saveInvitation(value, expected) {
      sql.writable(); checkVersion(value.version, expected); canonicalFriendshipPair(value.fromAgentId, value.toAgentId);
      if (typeof value.message !== 'string' || [...value.message].length > 120 || value.message.includes('\0')) throw new RuntimeError('invalid_usage', 'Invalid fixed friendship message');
      integer(value.sharedGeneration); integer(value.participantGenerations.from, 1); integer(value.participantGenerations.to, 1);
      const nullable: Record<string, unknown> = { respondedAt: value.respondedAt, friendshipId: value.friendshipId, responseActorKind: value.respondedBy?.kind ?? null, responseActorId: value.respondedBy?.id ?? null, responseConfirmationId: value.responseConfirmationId, invalidationCode: value.invalidationCode };
      const nulls = Object.keys(nullable).filter(key => nullable[key] === null);
      if (expected === null) {
        await sql.mutate(`INSERT INTO relationships.friendship_invitations(id,version,_present,_nulls,from_agent_id,to_agent_id,message,state,created_at,deadline,responded_at,friendship_id,sender_actor_kind,sender_actor_id,response_actor_kind,response_actor_id,sender_confirmation_id,response_confirmation_id,invalidation_code,shared_generation,from_sharing_generation,to_sharing_generation) VALUES(${Array.from({ length: 22 }, (_, index) => '$' + (index + 1)).join(',')})`,
          [text(value.id), value.version, invitationFields, nulls, text(value.fromAgentId), text(value.toAgentId), value.message, value.state, date(value.createdAt), date(value.deadline), value.respondedAt === null ? null : date(value.respondedAt), value.friendshipId, value.sentBy.kind, text(value.sentBy.id), value.respondedBy?.kind ?? null, value.respondedBy?.id ?? null, text(value.senderConfirmationId), value.responseConfirmationId, value.invalidationCode, value.sharedGeneration, value.participantGenerations.from, value.participantGenerations.to]);
      } else {
        const old = await repo.getInvitation(value.id);
        const mutable = ['version', 'state', 'respondedAt', 'respondedBy', 'responseConfirmationId', 'friendshipId', 'invalidationCode'];
        if (!old || fixedHash(old, mutable) !== fixedHash(value, mutable)) throw new RuntimeError('invalid_usage', 'Fixed friendship invitation changed');
        await sql.cas('UPDATE relationships.friendship_invitations SET version=$2,state=$3,responded_at=$4,friendship_id=$5,response_actor_kind=$6,response_actor_id=$7,response_confirmation_id=$8,invalidation_code=$9,_nulls=$10 WHERE id=$1 AND version=$11 RETURNING id', [text(value.id), value.version, value.state, value.respondedAt === null ? null : date(value.respondedAt), value.friendshipId, value.respondedBy?.kind ?? null, value.respondedBy?.id ?? null, value.responseConfirmationId, value.invalidationCode, nulls, expected]);
      }
    },
    async saveFriendship(value, expected) {
      sql.writable(); checkVersion(value.version, expected); const pair = canonicalFriendshipPair(value.firstAgentId, value.secondAgentId);
      if (pair[0] !== value.firstAgentId) throw new RuntimeError('invalid_usage', 'Friendship pair must be canonical'); integer(value.intimacyScore, 0, 100);
      if (expected === null) {
        if (value.intimacyScore !== 0 || value.status !== 'confirmed') throw new RuntimeError('invalid_usage', 'A new friendship begins confirmed at zero');
        await sql.mutate('INSERT INTO relationships.friendships(id,version,_present,_nulls,first_agent_id,second_agent_id,status,confirmed_at,first_confirmation_id,second_confirmation_id,intimacy_score) VALUES($1,$2,$3,ARRAY[]::text[],$4,$5,$6,$7,$8,$9,$10)', [text(value.id), value.version, relationFields, ...pair, value.status, date(value.confirmedAt), text(value.firstConfirmationId, 1024), text(value.secondConfirmationId, 1024), value.intimacyScore]);
      } else {
        const old = await repo.getFriendship(value.id); if (!old || fixedHash(old, ['version', 'intimacyScore']) !== fixedHash(value, ['version', 'intimacyScore'])) throw new RuntimeError('invalid_usage', 'Confirmed friendship identity is frozen');
        await sql.cas('UPDATE relationships.friendships SET version=$2,intimacy_score=$3 WHERE id=$1 AND version=$4 RETURNING id', [text(value.id), value.version, value.intimacyScore, expected]);
      }
    },
    async listInvitations(agentId, input) {
      const page=seek(input,'created_at');if (input.direction !== undefined && !['incoming', 'outgoing'].includes(input.direction)) throw new RuntimeError('invalid_usage', 'Invalid friendship direction');
      const state=relationshipState(input.state),asOf=input.asOf===undefined?sql.now():integer(input.asOf);
      const scope = input.direction === 'incoming' ? 'r.to_agent_id=$1' : input.direction === 'outgoing' ? 'r.from_agent_id=$1' : '(r.from_agent_id=$1 OR r.to_agent_id=$1)';
      const other='(CASE WHEN r.from_agent_id=$1 THEN r.to_agent_id ELSE r.from_agent_id END)';
      return (await sql.query(`SELECT r.* FROM relationships.friendship_invitations r ${profileJoin(other)} WHERE ${scope} AND ${page.condition} AND ${nameMatch(other)} AND ($7::text IS NULL OR (CASE WHEN r.state='pending' AND r.deadline<=$8 THEN 'expired' ELSE r.state END)=$7) ORDER BY ${page.order} LIMIT $3`,[text(agentId),...page.values,state??null,date(asOf)])).map(invitation);
    },
    async listConfirmed(agentId, input) {
      const page=seek(input,'confirmed_at'),other='(CASE WHEN r.first_agent_id=$1 THEN r.second_agent_id ELSE r.first_agent_id END)';
      return (await sql.query(`SELECT r.* FROM relationships.friendships r ${profileJoin(other)} WHERE (r.first_agent_id=$1 OR r.second_agent_id=$1) AND r.status='confirmed' AND ${page.condition} AND ${nameMatch(other)} ORDER BY ${page.order} LIMIT $3`,[text(agentId),...page.values])).map(friendship);
    },
    async recordCompletedFeedback(fact) {
      sql.writable(); integer(fact.invitationCreatedAt); integer(fact.completedAt, fact.invitationCreatedAt); text(fact.activityId);
      await repo.lockPair(fact.fromAgentId, fact.toAgentId);
      const pair = canonicalFriendshipPair(fact.fromAgentId, fact.toAgentId), row = (await sql.mutate('SELECT * FROM relationships.friendships WHERE first_agent_id=$1 AND second_agent_id=$2 FOR UPDATE', pair))[0];
      if (!row) return { changed: false, friendship: null };
      const current = friendship(row); if (current.status !== 'confirmed' || fact.invitationCreatedAt <= current.confirmedAt) return { changed: false, friendship: current };
      const prior = (await sql.query("SELECT * FROM relationships.intimacy_facts WHERE friendship_id=$1 AND source_domain='interaction' AND source_id=$2 AND score_kind='text_feedback_completed'", [current.id, fact.activityId]))[0];
      if (prior) {
        if (prior.from_agent_id !== fact.fromAgentId || prior.to_agent_id !== fact.toAgentId || millis(prior.invitation_created_at) !== fact.invitationCreatedAt || millis(prior.completed_at) !== fact.completedAt) throw new RuntimeError('command_conflict', 'The completed source fact changed');
        return { changed: false, friendship: current };
      }
      const delta = current.intimacyScore < 100 ? 1 : 0;
      await sql.mutate("INSERT INTO relationships.intimacy_facts(friendship_id,source_domain,source_id,score_kind,from_agent_id,to_agent_id,invitation_created_at,completed_at,delta) VALUES($1,'interaction',$2,'text_feedback_completed',$3,$4,$5,$6,$7)", [current.id, fact.activityId, text(fact.fromAgentId), text(fact.toAgentId), date(fact.invitationCreatedAt), date(fact.completedAt), delta]);
      if (!delta) return { changed: false, friendship: current };
      const next = { ...current, version: current.version + 1, intimacyScore: current.intimacyScore + 1 }; await repo.saveFriendship(next, current.version); return { changed: true, friendship: next };
    }
  };
  const { lockPair: _lock, saveInvitation: _invitation, saveFriendship: _friendship, recordCompletedFeedback: _score, ...reader } = repo;
  return { port: RELATIONSHIPS_REPOSITORY, reader, writer: repo };
}
