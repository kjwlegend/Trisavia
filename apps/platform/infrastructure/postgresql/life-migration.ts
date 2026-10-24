/** Forward-only life state; existing identities, vouchers and world facts are untouched. */
export const LIFE_MIGRATION={moduleId:'life',version:1,name:'finite_life_activities_plans_energy_and_npc_actors',dependencies:['iam','world','town_services','runtime'],sql:`
CREATE SCHEMA life;
CREATE TABLE life.catalogs(revision integer PRIMARY KEY CHECK(revision=1),activated_at bigint NOT NULL,definition jsonb NOT NULL CHECK(octet_length(definition::text)<=65536));
CREATE TRIGGER immutable_life_catalog BEFORE UPDATE OR DELETE ON life.catalogs FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TABLE life.actors(actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,version bigint NOT NULL CHECK(version>0),energy integer NOT NULL CHECK(energy BETWEEN 0 AND 100),reserved_energy integer NOT NULL CHECK(reserved_energy BETWEEN 0 AND energy),data jsonb NOT NULL CHECK(octet_length(data::text)<=16384),PRIMARY KEY(actor_kind,actor_id),
 agent_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='agent' THEN actor_id END) STORED REFERENCES iam.agents(id),npc_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='npc' THEN actor_id END) STORED REFERENCES town_services.npcs(npc_id));
CREATE TABLE life.activities(id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),actor_kind text NOT NULL,actor_id text COLLATE "C" NOT NULL,action_id text NOT NULL CHECK(action_id IN ('work.shift','rest.bench','npc.duty','rest.voucher')),job_id text,rule_version integer NOT NULL CHECK(rule_version=1),catalog_revision integer NOT NULL REFERENCES life.catalogs(revision),state text NOT NULL CHECK(state IN ('active','completed','cancelled','interrupted')),place_id text NOT NULL,station_id text NOT NULL,seat integer NOT NULL CHECK(seat>=0),started_at bigint NOT NULL,scheduled_end_at bigint NOT NULL CHECK(scheduled_end_at>started_at),ended_at bigint CHECK(ended_at>=started_at),result_id text UNIQUE,source_event_id text UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,reward_amount bigint NOT NULL CHECK(reward_amount>=0),data jsonb NOT NULL CHECK(octet_length(data::text)<=16384),FOREIGN KEY(actor_kind,actor_id) REFERENCES life.actors(actor_kind,actor_id),CHECK((state='active')=(ended_at IS NULL)),CHECK((state='active')=(result_id IS NULL)),CHECK(state<>'completed' OR ended_at>=scheduled_end_at));
CREATE UNIQUE INDEX life_active_body ON life.activities(actor_kind,actor_id) WHERE state='active';
CREATE UNIQUE INDEX life_active_seat ON life.activities(station_id,seat) WHERE state='active';
CREATE INDEX life_results ON life.activities(actor_kind,actor_id,ended_at DESC,id DESC) WHERE state<>'active';
CREATE TABLE life.plans(id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),actor_kind text NOT NULL,actor_id text COLLATE "C" NOT NULL,state text NOT NULL CHECK(state IN ('queued','running','waiting_condition','completed','partially_completed','failed','cancelled','expired')),created_at bigint NOT NULL,deadline_at bigint NOT NULL CHECK(deadline_at>created_at AND deadline_at<=created_at+7200000),data jsonb NOT NULL CHECK(octet_length(data::text)<=65536),FOREIGN KEY(actor_kind,actor_id) REFERENCES life.actors(actor_kind,actor_id));
CREATE UNIQUE INDEX life_one_foreground_plan ON life.plans(actor_kind,actor_id) WHERE state IN ('running','waiting_condition');
CREATE UNIQUE INDEX life_one_queued_plan ON life.plans(actor_kind,actor_id) WHERE state='queued';
CREATE TABLE life.npcs(npc_id text PRIMARY KEY REFERENCES town_services.npcs(npc_id),version bigint NOT NULL CHECK(version>0),data jsonb NOT NULL CHECK(octet_length(data::text)<=16384));
CREATE FUNCTION life.protect_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'active' OR NEW.state='active' OR NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','state','ended_at','result_id','source_event_id','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','ended_at','result_id','source_event_id','data']) THEN RAISE EXCEPTION 'Life activity source or terminal result is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER life_activity_transition BEFORE UPDATE ON life.activities FOR EACH ROW EXECUTE FUNCTION life.protect_activity();
ALTER TABLE runtime.events DROP CONSTRAINT events_actor_kind_check;
ALTER TABLE runtime.events ADD CONSTRAINT events_actor_kind_check CHECK(actor_kind IN ('agent','owner','system','npc'));
`};
export const LIFE_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA life FROM connet_app;GRANT USAGE ON SCHEMA life TO connet_app;REVOKE ALL ON ALL TABLES IN SCHEMA life FROM connet_app;GRANT SELECT ON ALL TABLES IN SCHEMA life TO connet_app;GRANT INSERT,UPDATE ON life.actors,life.activities,life.plans,life.npcs TO connet_app;`;
export const LIFE_RUNTIME_MIGRATION={moduleId:'runtime',version:5,name:'bounded_fenced_life_actor_recurrence',dependencies:['runtime','life'],sql:`
CREATE OR REPLACE FUNCTION runtime.protect_work() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF ((OLD.domain='world' AND OLD.kind='world.idle.step' AND OLD.target_type='avatar') OR (OLD.domain='life' AND OLD.kind='life.actor.tick' AND OLD.target_type IN ('agent','npc'))) AND OLD.handler_version=1 AND OLD.payload_version=1
   AND OLD.state='leased' AND NEW.state='pending' AND NEW.attempts=0 AND NEW.fence=OLD.fence
   AND NEW.due_at>OLD.due_at AND NEW.available_at=NEW.due_at AND NEW.completed_at IS NULL
   AND NEW.lease_token IS NULL AND NEW.lease_worker IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_error_code IS NULL THEN
   IF (to_jsonb(NEW)-ARRAY['version','state','attempts','due_at','available_at','payload','lease_token','lease_worker','lease_expires_at','last_error_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','attempts','due_at','available_at','payload','lease_token','lease_worker','lease_expires_at','last_error_code']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Recurring rule identity or fence changed' USING ERRCODE='23514';END IF;RETURN NEW;
  END IF;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['version','state','attempts','fence','lease_token','lease_worker','lease_expires_at','last_error_code','completed_at','available_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','attempts','fence','lease_token','lease_worker','lease_expires_at','last_error_code','completed_at','available_at']) OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.fence<OLD.fence OR OLD.state IN ('completed','failed','cancelled') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'Work identity, terminal state or fence changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
