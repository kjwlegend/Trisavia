/** Append after Life B source tables. Existing welcome, wage and service-item rows are untouched. */
export const LIFE_COMMERCE_MIGRATION={moduleId:'life_assets',version:1,name:'source_bound_shop_and_fishing_assets',dependencies:['wallet','life','runtime','perception'],sql:`
CREATE SCHEMA life_assets;
CREATE TABLE life_assets.effects(
 id text COLLATE "C" PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('buy','sell','fishing.reserve','fishing.start','fishing.settle','fishing.release')),
 source_id text COLLATE "C" NOT NULL,actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,
 agent_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='agent' THEN actor_id END) STORED REFERENCES iam.agents(id),
 npc_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='npc' THEN actor_id END) STORED REFERENCES town_services.npcs(npc_id),
 source_activity_id text GENERATED ALWAYS AS(CASE WHEN kind IN ('buy','sell') THEN source_id END) STORED REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,
 source_session_id text GENERATED ALWAYS AS(CASE WHEN kind IN ('fishing.reserve','fishing.release') THEN source_id END) STORED REFERENCES life.fishing_sessions(id) DEFERRABLE INITIALLY DEFERRED,
 source_cast_id text GENERATED ALWAYS AS(CASE WHEN kind IN ('fishing.start','fishing.settle') THEN source_id END) STORED REFERENCES life.fishing_casts(id) DEFERRABLE INITIALLY DEFERRED,
 source_event_id text REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 occurred_at bigint NOT NULL CHECK(occurred_at BETWEEN 0 AND 9007199254740991),recorded_at bigint NOT NULL CHECK(recorded_at BETWEEN occurred_at AND 9007199254740991),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(octet_length(result::text)<=16384),UNIQUE(kind,source_id));
CREATE TRIGGER immutable_life_asset_effect BEFORE UPDATE OR DELETE ON life_assets.effects FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TABLE life_assets.instances(
 id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL,
 agent_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='agent' THEN actor_id END) STORED REFERENCES iam.agents(id),
 npc_id text GENERATED ALWAYS AS(CASE WHEN actor_kind='npc' THEN actor_id END) STORED REFERENCES town_services.npcs(npc_id),
 item_id text NOT NULL CHECK(item_id IN ('basic_rod','bait','sardine','mackerel','sea_bass')),
 state text NOT NULL CHECK(state IN ('available','reserved','consumed','sold')),reservation_id text,
 source_id text NOT NULL,issued_effect_id text NOT NULL REFERENCES life_assets.effects(id) DEFERRABLE INITIALLY DEFERRED,
 issued_at bigint NOT NULL CHECK(issued_at BETWEEN 0 AND 9007199254740991),updated_at bigint NOT NULL CHECK(updated_at BETWEEN issued_at AND 9007199254740991),
 fish jsonb CHECK(fish IS NULL OR octet_length(fish::text)<=1024),CHECK((state='reserved')=(reservation_id IS NOT NULL)),
 CHECK((item_id IN ('sardine','mackerel','sea_bass'))=(fish IS NOT NULL)),CHECK(state<>'consumed' OR item_id='bait'),CHECK(state<>'sold' OR item_id IN ('sardine','mackerel','sea_bass')));
CREATE INDEX life_asset_owner ON life_assets.instances(actor_kind,actor_id,id COLLATE "C");
CREATE FUNCTION life_assets.protect_instance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['version','state','reservation_id','updated_at','agent_id','npc_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','reservation_id','updated_at','agent_id','npc_id'])
 OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.state='sold'
 OR NOT ((OLD.state='available' AND NEW.state IN ('reserved','sold')) OR (OLD.state='reserved' AND NEW.state IN ('available','consumed')) OR (OLD.state='consumed' AND OLD.item_id='bait' AND NEW.state='available'))
 THEN RAISE EXCEPTION 'Life item identity or state transition changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER life_asset_transition BEFORE UPDATE ON life_assets.instances FOR EACH ROW EXECUTE FUNCTION life_assets.protect_instance();
CREATE TABLE life_assets.fishing_reservations(
 session_id text COLLATE "C" PRIMARY KEY REFERENCES life.fishing_sessions(id) DEFERRABLE INITIALLY DEFERRED,actor_kind text NOT NULL,actor_id text COLLATE "C" NOT NULL,
 rod_id text NOT NULL REFERENCES life_assets.instances(id),requested_casts integer NOT NULL CHECK(requested_casts BETWEEN 1 AND 5),
 released boolean NOT NULL DEFAULT false,created_at bigint NOT NULL,released_at bigint,
 CHECK(released=(released_at IS NOT NULL)));
CREATE TABLE life_assets.fishing_units(
 session_id text NOT NULL REFERENCES life_assets.fishing_reservations(session_id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 4),
 instance_id text NOT NULL REFERENCES life_assets.instances(id),cast_id text UNIQUE REFERENCES life.fishing_casts(id) DEFERRABLE INITIALLY DEFERRED,
 state text NOT NULL CHECK(state IN ('reserved','consumed','returned','released')),PRIMARY KEY(session_id,ordinal),UNIQUE(session_id,instance_id));
CREATE TABLE wallet.life_postings(
 id text COLLATE "C" PRIMARY KEY,effect_id text NOT NULL UNIQUE REFERENCES life_assets.effects(id) DEFERRABLE INITIALLY DEFERRED,
 reason text NOT NULL CHECK(reason IN ('life.shop.purchase','life.shop.sale')),source_activity_id text NOT NULL UNIQUE REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,
 source_event_id text NOT NULL UNIQUE REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text NOT NULL,
 agent_account_id text REFERENCES wallet.accounts(id),npc_account_id text REFERENCES wallet.npc_accounts(npc_id),
 currency_code text NOT NULL CHECK(currency_code='star_coin'),scale integer NOT NULL CHECK(scale=0),
 delta bigint NOT NULL CHECK(delta BETWEEN -9007199254740991 AND 9007199254740991 AND delta<>0),
 balance_before bigint NOT NULL CHECK(balance_before BETWEEN 0 AND 9007199254740991),balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991 AND balance_after=balance_before+delta),
 version_before bigint NOT NULL CHECK(version_before BETWEEN 1 AND 9007199254740990),version_after bigint NOT NULL CHECK(version_after=version_before+1),
 catalog_revision integer NOT NULL CHECK(catalog_revision=2),rule_version integer NOT NULL CHECK(rule_version=1),occurred_at bigint NOT NULL,recorded_at bigint NOT NULL CHECK(recorded_at>=occurred_at),
 CHECK(num_nonnulls(agent_account_id,npc_account_id)=1),
 CHECK((actor_kind='agent' AND agent_account_id='star_coin:'||actor_id) OR (actor_kind='npc' AND npc_account_id=actor_id)),
 CHECK((reason='life.shop.purchase' AND delta<0) OR (reason='life.shop.sale' AND delta>0)));
CREATE TRIGGER immutable_life_posting BEFORE UPDATE OR DELETE ON wallet.life_postings FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const LIFE_COMMERCE_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA life_assets FROM connet_app;GRANT USAGE ON SCHEMA life_assets TO connet_app;
REVOKE ALL ON ALL TABLES IN SCHEMA life_assets FROM connet_app;GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA life_assets TO connet_app;
GRANT UPDATE(version,state,reservation_id,updated_at) ON life_assets.instances TO connet_app;
GRANT UPDATE(released,released_at) ON life_assets.fishing_reservations TO connet_app;
GRANT UPDATE(cast_id,state) ON life_assets.fishing_units TO connet_app;
REVOKE ALL ON wallet.life_postings FROM connet_app;GRANT SELECT,INSERT ON wallet.life_postings TO connet_app;`;
