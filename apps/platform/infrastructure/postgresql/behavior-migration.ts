export const BEHAVIOR_MIGRATION={moduleId:'behavior',version:1,name:'source_behavior_records_and_coverage',dependencies:['iam','runtime','world','interaction','friendships'],sql:`
CREATE SCHEMA behavior;
CREATE TABLE behavior.coverage(scope text PRIMARY KEY CHECK(scope IN ('world_explicit','world_idle','relationships','interaction')),from_at bigint NOT NULL CHECK(from_at>=0),policy_version integer NOT NULL CHECK(policy_version=1),partial boolean NOT NULL);
CREATE TABLE behavior.visibility(agent_id text PRIMARY KEY REFERENCES iam.agents(id),version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991));
CREATE TABLE behavior.records(
 id text COLLATE "C" PRIMARY KEY CHECK(id~'^[a-f0-9]{64}$'),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 scope text NOT NULL REFERENCES behavior.coverage(scope),source_domain text NOT NULL CHECK(source_domain IN ('world','relationships','interaction')),
 source_event_id text NOT NULL REFERENCES runtime.events(event_id),source_type text NOT NULL,source_id text NOT NULL,source_version bigint NOT NULL CHECK(source_version>0),
 node text NOT NULL CHECK(length(node)<=100),agent_id text NOT NULL REFERENCES iam.agents(id),occurred_at bigint NOT NULL CHECK(occurred_at>=0),recorded_at bigint NOT NULL CHECK(recorded_at>=occurred_at),
 causation_id text NOT NULL,correlation_id text NOT NULL,initiator_kind text NOT NULL CHECK(initiator_kind IN ('agent','owner','system')),initiator_id text NOT NULL,executor_kind text NOT NULL CHECK(executor_kind IN ('agent','owner','system')),executor_id text NOT NULL,origin text NOT NULL CHECK(origin IN ('external_agent','owner','rules','system')),
 owner_audience jsonb CHECK(jsonb_typeof(owner_audience)='object' AND octet_length(owner_audience::text)<=2048),
 public_projection jsonb CHECK(jsonb_typeof(public_projection)='object' AND octet_length(public_projection::text)<=1024),
 UNIQUE(source_domain,source_event_id,agent_id,node));
CREATE INDEX behavior_agent_time ON behavior.records(agent_id,occurred_at DESC,id COLLATE "C" DESC);
CREATE INDEX behavior_public_time ON behavior.records(occurred_at DESC,id COLLATE "C" DESC) WHERE public_projection IS NOT NULL;
CREATE INDEX behavior_idle_cadence ON behavior.records(agent_id,occurred_at DESC) WHERE scope='world_idle';
CREATE TRIGGER immutable_behavior_record BEFORE UPDATE OR DELETE ON behavior.records FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER immutable_behavior_coverage BEFORE UPDATE OR DELETE ON behavior.coverage FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const BEHAVIOR_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA behavior FROM connet_app;GRANT USAGE ON SCHEMA behavior TO connet_app;
REVOKE ALL ON ALL TABLES IN SCHEMA behavior FROM connet_app;REVOKE ALL ON ALL SEQUENCES IN SCHEMA behavior FROM connet_app;
GRANT SELECT ON behavior.coverage,behavior.records,behavior.visibility TO connet_app;GRANT INSERT,UPDATE(version) ON behavior.visibility TO connet_app;GRANT INSERT ON behavior.records TO connet_app;GRANT USAGE,SELECT ON SEQUENCE behavior.records_sequence_seq TO connet_app;`;
