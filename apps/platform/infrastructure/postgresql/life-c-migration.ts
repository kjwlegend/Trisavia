/** Forward C sources; old A/B activities and rules keep their exact immutable terms. Not enabled by DDL alone. */
export const LIFE_C_MIGRATION={moduleId:'life',version:3,name:'meal_rest_reading_and_recorded_visits',dependencies:['life','runtime','wallet'],sql:`
ALTER TABLE life.catalogs DROP CONSTRAINT catalogs_revision_check;
ALTER TABLE life.catalogs ADD CONSTRAINT catalogs_revision_check CHECK(revision IN (1,2,3));
ALTER TABLE life.activities DROP CONSTRAINT activities_action_id_check;
ALTER TABLE life.activities ADD CONSTRAINT activities_action_id_check CHECK(action_id IN ('work.shift','rest.bench','npc.duty','rest.voucher','shop.buy','shop.sell','fish.session','meal.prepare','meal.eat','rest.inn','book.read','visit.place'));
DROP INDEX life.life_one_foreground_plan;
CREATE UNIQUE INDEX life_one_foreground_plan ON life.plans(actor_kind,actor_id) WHERE state='running' OR (state='waiting_condition' AND (data->'remoteWait' IS NULL OR data->'remoteWait'='null'::jsonb));
CREATE INDEX life_remote_wait_actor ON life.plans(actor_kind,actor_id,created_at,id COLLATE "C") WHERE state='waiting_condition' AND data->'remoteWait'<>'null'::jsonb;
CREATE TABLE life.reading_records(
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,book_id text NOT NULL,book_version integer NOT NULL CHECK(book_version>0),
 activity_id text NOT NULL UNIQUE REFERENCES life.activities(id),source_event_id text NOT NULL REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 completed_at bigint NOT NULL CHECK(completed_at>=0),data jsonb NOT NULL CHECK(octet_length(data::text)<=4096),
 PRIMARY KEY(actor_kind,actor_id,book_id,book_version),FOREIGN KEY(actor_kind,actor_id) REFERENCES life.actors(actor_kind,actor_id));
CREATE TRIGGER life_reading_no_change BEFORE UPDATE OR DELETE ON life.reading_records FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TABLE life.visits(
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,place_id text NOT NULL,version bigint NOT NULL CHECK(version>0),
 first_activity_id text NOT NULL UNIQUE REFERENCES life.activities(id),last_activity_id text NOT NULL REFERENCES life.activities(id),
 first_visited_at bigint NOT NULL CHECK(first_visited_at>=0),last_recorded_at bigint NOT NULL CHECK(last_recorded_at>=first_visited_at),
 PRIMARY KEY(actor_kind,actor_id,place_id),FOREIGN KEY(actor_kind,actor_id) REFERENCES life.actors(actor_kind,actor_id));
CREATE FUNCTION life.protect_visit_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version<>OLD.version+1 OR NEW.last_recorded_at<OLD.last_recorded_at+86400000
 OR (to_jsonb(NEW)-ARRAY['version','last_activity_id','last_recorded_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','last_activity_id','last_recorded_at'])
 THEN RAISE EXCEPTION 'Visit identity or real revisit interval changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER life_visit_record_guard BEFORE UPDATE ON life.visits FOR EACH ROW EXECUTE FUNCTION life.protect_visit_record();
CREATE TRIGGER life_visit_no_delete BEFORE DELETE ON life.visits FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const LIFE_C_PERMISSIONS_SQL=`REVOKE ALL ON life.reading_records,life.visits FROM connet_app;GRANT SELECT,INSERT ON life.reading_records,life.visits TO connet_app;GRANT UPDATE(version,last_activity_id,last_recorded_at) ON life.visits TO connet_app;`;
