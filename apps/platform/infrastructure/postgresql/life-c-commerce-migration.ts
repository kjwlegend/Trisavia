/** C-only append. The composition owner must install real C activity/consent sources before enabling this port. */
export const LIFE_C_COMMERCE_MIGRATION={moduleId:'life_assets',version:3,name:'c_food_lodging_reservations_and_accepted_gift_transfer',dependencies:['life_assets','wallet','life','runtime'],sql:`
ALTER TABLE wallet.accounts ADD COLUMN reserved_balance bigint NOT NULL DEFAULT 0 CHECK(reserved_balance BETWEEN 0 AND balance);
ALTER TABLE wallet.npc_accounts ADD COLUMN reserved_balance bigint NOT NULL DEFAULT 0 CHECK(reserved_balance BETWEEN 0 AND balance);
CREATE OR REPLACE FUNCTION wallet.protect_npc_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['version','balance','reserved_balance']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','balance','reserved_balance']) OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'NPC wallet identity or credit version changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
ALTER TABLE life_assets.effects DROP CONSTRAINT effects_kind_check;
ALTER TABLE life_assets.effects ADD CONSTRAINT effects_kind_check CHECK(kind IN ('buy','sell','fishing.reserve','fishing.start','fishing.settle','fishing.release','c.buy','c.activity.reserve','c.activity.settle','c.gift.reserve','c.gift.settle'));
ALTER TABLE life_assets.effects ADD COLUMN c_activity_id text GENERATED ALWAYS AS(CASE WHEN kind IN ('c.buy','c.activity.reserve','c.activity.settle') THEN source_id END) STORED REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE life_assets.instances DROP CONSTRAINT instances_item_id_check;
ALTER TABLE life_assets.instances ADD CONSTRAINT instances_item_id_check CHECK(item_id IN ('basic_rod','bait','sardine','mackerel','sea_bass','bread_meal','herbal_tea','grilled_fish','harbor_handbook'));
DO $$ DECLARE n text;BEGIN SELECT conname INTO STRICT n FROM pg_constraint WHERE conrelid='life_assets.instances'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%consumed%' AND pg_get_constraintdef(oid) LIKE '%bait%';EXECUTE format('ALTER TABLE life_assets.instances DROP CONSTRAINT %I',n);END $$;
ALTER TABLE life_assets.instances ADD CONSTRAINT life_c_consumable CHECK(state<>'consumed' OR item_id IN ('bait','sardine','mackerel','sea_bass','bread_meal','herbal_tea','grilled_fish'));
ALTER TABLE wallet.life_postings DROP CONSTRAINT life_postings_catalog_revision_check;
ALTER TABLE wallet.life_postings ADD CONSTRAINT life_postings_catalog_revision_check CHECK(catalog_revision IN (2,3));
ALTER TABLE wallet.life_postings DROP CONSTRAINT life_postings_reason_check;
ALTER TABLE wallet.life_postings ADD CONSTRAINT life_postings_reason_check CHECK(reason IN ('life.shop.purchase','life.shop.sale','life.meal.prepare','life.rest.inn'));
DO $$ DECLARE n text;BEGIN SELECT conname INTO STRICT n FROM pg_constraint WHERE conrelid='wallet.life_postings'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%reason%' AND pg_get_constraintdef(oid) LIKE '%delta%';EXECUTE format('ALTER TABLE wallet.life_postings DROP CONSTRAINT %I',n);END $$;
ALTER TABLE wallet.life_postings ADD CONSTRAINT life_c_money_direction CHECK((reason IN ('life.shop.purchase','life.meal.prepare','life.rest.inn') AND delta<0) OR (reason='life.shop.sale' AND delta>0));
CREATE TABLE life_assets.c_activity_reservations(
 activity_id text COLLATE "C" PRIMARY KEY REFERENCES life.activities(id) DEFERRABLE INITIALLY DEFERRED,
 actor_kind text NOT NULL CHECK(actor_kind IN ('agent','npc')),actor_id text NOT NULL,
 reserved_coins bigint NOT NULL CHECK(reserved_coins BETWEEN 0 AND 9007199254740991),item_id text REFERENCES life_assets.instances(id),
 state text NOT NULL CHECK(state IN ('reserved','settled','released')),created_at bigint NOT NULL,ended_at bigint,
 CHECK((state='reserved')=(ended_at IS NULL)));
CREATE TABLE life_assets.c_gift_reservations(
 gift_id text COLLATE "C" PRIMARY KEY,from_agent_id text NOT NULL REFERENCES iam.agents(id),to_agent_id text NOT NULL REFERENCES iam.agents(id),
 state text NOT NULL CHECK(state IN ('reserved','accepted','released')),created_at bigint NOT NULL,ended_at bigint,
 CHECK(from_agent_id<>to_agent_id),CHECK((state='reserved')=(ended_at IS NULL)));
CREATE TABLE life_assets.c_gift_units(gift_id text NOT NULL REFERENCES life_assets.c_gift_reservations(gift_id),instance_id text NOT NULL REFERENCES life_assets.instances(id),PRIMARY KEY(gift_id,instance_id));
CREATE FUNCTION life_assets.protect_c_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'reserved' OR NEW.state='reserved' OR NEW.ended_at<OLD.created_at OR (to_jsonb(NEW)-ARRAY['state','ended_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','ended_at']) THEN RAISE EXCEPTION 'C reservation identity or terminal state changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER c_activity_reservation_fixed BEFORE UPDATE ON life_assets.c_activity_reservations FOR EACH ROW EXECUTE FUNCTION life_assets.protect_c_reservation();
CREATE TRIGGER c_gift_reservation_fixed BEFORE UPDATE ON life_assets.c_gift_reservations FOR EACH ROW EXECUTE FUNCTION life_assets.protect_c_reservation();
CREATE TRIGGER c_gift_units_fixed BEFORE UPDATE OR DELETE ON life_assets.c_gift_units FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE OR REPLACE FUNCTION life_assets.protect_instance() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE transfer boolean;BEGIN
 transfer=OLD.actor_kind='agent' AND NEW.actor_kind='agent' AND OLD.actor_id<>NEW.actor_id AND OLD.state='reserved' AND NEW.state='available' AND NEW.reservation_id IS NULL
 AND EXISTS(SELECT 1 FROM life_assets.c_gift_reservations g JOIN life_assets.c_gift_units u ON u.gift_id=g.gift_id WHERE g.gift_id=OLD.reservation_id AND g.state='accepted' AND g.from_agent_id=OLD.actor_id AND g.to_agent_id=NEW.actor_id AND u.instance_id=OLD.id);
 IF (to_jsonb(NEW)-ARRAY['version','state','reservation_id','updated_at','agent_id','npc_id','actor_kind','actor_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','reservation_id','updated_at','agent_id','npc_id','actor_kind','actor_id'])
 OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.state='sold'
 OR ((NEW.actor_kind<>OLD.actor_kind OR NEW.actor_id<>OLD.actor_id) AND NOT transfer)
 OR NOT ((OLD.state='available' AND NEW.state IN ('reserved','sold')) OR (OLD.state='reserved' AND NEW.state IN ('available','consumed')) OR (OLD.state='consumed' AND OLD.item_id='bait' AND NEW.state='available'))
 THEN RAISE EXCEPTION 'Life item identity or state transition changed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
`};
export const LIFE_C_COMMERCE_PERMISSIONS_SQL=`GRANT SELECT,INSERT ON life_assets.c_activity_reservations,life_assets.c_gift_reservations,life_assets.c_gift_units TO connet_app;
GRANT UPDATE(state,ended_at) ON life_assets.c_activity_reservations,life_assets.c_gift_reservations TO connet_app;
GRANT UPDATE(actor_id) ON life_assets.instances TO connet_app;
GRANT UPDATE(reserved_balance) ON wallet.accounts,wallet.npc_accounts TO connet_app;`;
