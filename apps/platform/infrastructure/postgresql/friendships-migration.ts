/** Apply last after generic permission helpers; the application has no relationship-writing authority. */
export const FRIENDSHIPS_READ_PERMISSIONS_SQL=`GRANT USAGE ON SCHEMA relationships TO connet_app;
REVOKE ALL ON relationships.friendships FROM PUBLIC,connet_app;
GRANT SELECT ON relationships.friendships TO connet_app;`;

/** A confirmed relationship is an explicit canonical pair, never a scene or interaction inference. No rows are seeded. */
export const FRIENDSHIPS_MIGRATION={moduleId:'friendships',version:1,name:'confirmed_relationship_owner_read',dependencies:['iam'],sql:`CREATE SCHEMA IF NOT EXISTS relationships;
CREATE TABLE relationships.friendships(
 id text COLLATE "C" PRIMARY KEY CHECK(length(id)>0),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 _codec_version integer NOT NULL DEFAULT 1 CHECK(_codec_version=1),
 _present text[] NOT NULL CHECK(_present <@ ARRAY['firstAgentId','secondAgentId','status','confirmedAt','firstConfirmationId','secondConfirmationId']::text[]) CHECK(_present @> ARRAY['firstAgentId','secondAgentId','status','confirmedAt','firstConfirmationId','secondConfirmationId']::text[]),
 _nulls text[] NOT NULL CHECK(cardinality(_nulls)=0),
 first_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 second_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 status text COLLATE "C" NOT NULL CHECK(status IN ('confirmed','revoked')),
 confirmed_at timestamptz NOT NULL CHECK(confirmed_at>='1970-01-01'::timestamptz),
 first_confirmation_id text COLLATE "C" NOT NULL CHECK(length(first_confirmation_id)>0),
 second_confirmation_id text COLLATE "C" NOT NULL CHECK(length(second_confirmation_id)>0),
 CHECK(first_agent_id < second_agent_id), CHECK(first_confirmation_id <> second_confirmation_id),
 UNIQUE(first_agent_id,second_agent_id)
);
CREATE INDEX friendships_first_confirmed ON relationships.friendships(first_agent_id,id) WHERE status='confirmed';
CREATE INDEX friendships_second_confirmed ON relationships.friendships(second_agent_id,id) WHERE status='confirmed';
${FRIENDSHIPS_READ_PERMISSIONS_SQL}`};

/** The dedicated lifecycle owns writes; no DELETE, schema CREATE, or mutable completion history. */
export const FRIENDSHIPS_LIFECYCLE_PERMISSIONS_SQL=`GRANT USAGE ON SCHEMA relationships TO connet_app;
REVOKE ALL ON relationships.friendships,relationships.friendship_invitations,relationships.intimacy_facts FROM PUBLIC,connet_app;
GRANT SELECT,INSERT ON relationships.friendships TO connet_app;
GRANT UPDATE(version,intimacy_score) ON relationships.friendships TO connet_app;
GRANT SELECT,INSERT,UPDATE ON relationships.friendship_invitations TO connet_app;
GRANT SELECT,INSERT ON relationships.intimacy_facts TO connet_app;`;

