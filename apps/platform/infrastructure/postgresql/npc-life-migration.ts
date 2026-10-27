/** New source-only extension. Original Life3 economic/catalog rows and all old facts are retained. */
export const NPC_LIFE_MIGRATION={moduleId:'npc_life',version:1,name:'versioned_care_points_and_plan_bound_introductions',dependencies:['life','runtime','world','town_services'],sql:`
CREATE SCHEMA npc_life;
CREATE TABLE npc_life.definitions(version integer PRIMARY KEY CHECK(version=1),definition jsonb NOT NULL CHECK(octet_length(definition::text)<=65536));
CREATE TRIGGER npc_life_definition_no_change BEFORE UPDATE OR DELETE ON npc_life.definitions FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TABLE npc_life.control(singleton integer PRIMARY KEY CHECK(singleton=1),definition_version integer NOT NULL REFERENCES npc_life.definitions(version));
CREATE TABLE npc_life.care_points(point_id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),care_kind text NOT NULL CHECK(care_kind IN ('water','clear')),active_activity_id text UNIQUE REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,last_care_at bigint,actor_id text REFERENCES iam.agents(id),last_activity_id text REFERENCES life.activities(id),next_eligible_at bigint,material_available boolean NOT NULL,
 CHECK((last_care_at IS NULL)=(actor_id IS NULL)),CHECK((last_care_at IS NULL)=(last_activity_id IS NULL)),CHECK((last_care_at IS NULL)=(next_eligible_at IS NULL)),CHECK(next_eligible_at=last_care_at+3600000));
CREATE TABLE npc_life.introductions(id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version IN (1,2)),agent_id text NOT NULL REFERENCES iam.agents(id),plan_id text NOT NULL REFERENCES life.plans(id),point_id text NOT NULL REFERENCES npc_life.care_points(point_id),created_at bigint NOT NULL,expires_at bigint NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+1800000),source_activity_id text NOT NULL UNIQUE REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,source_event_id text NOT NULL UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,consumed_by_activity_id text UNIQUE REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,data jsonb NOT NULL CHECK(octet_length(data::text)<=8192),UNIQUE(plan_id,point_id));
CREATE TABLE npc_life.care_facts(activity_id text COLLATE "C" PRIMARY KEY REFERENCES life.activities(id),point_id text NOT NULL REFERENCES npc_life.care_points(point_id),agent_id text NOT NULL REFERENCES iam.agents(id),completed_at bigint NOT NULL,source_event_id text NOT NULL UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,data jsonb NOT NULL CHECK(octet_length(data::text)<=4096));
CREATE FUNCTION npc_life.check_life_source() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE activity life.activities;j jsonb:=to_jsonb(NEW); BEGIN
 SELECT * INTO activity FROM life.activities WHERE id=coalesce(j->>'source_activity_id',j->>'activity_id');
 IF NOT FOUND OR activity.actor_kind<>'agent' OR activity.actor_id IS DISTINCT FROM j->>'agent_id' OR activity.state<>'completed' OR activity.source_event_id IS DISTINCT FROM j->>'source_event_id'
 OR TG_TABLE_NAME='introductions' AND (activity.action_id<>'care.introduce' OR activity.data->>'planId' IS DISTINCT FROM j->>'plan_id')
 OR TG_TABLE_NAME='care_facts' AND (activity.action_id<>'care.perform' OR activity.ended_at<activity.scheduled_end_at OR activity.scheduled_end_at<>activity.started_at+120000 OR (activity.data->>'reservedEnergy')::integer<>6) THEN RAISE EXCEPTION 'A matching actual terminal Life source is required' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER care_introduction_real_source AFTER INSERT ON npc_life.introductions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION npc_life.check_life_source();
CREATE CONSTRAINT TRIGGER care_fact_real_source AFTER INSERT ON npc_life.care_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION npc_life.check_life_source();
CREATE INDEX care_actor_point_latest ON npc_life.care_facts(agent_id,point_id,completed_at DESC,activity_id COLLATE "C" DESC);
CREATE TRIGGER care_fact_no_change BEFORE UPDATE OR DELETE ON npc_life.care_facts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION npc_life.protect_introduction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.consumed_by_activity_id IS NOT NULL OR NEW.consumed_by_activity_id IS NULL OR NEW.version<>OLD.version+1 OR
 (to_jsonb(NEW)-ARRAY['version','consumed_by_activity_id','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','consumed_by_activity_id','data']) OR
 (NEW.data-ARRAY['version','consumedByActivityId']) IS DISTINCT FROM (OLD.data-ARRAY['version','consumedByActivityId']) THEN RAISE EXCEPTION 'Introduction identity or consumption changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER introduction_single_consumption BEFORE UPDATE ON npc_life.introductions FOR EACH ROW EXECUTE FUNCTION npc_life.protect_introduction();
CREATE TRIGGER introduction_no_delete BEFORE DELETE ON npc_life.introductions FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
/** Current permissions, not a grant of economic or identity authority. Definitions activate only as migrator. */
export const NPC_LIFE_PERMISSIONS_SQL=`GRANT USAGE ON SCHEMA npc_life TO connet_app;GRANT SELECT ON ALL TABLES IN SCHEMA npc_life TO connet_app;GRANT INSERT ON npc_life.introductions,npc_life.care_facts TO connet_app;GRANT UPDATE(version,active_activity_id,last_care_at,actor_id,last_activity_id,next_eligible_at,material_available) ON npc_life.care_points TO connet_app;GRANT UPDATE(version,consumed_by_activity_id,data) ON npc_life.introductions TO connet_app;`;
export const LIFE_NPC_ACTIONS_MIGRATION={moduleId:'life',version:4,name:'bounded_plan_care_actions',dependencies:['life','npc_life'],sql:`
ALTER TABLE life.activities DROP CONSTRAINT activities_action_id_check;
ALTER TABLE life.activities ADD CONSTRAINT activities_action_id_check CHECK(action_id IN ('work.shift','rest.bench','npc.duty','rest.voucher','shop.buy','shop.sell','fish.session','meal.prepare','meal.eat','rest.inn','book.read','visit.place','care.introduce','care.perform'));
ALTER TABLE life.activities DROP CONSTRAINT activities_scheduled_end_at_check;
ALTER TABLE life.activities ADD CONSTRAINT activities_scheduled_end_at_check CHECK(scheduled_end_at>started_at OR action_id IN ('shop.buy','shop.sell','care.introduce') AND scheduled_end_at=started_at);
`};
