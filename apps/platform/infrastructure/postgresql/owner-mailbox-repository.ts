import {OWNER_MAILBOX_CANDIDATES,type OwnerMailboxCandidates,type OwnerMailboxCandidate} from '../../application/owner-mailbox-service.ts';
import type {RuntimeSql} from './runtime-sql.ts';
import {integer,text,number} from './runtime-sql.ts';

// Fixed internal source union. The Owner-facing service still reopens every ref through its source guard.
// No body, intent, feedback text, attachment or arbitrary table/filter reaches this port.
const publicRows=(table:string)=>`SELECT 'perception:'||p.ref__module_id||':'||p.ref__type||':'||p.ref__id AS key,
 p.version,COALESCE(p.occurred_at,p.source__published_at) AS at,'perception' AS kind,'world' AS channel,
 p.ref__module_id AS module_id,p.ref__type AS type,p.ref__id AS ref_id,NULL::text AS invitation_id,p.source_id,
 jsonb_build_array(p.version,p.public,p.active,p.available) AS authority
 FROM ${table} p WHERE $2='received' AND p.public=true`;
const union=`
 SELECT 'exchange:'||i.id AS key,i.version,to_timestamp(i.created_at/1000.0) AS at,'exchange' AS kind,NULL::text AS channel,
 NULL::text AS module_id,NULL::text AS type,NULL::text AS ref_id,i.id AS invitation_id,'text-feedback'::text AS source_id,
 jsonb_build_array(i.version,r.version,a.version,f.version,me.version,other.version,p.version,v.version) AS authority
 FROM interaction.invitations i
 LEFT JOIN interaction.artifact_revisions r ON r.artifact_id=i.artifact_id AND r.revision=i.artifact_revision
 LEFT JOIN interaction.activities a ON a.id=i.activity_id
 LEFT JOIN interaction.feedback_contributions f ON f.id=a.feedback_id
 LEFT JOIN iam.world_memberships me ON me.agent_id=$1
 LEFT JOIN iam.world_memberships other ON other.agent_id=CASE WHEN i.from_agent_id=$1 THEN i.to_agent_id ELSE i.from_agent_id END
 LEFT JOIN profiles.agent_profiles p ON p.agent_id=other.agent_id
 LEFT JOIN behavior.visibility v ON v.agent_id=$1
 WHERE CASE WHEN $2='sent' THEN i.from_agent_id=$1 ELSE i.to_agent_id=$1 END
 UNION ALL
 SELECT 'perception:mailbox:mailbox.direct-message@1:'||d.message_id,m.content_version,d.received_at,'perception','inbox',
 'mailbox','mailbox.direct-message@1',d.message_id,NULL,'direct-messages',
 jsonb_build_array(d.version,d.active,d.owner_observation__existence,d.owner_observation__summary,d.owner_observation__body,d.owner_observation_audience,m.id,sp.version,sm.version)
 FROM mailbox.deliveries d JOIN mailbox.message_versions m ON m.id=d.message_version_id
 LEFT JOIN profiles.agent_profiles sp ON sp.agent_id=m.sender__ref__id AND m.sender__kind='agent'
 LEFT JOIN iam.world_memberships sm ON sm.agent_id=sp.agent_id
 WHERE $2='received' AND d.agent_id=$1
 UNION ALL
 SELECT 'perception:'||n.ref__module_id||':'||n.ref__type||':'||n.ref__id,n.version,d.created_at,'perception','inbox',
 n.ref__module_id,n.ref__type,n.ref__id,NULL,n.source_id,jsonb_build_array(d.version,d.active,n.version,n.active,n.available)
 FROM notifications.deliveries d JOIN perception.reference_aliases x ON x.external_id=d.object_id AND x.target_table='notifications.notifications'
 JOIN notifications.notifications n ON n.id=x.target_key WHERE $2='received' AND d.agent_id=$1
 UNION ALL ${publicRows('announcements.announcements')}
 UNION ALL ${publicRows('events.plans')}
 UNION ALL ${publicRows('events.occurrences')}`;

export function createOwnerMailboxRepository(sql:RuntimeSql):{port:typeof OWNER_MAILBOX_CANDIDATES;reader:OwnerMailboxCandidates;writer:OwnerMailboxCandidates}{
 const reader:OwnerMailboxCandidates={
  async authorizationVersion(agentId,box){const rows=await sql.query(`WITH candidates AS (${union}) SELECT md5(COALESCE(string_agg(key||':'||authority::text,',' ORDER BY key COLLATE "C"),'')) AS value FROM candidates`,[text(agentId),box]);return text(rows[0]!.value);},
  async list(input){
   integer(input.limit,1,100);if(!['received','sent'].includes(input.box)||!['newest','oldest'].includes(input.order)||input.sourceIds.length>5)throw new TypeError('Invalid fixed mailbox query');
   const operator=input.order==='newest'?'<':'>',direction=input.order==='newest'?'DESC':'ASC';
   const rows=await sql.query(`WITH candidates AS (${union}) SELECT key,version,at,kind,channel,module_id,type,ref_id,invitation_id FROM candidates
    WHERE (kind='exchange' OR source_id=ANY($3::text[])) AND (kind='exchange' OR $4::boolean OR type<>'mailbox.message@1')
    AND ($5::text IS NULL OR CASE WHEN $6::timestamptz IS NULL THEN at IS NULL AND key COLLATE "C" ${operator} $5 ELSE at IS NULL OR at ${operator} $6 OR at=$6 AND key COLLATE "C" ${operator} $5 END)
    ORDER BY at ${direction} NULLS LAST,key COLLATE "C" ${direction} LIMIT $7`,[text(input.agentId),input.box,input.sourceIds,input.legacyNotifications,input.after?.key??null,input.after?.occurredAt==null?null:new Date(integer(input.after.occurredAt)),input.limit]);
   return rows.map(row=>({key:text(row.key,300),version:number(row.version),occurredAt:row.at===null?null:integer((row.at as Date).getTime()),source:row.kind==='exchange'?{kind:'exchange',invitationId:text(row.invitation_id)}:{kind:'perception',channel:row.channel,ref:{moduleId:row.module_id,type:row.type,id:row.ref_id}}} as OwnerMailboxCandidate));
  },
 };
 return {port:OWNER_MAILBOX_CANDIDATES,reader,writer:reader};
}
