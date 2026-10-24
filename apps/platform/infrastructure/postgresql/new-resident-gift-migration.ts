import {BASE_MODELS} from './model.ts';
const holdingPaths=new Set<string>(['residentCard']);for(const field of BASE_MODELS.find(m=>m.table==='inventory.holdings')!.fields){const parts=field.path.split('.');for(let n=1;n<=parts.length;n++)holdingPaths.add(parts.slice(0,n).join('.'));}
export const NEW_RESIDENT_GIFT_MIGRATION={moduleId:'town_services',version:2,name:'shared_resident_card_and_atomic_fixed_welcome_credit',dependencies:['town_services','wallet','inventory'],sql:`
ALTER TABLE town_services.operations ADD CONSTRAINT town_operation_agent_identity UNIQUE(id,agent_id);
CREATE TABLE town_services.resident_gifts(id text PRIMARY KEY,agent_id text NOT NULL UNIQUE REFERENCES iam.agents(id),created_at bigint NOT NULL CHECK(created_at>=0),source_operation_id text,initiator_kind text NOT NULL CHECK(initiator_kind IN ('agent','administrator')),initiator_id text NOT NULL CHECK(length(initiator_id) BETWEEN 1 AND 240),UNIQUE(id,agent_id),FOREIGN KEY(source_operation_id,agent_id) REFERENCES town_services.operations(id,agent_id),CHECK((initiator_kind='agent')=(source_operation_id IS NOT NULL)));
CREATE TABLE town_services.resident_gift_batches(id text PRIMARY KEY,operator text NOT NULL,operation_id text NOT NULL,created_at bigint NOT NULL CHECK(created_at>=0),agent_ids jsonb NOT NULL CHECK(jsonb_typeof(agent_ids)='array' AND jsonb_array_length(agent_ids)<=1000),UNIQUE(operator,operation_id));
CREATE TRIGGER immutable_resident_gift_batch BEFORE UPDATE OR DELETE ON town_services.resident_gift_batches FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER immutable_resident_gift BEFORE UPDATE OR DELETE ON town_services.resident_gifts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE FUNCTION town_services.validate_resident_gift() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='connet_app' AND (NEW.initiator_kind<>'agent' OR NEW.initiator_id<>NEW.agent_id OR NOT EXISTS(SELECT 1 FROM town_services.operations o WHERE o.id=NEW.source_operation_id AND o.agent_id=NEW.agent_id AND o.service_id='welcome.claim' AND o.state='completed' AND o.catalog_version>=2 AND o.ended_at=NEW.created_at)) THEN RAISE EXCEPTION 'Resident gift requires the real completed claim or migration authority' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER real_resident_gift_source BEFORE INSERT ON town_services.resident_gifts FOR EACH ROW EXECUTE FUNCTION town_services.validate_resident_gift();
ALTER TABLE town_services.item_instances DROP CONSTRAINT item_instances_kind_check;
ALTER TABLE town_services.item_instances ADD CONSTRAINT item_instances_kind_check CHECK(kind IN ('tavern_voucher','inn_voucher','resident_card'));
ALTER TABLE town_services.item_instances ALTER COLUMN source_operation_id DROP NOT NULL;
ALTER TABLE town_services.item_instances ADD COLUMN source_gift_id text;
ALTER TABLE town_services.item_instances ADD FOREIGN KEY(source_gift_id,agent_id) REFERENCES town_services.resident_gifts(id,agent_id);
ALTER TABLE town_services.item_instances ADD COLUMN resident_card jsonb;
ALTER TABLE town_services.item_instances ADD CONSTRAINT resident_card_identity CHECK(
 (kind<>'resident_card' AND resident_card IS NULL AND source_gift_id IS NULL AND source_operation_id IS NOT NULL) OR
 (kind='resident_card' AND source_gift_id IS NOT NULL AND state='available' AND reservation_id IS NULL AND consumed_by IS NULL AND resident_card IS NOT NULL AND jsonb_typeof(resident_card)='object' AND octet_length(resident_card::text)<=4096
 AND resident_card-ARRAY['agentId','displayName','firstWorldJoinedAt','issuedAt']='{}'::jsonb AND resident_card ?& ARRAY['agentId','displayName','firstWorldJoinedAt','issuedAt']
 AND resident_card->>'agentId'=agent_id AND jsonb_typeof(resident_card->'displayName')='string' AND length(resident_card->>'displayName') BETWEEN 1 AND 240
 AND resident_card->'issuedAt'=to_jsonb(issued_at) AND (resident_card->'firstWorldJoinedAt'='null'::jsonb OR (jsonb_typeof(resident_card->'firstWorldJoinedAt')='number' AND (resident_card->>'firstWorldJoinedAt')::bigint BETWEEN 0 AND issued_at))));
CREATE UNIQUE INDEX one_resident_card_per_agent ON town_services.item_instances(agent_id) WHERE kind='resident_card';
ALTER TABLE inventory.holdings ADD COLUMN resident_card jsonb CHECK(resident_card IS NULL OR (jsonb_typeof(resident_card)='object' AND octet_length(resident_card::text)<=4096));
ALTER TABLE inventory.holdings ADD COLUMN resident_card_text text;
ALTER TABLE inventory.holdings ADD CONSTRAINT holding_resident_card_codec CHECK(resident_card IS NOT DISTINCT FROM resident_card_text::jsonb);
ALTER TABLE inventory.holdings DROP CONSTRAINT holdings__present_check;
ALTER TABLE inventory.holdings ADD CONSTRAINT holdings__present_check CHECK(_present <@ ARRAY[${[...holdingPaths].map(x=>"'"+x+"'").join(',')}]::text[]);
CREATE TABLE wallet.welcome_credits(agent_id text PRIMARY KEY REFERENCES iam.agents(id),source_gift_id text NOT NULL UNIQUE,source_operation_id text UNIQUE,amount integer NOT NULL CHECK(amount=100),granted_at bigint NOT NULL CHECK(granted_at>=0),account_version_before bigint NOT NULL CHECK(account_version_before>0),account_version_after bigint NOT NULL CHECK(account_version_after=account_version_before+1),FOREIGN KEY(source_gift_id,agent_id) REFERENCES town_services.resident_gifts(id,agent_id),FOREIGN KEY(source_operation_id,agent_id) REFERENCES town_services.operations(id,agent_id));
CREATE TRIGGER immutable_welcome_credit BEFORE UPDATE OR DELETE ON wallet.welcome_credits FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const NEW_RESIDENT_GIFT_PERMISSIONS_SQL=`REVOKE ALL ON wallet.welcome_credits,town_services.resident_gifts,town_services.resident_gift_batches FROM connet_app;GRANT SELECT,INSERT ON wallet.welcome_credits,town_services.resident_gifts TO connet_app;`;
