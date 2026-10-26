export const WORLD_EXPRESSIONS_MIGRATION={moduleId:'world',version:5,name:'bounded_current_public_expressions',dependencies:['world','runtime','iam'],sql:`
CREATE TABLE world.expressions(world_id text NOT NULL REFERENCES world.worlds(world_id),actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,
 expression_id text NOT NULL UNIQUE,created_at bigint NOT NULL,expires_at bigint NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+12000),data jsonb NOT NULL CHECK(octet_length(data::text)<=8192),PRIMARY KEY(world_id,actor_kind,actor_id));
CREATE TABLE world.expression_limits(world_id text NOT NULL REFERENCES world.worlds(world_id),actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,data jsonb NOT NULL CHECK(octet_length(data::text)<=4096),PRIMARY KEY(world_id,actor_kind,actor_id));
CREATE INDEX current_world_expressions ON world.expressions(world_id,expires_at);
`};
export const WORLD_EXPRESSIONS_PERMISSIONS_SQL=`REVOKE ALL ON world.expressions,world.expression_limits FROM connet_app;GRANT SELECT,INSERT,UPDATE ON world.expressions,world.expression_limits TO connet_app;`;