export const FRIENDSHIPS_LIFECYCLE_MIGRATION={moduleId:'friendships',version:2,name:'independent_invitation_and_deduplicated_intimacy',dependencies:['friendships','runtime','interaction'],sql:`
ALTER TABLE relationships.friendships ADD COLUMN intimacy_score bigint NOT NULL DEFAULT 0 CHECK(intimacy_score BETWEEN 0 AND 100);
ALTER TABLE relationships.friendships DROP CONSTRAINT friendships__present_check;
ALTER TABLE relationships.friendships ADD CONSTRAINT friendships__present_check CHECK(_present <@ ARRAY['firstAgentId','secondAgentId','status','confirmedAt','firstConfirmationId','secondConfirmationId','intimacyScore']::text[]);
UPDATE relationships.friendships SET _present=_present||ARRAY['intimacyScore']::text[];
CREATE TABLE relationships.friendship_invitations(
 id text COLLATE "C" PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 _codec_version integer NOT NULL DEFAULT 1 CHECK(_codec_version=1),
 _present text[] NOT NULL CHECK(_present <@ ARRAY['fromAgentId','toAgentId','message','state','createdAt','deadline','respondedAt','friendshipId','senderActorKind','senderActorId','responseActorKind','responseActorId','senderConfirmationId','responseConfirmationId','invalidationCode','sharedGeneration','fromSharingGeneration','toSharingGeneration']::text[]),
 _nulls text[] NOT NULL CHECK(_nulls <@ _present),
 from_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id),to_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id),
 first_agent_id text COLLATE "C" GENERATED ALWAYS AS(least(from_agent_id,to_agent_id)) STORED,
 second_agent_id text COLLATE "C" GENERATED ALWAYS AS(greatest(from_agent_id,to_agent_id)) STORED,
 message text NOT NULL CHECK(length(message)<=120),state text NOT NULL CHECK(state IN ('pending','accepted','declined','cancelled','expired')),
 created_at timestamptz NOT NULL CHECK(created_at>='1970-01-01'::timestamptz),deadline timestamptz NOT NULL,responded_at timestamptz,
 friendship_id text COLLATE "C" REFERENCES relationships.friendships(id) DEFERRABLE INITIALLY DEFERRED,
 sender_actor_kind text NOT NULL CHECK(sender_actor_kind IN ('agent','owner')),sender_actor_id text NOT NULL CHECK(length(sender_actor_id)>0),
 response_actor_kind text CHECK(response_actor_kind IN ('agent','owner','system')),response_actor_id text,
 sender_confirmation_id text NOT NULL CHECK(length(sender_confirmation_id)>0),response_confirmation_id text,invalidation_code text,
 shared_generation bigint NOT NULL CHECK(shared_generation>=0),from_sharing_generation bigint NOT NULL CHECK(from_sharing_generation>=1),to_sharing_generation bigint NOT NULL CHECK(to_sharing_generation>=1),
 CHECK(from_agent_id<>to_agent_id),CHECK(deadline=created_at+interval '604800 seconds'),CHECK(responded_at IS NULL OR responded_at>=created_at),
 CHECK((state='accepted')=(friendship_id IS NOT NULL)),
 CHECK((state='pending')=(responded_at IS NULL)),
 CHECK((response_actor_kind IS NULL)=(response_actor_id IS NULL)),
 CHECK((state IN ('accepted','declined','cancelled'))=(response_actor_kind IS NOT NULL)),
 CHECK((response_actor_kind='system' AND state='cancelled' AND response_actor_id='relationships-invalidation' AND response_confirmation_id IS NULL AND invalidation_code IS NOT NULL) OR (response_actor_kind IS DISTINCT FROM 'system' AND (response_actor_kind IS NULL)=(response_confirmation_id IS NULL) AND invalidation_code IS NULL)),
 CHECK(sender_actor_kind<>'agent' OR sender_actor_id=from_agent_id),
 CHECK(response_actor_kind IS DISTINCT FROM 'agent' OR response_actor_id=CASE WHEN state='cancelled' THEN from_agent_id ELSE to_agent_id END)
);
CREATE UNIQUE INDEX friendship_pending_pair ON relationships.friendship_invitations(first_agent_id,second_agent_id) WHERE state='pending';
CREATE INDEX friendship_invitation_received ON relationships.friendship_invitations(to_agent_id,id);
CREATE INDEX friendship_invitation_sent ON relationships.friendship_invitations(from_agent_id,id);
CREATE TABLE relationships.intimacy_facts(
 friendship_id text COLLATE "C" NOT NULL REFERENCES relationships.friendships(id),source_domain text NOT NULL CHECK(source_domain='interaction'),
 source_id text COLLATE "C" NOT NULL REFERENCES interaction.activities(id),score_kind text NOT NULL CHECK(score_kind='text_feedback_completed'),
 from_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id),to_agent_id text COLLATE "C" NOT NULL REFERENCES iam.agents(id),
 invitation_created_at timestamptz NOT NULL,completed_at timestamptz NOT NULL CHECK(completed_at>=invitation_created_at),delta integer NOT NULL CHECK(delta IN (0,1)),
 PRIMARY KEY(friendship_id,source_domain,source_id,score_kind),CHECK(from_agent_id<>to_agent_id)
);
CREATE TRIGGER immutable_intimacy_fact BEFORE UPDATE OR DELETE ON relationships.intimacy_facts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION relationships.protect_friendship_invitation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version<>OLD.version+1 OR OLD.state<>'pending' OR NEW.state='pending'
 OR (to_jsonb(NEW)-ARRAY['version','state','responded_at','friendship_id','response_actor_kind','response_actor_id','response_confirmation_id','invalidation_code','_nulls']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','responded_at','friendship_id','response_actor_kind','response_actor_id','response_confirmation_id','invalidation_code','_nulls']) THEN RAISE EXCEPTION 'Fixed friendship invitation or terminal state changed' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER friendship_invitation_transition BEFORE UPDATE ON relationships.friendship_invitations FOR EACH ROW EXECUTE FUNCTION relationships.protect_friendship_invitation();
CREATE FUNCTION relationships.protect_friendship() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','intimacy_score']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','intimacy_score'])
 OR NEW.intimacy_score<OLD.intimacy_score OR NEW.intimacy_score>least(100,OLD.intimacy_score+1) THEN RAISE EXCEPTION 'Confirmed friendship or score changed outside a completion' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER confirmed_friendship_fixed BEFORE UPDATE ON relationships.friendships FOR EACH ROW EXECUTE FUNCTION relationships.protect_friendship();
${FRIENDSHIPS_LIFECYCLE_PERMISSIONS_SQL}
`};
