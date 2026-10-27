/** Append-only final statements. Existing authority rows, catalogs, coverage and generations are unchanged. */
export const BEHAVIOR_JOURNAL_MIGRATION={moduleId:'behavior',version:4,name:'private_agent_final_statements_with_stable_draft_audience',dependencies:['behavior','iam','runtime'],sql:`
CREATE TABLE behavior.journal_entries(
 id text COLLATE "C" PRIMARY KEY,agent_id text NOT NULL REFERENCES iam.agents(id),client_entry_id text COLLATE "C" NOT NULL CHECK(client_entry_id~'^[A-Za-z0-9_.:-]{8,100}$'),
 expected_audience_ref text CHECK(expected_audience_ref~'^[a-f0-9]{64}$'),payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 submitted_at bigint NOT NULL CHECK(submitted_at BETWEEN 0 AND 9007199254740991),title text CHECK(char_length(title) BETWEEN 1 AND 32),
 text_content text NOT NULL CHECK(char_length(text_content) BETWEEN 1 AND 4000 AND octet_length(text_content)<=16384),
 source_event_id text UNIQUE NOT NULL REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ?& ARRAY['entryId','agentId','clientEntryId','version','sourceEventId','submittedAt','text','expectedAudienceRef','payloadHash','title','sourceRefs','ownerAudience'] AND octet_length(data::text)<=32768 AND data->>'entryId'=id AND data->>'agentId'=agent_id AND data->>'clientEntryId'=client_entry_id AND data->>'version'='1' AND data->>'sourceEventId'=source_event_id AND data->>'submittedAt'=submitted_at::text AND data->>'text'=text_content AND (data->>'expectedAudienceRef') IS NOT DISTINCT FROM expected_audience_ref AND data->>'payloadHash'=payload_hash AND (data->>'title') IS NOT DISTINCT FROM title AND jsonb_typeof(data->'sourceRefs')='array' AND jsonb_array_length(data->'sourceRefs')<=8),
 UNIQUE(agent_id,client_entry_id));
CREATE TRIGGER journal_entry_no_change BEFORE UPDATE OR DELETE ON behavior.journal_entries FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION behavior.check_journal_event() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e runtime.events;BEGIN
 SELECT * INTO e FROM runtime.events WHERE event_id=NEW.source_event_id;
 IF NOT FOUND OR e.domain<>'life' OR e.kind<>'life.journal.authored' OR e.subject_type<>'life.journal' OR e.subject_id<>NEW.id OR e.subject_version<>1 OR e.actor_kind<>'agent' OR e.actor_id<>NEW.agent_id OR e.source<>'external_agent' OR e.occurred_at<>NEW.submitted_at OR e.audience_kind<>'agents' OR e.audience_agents<>ARRAY[NEW.agent_id] OR e.payload->>'textDigest' IS DISTINCT FROM encode(sha256(convert_to(NEW.text_content,'UTF8')),'hex') THEN RAISE EXCEPTION 'Final statement needs its matching private authenticated source event' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER journal_actual_event AFTER INSERT ON behavior.journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION behavior.check_journal_event();
`};
export const BEHAVIOR_JOURNAL_PERMISSIONS_SQL=`GRANT USAGE ON SCHEMA behavior TO connet_app;GRANT SELECT,INSERT ON behavior.journal_entries TO connet_app;REVOKE UPDATE,DELETE ON behavior.journal_entries FROM connet_app;`;
