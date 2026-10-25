/** Private material metadata is separate from published profile references and from binary storage. */
export const AVATAR_ASSETS_MIGRATION={moduleId:'avatar_assets',version:1,name:'private_preparation_tasks_and_immutable_avatar_assets',dependencies:['iam','profiles','runtime'],sql:`
CREATE SCHEMA avatar_assets;
CREATE TABLE avatar_assets.tasks(id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),agent_id text NOT NULL REFERENCES iam.agents(id),owner_id text NOT NULL REFERENCES iam.human_accounts(id),binding_id text NOT NULL REFERENCES iam.management_bindings(id),binding_version bigint NOT NULL CHECK(binding_version>0),state text NOT NULL CHECK(state IN ('active','revoked')),expires_at bigint NOT NULL,data jsonb NOT NULL CHECK(octet_length(data::text)<=8192));
CREATE INDEX avatar_task_owner ON avatar_assets.tasks(agent_id,owner_id,binding_id,id COLLATE "C");
CREATE TABLE avatar_assets.assets(id text COLLATE "C" PRIMARY KEY,version integer NOT NULL CHECK(version=1),task_id text NOT NULL REFERENCES avatar_assets.tasks(id),agent_id text NOT NULL REFERENCES iam.agents(id),digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),total_bytes bigint NOT NULL CHECK(total_bytes BETWEEN 1 AND 8388608),data jsonb NOT NULL CHECK(octet_length(data::text)<=65536));
CREATE INDEX avatar_asset_task ON avatar_assets.assets(task_id,id COLLATE "C");
CREATE TABLE avatar_assets.publications(asset_id text PRIMARY KEY REFERENCES avatar_assets.assets(id),agent_id text NOT NULL REFERENCES iam.agents(id),data jsonb NOT NULL CHECK(octet_length(data::text)<=4096));
CREATE TRIGGER avatar_assets_immutable BEFORE UPDATE OR DELETE ON avatar_assets.assets FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER avatar_publication_immutable BEFORE UPDATE OR DELETE ON avatar_assets.publications FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION avatar_assets.protect_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'active' OR NEW.state<>'revoked' OR NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','state','data']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','data']) THEN RAISE EXCEPTION 'Avatar task identity or terminal state is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER avatar_task_transition BEFORE UPDATE ON avatar_assets.tasks FOR EACH ROW EXECUTE FUNCTION avatar_assets.protect_task();
`};
export const AVATAR_ASSETS_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA avatar_assets FROM connet_app;GRANT USAGE ON SCHEMA avatar_assets TO connet_app;REVOKE ALL ON ALL TABLES IN SCHEMA avatar_assets FROM connet_app;GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA avatar_assets TO connet_app;GRANT UPDATE(version,state,data) ON avatar_assets.tasks TO connet_app;`;
/** Only resource references enter profile content; all previous builtin CHECK semantics stay intact. */
export const AVATAR_PROFILE_REFERENCE_MIGRATION={moduleId:'profiles',version:4,name:'published_custom_avatar_reference_union',dependencies:['profiles','avatar_assets'],sql:`
ALTER TABLE avatar_assets.assets ADD CONSTRAINT avatar_asset_address UNIQUE(id,digest);
ALTER TABLE profiles.profile_contents
 ADD COLUMN avatar_asset_id text GENERATED ALWAYS AS(CASE WHEN content_schema_version=4 THEN content_text::jsonb->'avatar'->>'assetId' ELSE NULL END) STORED,
 ADD COLUMN avatar_asset_digest text GENERATED ALWAYS AS(CASE WHEN content_schema_version=4 THEN content_text::jsonb->'avatar'->>'digest' ELSE NULL END) STORED,
 ADD CONSTRAINT profile_custom_avatar_address FOREIGN KEY(avatar_asset_id,avatar_asset_digest) REFERENCES avatar_assets.assets(id,digest);
ALTER TABLE profiles.profile_contents DROP CONSTRAINT profile_contents_content_schema_version_check;
ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_content_schema_version_check CHECK(content_schema_version IN(1,2,3,4));
DO $avatar_union$ DECLARE original text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT original FROM pg_constraint WHERE conrelid='profiles.profile_contents'::regclass AND conname='profile_contents_avatar_union_check';
 ALTER TABLE profiles.profile_contents DROP CONSTRAINT profile_contents_avatar_union_check;
 EXECUTE 'ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_avatar_union_check CHECK ('||substring(original FROM 7)||' OR (content_schema_version=4
 AND avatar_template IS NULL AND avatar_color IS NULL AND avatar_look_id IS NULL AND avatar_catalog_version IS NULL AND avatar_hair_color_id IS NULL AND avatar_clothing_color_id IS NULL
 AND avatar_asset_id IS NOT NULL AND avatar_asset_digest IS NOT NULL AND avatar_asset_id ~ ''^[a-f0-9-]{36}$'' AND avatar_asset_digest ~ ''^[a-f0-9]{64}$''
 AND coalesce(content_text::jsonb->''avatar''=jsonb_build_object(''kind'',''custom'',''assetId'',avatar_asset_id,''version'',1,''digest'',avatar_asset_digest,''manifestUrl'',''/v1/avatar-assets/public/''||avatar_asset_id||''/1/''||avatar_asset_digest||''/manifest.json''),false)))';
END $avatar_union$;
`};
