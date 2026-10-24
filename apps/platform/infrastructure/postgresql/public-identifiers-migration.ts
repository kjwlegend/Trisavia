export const PUBLIC_IDENTIFIERS_MIGRATION={moduleId:'public_identifiers',version:1,name:'persistent_agent_owner_npc_short_identifiers',dependencies:['iam','town_services'],sql:`
CREATE SCHEMA public_identifiers;
CREATE SEQUENCE public_identifiers.agent_number AS bigint MINVALUE 1 NO CYCLE;
CREATE SEQUENCE public_identifiers.owner_number AS bigint MINVALUE 1 NO CYCLE;
CREATE SEQUENCE public_identifiers.npc_number AS bigint MINVALUE 1 NO CYCLE;
CREATE TABLE public_identifiers.identities(subject_kind text NOT NULL CHECK(subject_kind IN ('agent','owner','npc')),subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 256),ordinal bigint NOT NULL CHECK(ordinal>0),public_id text GENERATED ALWAYS AS ((CASE subject_kind WHEN 'agent' THEN 'A' WHEN 'owner' THEN 'H' ELSE 'N' END)||lpad(ordinal::text,greatest(3,length(ordinal::text)),'0')) STORED,PRIMARY KEY(subject_kind,subject_id),UNIQUE(subject_kind,ordinal),UNIQUE(public_id));
CREATE TRIGGER immutable_public_identifier BEFORE UPDATE OR DELETE ON public_identifiers.identities FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION public_identifiers.allocate(kind text,subject text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public_identifiers AS $$ DECLARE result text;num bigint; BEGIN
 SELECT public_id INTO result FROM public_identifiers.identities WHERE subject_kind=kind AND subject_id=subject;IF FOUND THEN RETURN result;END IF;
 IF kind='agent' AND EXISTS(SELECT 1 FROM iam.agents WHERE id=subject) THEN num:=nextval('public_identifiers.agent_number');
 ELSIF kind='owner' AND EXISTS(SELECT 1 FROM iam.human_accounts WHERE id=subject AND status='active') THEN num:=nextval('public_identifiers.owner_number');
 ELSIF kind='npc' AND EXISTS(SELECT 1 FROM town_services.npcs WHERE npc_id=subject) THEN num:=nextval('public_identifiers.npc_number');
 ELSE RAISE EXCEPTION 'Current registered subject is unavailable for public identifier' USING ERRCODE='23503';END IF;
 INSERT INTO public_identifiers.identities(subject_kind,subject_id,ordinal) VALUES(kind,subject,num) ON CONFLICT(subject_kind,subject_id) DO NOTHING;
 SELECT public_id INTO result FROM public_identifiers.identities WHERE subject_kind=kind AND subject_id=subject;RETURN result;END $$;
REVOKE ALL ON FUNCTION public_identifiers.allocate(text,text) FROM PUBLIC;
CREATE FUNCTION public_identifiers.register_agent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public_identifiers AS $$ BEGIN PERFORM public_identifiers.allocate('agent',NEW.id);RETURN NEW;END $$;
CREATE FUNCTION public_identifiers.register_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public_identifiers AS $$ BEGIN IF NEW.status='active' THEN PERFORM public_identifiers.allocate('owner',NEW.id);END IF;RETURN NEW;END $$;
CREATE FUNCTION public_identifiers.register_npc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public_identifiers AS $$ BEGIN PERFORM public_identifiers.allocate('npc',NEW.npc_id);RETURN NEW;END $$;
CREATE TRIGGER assign_agent_public_id AFTER INSERT ON iam.agents FOR EACH ROW EXECUTE FUNCTION public_identifiers.register_agent();
CREATE TRIGGER assign_owner_public_id AFTER INSERT OR UPDATE OF status ON iam.human_accounts FOR EACH ROW EXECUTE FUNCTION public_identifiers.register_owner();
CREATE TRIGGER assign_npc_public_id AFTER INSERT ON town_services.npcs FOR EACH ROW EXECUTE FUNCTION public_identifiers.register_npc();
`};
export const PUBLIC_IDENTIFIERS_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA public_identifiers FROM connet_app;GRANT USAGE ON SCHEMA public_identifiers TO connet_app;REVOKE ALL ON ALL TABLES IN SCHEMA public_identifiers FROM connet_app;REVOKE ALL ON ALL SEQUENCES IN SCHEMA public_identifiers FROM connet_app;GRANT SELECT ON public_identifiers.identities TO connet_app;GRANT EXECUTE ON FUNCTION public_identifiers.allocate(text,text) TO connet_app;`;
