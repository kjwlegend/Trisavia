/** Registered by the composition owner after life.activities exists. No existing wallet or welcome row is rewritten. */
export const LIFE_WALLET_MIGRATION={moduleId:'wallet',version:2,name:'atomic_life_wages_and_distinct_npc_accounts',dependencies:['wallet','life','runtime','town_services'],sql:`
CREATE TABLE wallet.npc_accounts(
 actor_kind text NOT NULL CHECK(actor_kind='npc'),npc_id text COLLATE "C" PRIMARY KEY REFERENCES town_services.npcs(npc_id),
 currency_code text NOT NULL CHECK(currency_code='star_coin'),scale integer NOT NULL CHECK(scale=0),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),balance bigint NOT NULL CHECK(balance BETWEEN 0 AND 9007199254740991),
 initialized_at bigint NOT NULL CHECK(initialized_at BETWEEN 0 AND 9007199254740991),initialization_source text NOT NULL CHECK(initialization_source='life.npc.initialization'));
CREATE TABLE wallet.life_credits(
 id text COLLATE "C" PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),reason text NOT NULL CHECK(reason IN ('life.work.reward','life.npc.initialization')),
 source_id text COLLATE "C" NOT NULL CHECK(length(source_id) BETWEEN 1 AND 256),actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text COLLATE "C" NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 256),
 agent_account_id text REFERENCES wallet.accounts(id),npc_account_id text REFERENCES wallet.npc_accounts(npc_id),
 source_activity_id text REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,source_event_id text REFERENCES runtime.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 catalog_revision bigint NOT NULL CHECK(catalog_revision BETWEEN 1 AND 9007199254740991),rule_version bigint NOT NULL CHECK(rule_version BETWEEN 1 AND 9007199254740991),job_id text,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),occurred_at bigint NOT NULL CHECK(occurred_at BETWEEN 0 AND 9007199254740991),recorded_at bigint NOT NULL CHECK(recorded_at BETWEEN occurred_at AND 9007199254740991),
 balance_before bigint NOT NULL CHECK(balance_before BETWEEN 0 AND 9007199254740991),balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991 AND balance_after=balance_before+amount),
 account_version_before bigint NOT NULL CHECK(account_version_before BETWEEN 1 AND 9007199254740990),account_version_after bigint NOT NULL CHECK(account_version_after=account_version_before+1),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),UNIQUE(reason,source_id),UNIQUE(source_activity_id),UNIQUE(source_event_id),
 CHECK(num_nonnulls(agent_account_id,npc_account_id)=1),
 CHECK((actor_kind='agent' AND agent_account_id='star_coin:'||actor_id AND npc_account_id IS NULL) OR (actor_kind='npc' AND npc_account_id=actor_id AND agent_account_id IS NULL)),
 CHECK((reason='life.work.reward' AND source_activity_id IS NOT NULL AND source_activity_id=source_id AND source_event_id IS NOT NULL AND job_id IS NOT NULL)
  OR (reason='life.npc.initialization' AND actor_kind='npc' AND source_id=actor_id AND source_activity_id IS NULL AND source_event_id IS NULL AND job_id IS NULL)));
CREATE INDEX life_credit_actor ON wallet.life_credits(actor_kind,actor_id,id COLLATE "C");
CREATE TRIGGER immutable_life_credit BEFORE UPDATE OR DELETE ON wallet.life_credits FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION wallet.protect_npc_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['version','balance']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','balance']) OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'NPC wallet identity or credit version changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER npc_account_frozen_identity BEFORE UPDATE ON wallet.npc_accounts FOR EACH ROW EXECUTE FUNCTION wallet.protect_npc_account();
`};
export const LIFE_WALLET_PERMISSIONS_SQL=`REVOKE ALL ON wallet.npc_accounts,wallet.life_credits FROM connet_app;
GRANT SELECT,INSERT ON wallet.npc_accounts,wallet.life_credits TO connet_app;
GRANT UPDATE(version,balance) ON wallet.npc_accounts TO connet_app;`;
