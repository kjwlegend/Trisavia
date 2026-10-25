/** Forward-only B storage; old catalogs, activities, wallets and authority snapshots remain unchanged. */
export const LIFE_B_MIGRATION={moduleId:'life',version:2,name:'fishing_cast_sources_and_bounded_trade_actions',dependencies:['life','wallet','runtime'],sql:`
ALTER TABLE life.catalogs DROP CONSTRAINT catalogs_revision_check;
ALTER TABLE life.catalogs ADD CONSTRAINT catalogs_revision_check CHECK(revision IN (1,2));
ALTER TABLE life.activities DROP CONSTRAINT activities_action_id_check;
ALTER TABLE life.activities ADD CONSTRAINT activities_action_id_check CHECK(action_id IN ('work.shift','rest.bench','npc.duty','rest.voucher','shop.buy','shop.sell','fish.session'));
DO $life_b_schedule$ DECLARE original_name text; BEGIN
 SELECT conname INTO STRICT original_name FROM pg_constraint
  WHERE conrelid='life.activities'::regclass AND contype='c'
   AND pg_get_constraintdef(oid)='CHECK ((scheduled_end_at > started_at))';
 EXECUTE format('ALTER TABLE life.activities DROP CONSTRAINT %I',original_name);
END $life_b_schedule$;
ALTER TABLE life.activities ADD CONSTRAINT activities_scheduled_end_at_check CHECK(scheduled_end_at>started_at OR action_id IN ('shop.buy','shop.sell') AND scheduled_end_at=started_at);
CREATE TABLE life.fishing_sessions(
 id text COLLATE "C" PRIMARY KEY REFERENCES life.activities(id),version bigint NOT NULL CHECK(version>0),
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,
 state text NOT NULL CHECK(state IN ('active','completed','cancelled','interrupted')),
 data jsonb NOT NULL CHECK(octet_length(data::text)<=16384),FOREIGN KEY(actor_kind,actor_id) REFERENCES life.actors(actor_kind,actor_id));
CREATE TABLE life.fishing_casts(
 id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),session_id text NOT NULL REFERENCES life.fishing_sessions(id),
 cast_index integer NOT NULL CHECK(cast_index BETWEEN 0 AND 4),state text NOT NULL CHECK(state IN ('active','completed','cancelled','interrupted')),
 started_at bigint NOT NULL,scheduled_end_at bigint NOT NULL CHECK(scheduled_end_at=started_at+60000),ended_at bigint,
 result_id text UNIQUE,source_event_id text UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 data jsonb NOT NULL CHECK(octet_length(data::text)<=8192),UNIQUE(session_id,cast_index),
 CHECK((state='active')=(ended_at IS NULL)),CHECK((state='active')=(result_id IS NULL)),
 CHECK((state='active')=(source_event_id IS NULL)),CHECK(ended_at IS NULL OR ended_at>=started_at),
 CHECK(state<>'completed' OR ended_at>=scheduled_end_at));
CREATE UNIQUE INDEX life_one_active_cast ON life.fishing_casts(session_id) WHERE state='active';
CREATE INDEX life_session_cast_order ON life.fishing_casts(session_id,cast_index);
CREATE FUNCTION life.protect_fishing_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'active' OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Fishing terminal source is immutable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='fishing_casts' THEN
  IF NEW.state='active' OR (to_jsonb(NEW)-ARRAY['version','state','ended_at','result_id','source_event_id','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','ended_at','result_id','source_event_id','data'])
   OR (NEW.data-ARRAY['version','state','endedAt','resultId','sourceEventId','stopCode']) IS DISTINCT FROM (OLD.data-ARRAY['version','state','endedAt','resultId','sourceEventId','stopCode']) THEN RAISE EXCEPTION 'Fishing draw or cast identity cannot change' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['version','state','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','data'])
   OR (NEW.data-ARRAY['version','state','nextCastIndex','currentCastId','castIds','endedAt','resultId','sourceEventId']) IS DISTINCT FROM (OLD.data-ARRAY['version','state','nextCastIndex','currentCastId','castIds','endedAt','resultId','sourceEventId']) THEN RAISE EXCEPTION 'Fishing session source cannot change' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER life_cast_source_fixed BEFORE UPDATE ON life.fishing_casts FOR EACH ROW EXECUTE FUNCTION life.protect_fishing_source();
CREATE TRIGGER life_session_source_fixed BEFORE UPDATE ON life.fishing_sessions FOR EACH ROW EXECUTE FUNCTION life.protect_fishing_source();
CREATE TRIGGER life_cast_source_no_delete BEFORE DELETE ON life.fishing_casts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER life_session_source_no_delete BEFORE DELETE ON life.fishing_sessions FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const LIFE_B_PERMISSIONS_SQL=`REVOKE ALL ON life.fishing_sessions,life.fishing_casts FROM connet_app;
GRANT SELECT,INSERT ON life.fishing_sessions,life.fishing_casts TO connet_app;
GRANT UPDATE(version,state,data) ON life.fishing_sessions TO connet_app;
GRANT UPDATE(version,state,ended_at,result_id,source_event_id,data) ON life.fishing_casts TO connet_app;`;
