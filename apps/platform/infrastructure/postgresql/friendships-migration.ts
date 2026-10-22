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