`};
export const LIFE_BEHAVIOR_MIGRATION={moduleId:'behavior',version:3,name:'life_results_and_independent_npc_subjects',dependencies:['behavior','life'],sql:`
ALTER TABLE behavior.coverage DROP CONSTRAINT coverage_scope_check;
ALTER TABLE behavior.coverage ADD CONSTRAINT coverage_scope_check CHECK(scope IN ('world_explicit','world_idle','relationships','interaction','town_services','life'));
ALTER TABLE behavior.records DROP CONSTRAINT records_source_domain_check;
ALTER TABLE behavior.records ADD CONSTRAINT records_source_domain_check CHECK(source_domain IN ('world','relationships','interaction','town_services','life'));
ALTER TABLE behavior.records ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE behavior.records ADD COLUMN npc_id text REFERENCES town_services.npcs(npc_id);
ALTER TABLE behavior.records ADD CONSTRAINT behavior_subject_kind CHECK(num_nonnulls(agent_id,npc_id)=1 AND (npc_id IS NULL OR source_domain='life' AND owner_audience IS NULL));
ALTER TABLE behavior.records DROP CONSTRAINT records_initiator_kind_check;
ALTER TABLE behavior.records ADD CONSTRAINT records_initiator_kind_check CHECK(initiator_kind IN ('agent','owner','system','npc'));
ALTER TABLE behavior.records DROP CONSTRAINT records_executor_kind_check;
ALTER TABLE behavior.records ADD CONSTRAINT records_executor_kind_check CHECK(executor_kind IN ('agent','owner','system','npc'));
CREATE INDEX behavior_npc_time ON behavior.records(npc_id,occurred_at DESC,id DESC) WHERE npc_id IS NOT NULL;
`};
