/** Consent is independent of body activities. No Agent/Owner/item/coin is created by this migration. */
export const RELATIONSHIP_GIFT_MIGRATION={moduleId:'friendships',version:3,name:'explicit_recipient_consented_reserved_gifts',dependencies:['friendships','iam','life','runtime'],sql:`
CREATE TABLE relationships.gifts(
 id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),from_agent_id text NOT NULL REFERENCES iam.agents(id),to_agent_id text NOT NULL REFERENCES iam.agents(id),
 state text NOT NULL CHECK(state IN ('pending','accepted','declined','withdrawn','expired','unavailable')),
 catalog_revision integer NOT NULL CHECK(catalog_revision=3) REFERENCES life.catalogs(revision),rule_version integer NOT NULL CHECK(rule_version=1),
 created_at bigint NOT NULL CHECK(created_at>=0),deadline_at bigint NOT NULL CHECK(deadline_at=created_at+86400000),resolved_at bigint,
 result_id text UNIQUE,source_event_id text UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 accepted_by_agent_id text REFERENCES iam.agents(id),data jsonb NOT NULL CHECK(octet_length(data::text)<=32768),
 CHECK(from_agent_id<>to_agent_id),CHECK((state='pending')=(resolved_at IS NULL)),CHECK((state='pending')=(result_id IS NULL)),CHECK((state='pending')=(source_event_id IS NULL)),
 CHECK(resolved_at IS NULL OR resolved_at>=created_at),CHECK(state<>'expired' OR resolved_at>=deadline_at),CHECK(state<>'accepted' OR resolved_at<deadline_at),
 CHECK((state='accepted' AND accepted_by_agent_id=to_agent_id) OR (state<>'accepted' AND accepted_by_agent_id IS NULL)),CHECK(result_id IS NULL OR result_id=id));
CREATE INDEX relationship_gifts_sender ON relationships.gifts(from_agent_id,id COLLATE "C");
CREATE INDEX relationship_gifts_recipient ON relationships.gifts(to_agent_id,id COLLATE "C");
CREATE INDEX relationship_pending_gifts ON relationships.gifts(id COLLATE "C") WHERE state='pending';
CREATE FUNCTION relationships.protect_gift_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'pending' OR NEW.state='pending' OR NEW.version<>OLD.version+1
 OR (to_jsonb(NEW)-ARRAY['version','state','resolved_at','result_id','source_event_id','accepted_by_agent_id','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','resolved_at','result_id','source_event_id','accepted_by_agent_id','data'])
 OR (NEW.data-ARRAY['version','state','resolvedAt','resultId','sourceEventId','acceptedByAgentId','recipientQualification','terminalAudience','stopCode']) IS DISTINCT FROM (OLD.data-ARRAY['version','state','resolvedAt','resultId','sourceEventId','acceptedByAgentId','recipientQualification','terminalAudience','stopCode'])
 THEN RAISE EXCEPTION 'Gift offer source or terminal consent is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER relationship_gift_terminal BEFORE UPDATE ON relationships.gifts FOR EACH ROW EXECUTE FUNCTION relationships.protect_gift_source();
CREATE TRIGGER relationship_gift_no_delete BEFORE DELETE ON relationships.gifts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const RELATIONSHIP_GIFT_PERMISSIONS_SQL=`REVOKE ALL ON relationships.gifts FROM connet_app;GRANT SELECT,INSERT ON relationships.gifts TO connet_app;GRANT UPDATE(version,state,resolved_at,result_id,source_event_id,accepted_by_agent_id,data) ON relationships.gifts TO connet_app;`;
