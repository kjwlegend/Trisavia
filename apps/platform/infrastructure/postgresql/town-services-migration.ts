export const TOWN_SERVICES_MIGRATION={moduleId:'town_services',version:1,name:'independent_npcs_service_items_and_completions',dependencies:['iam','world','runtime','inventory','items'],sql:`
CREATE SCHEMA town_services;
CREATE TABLE town_services.npcs(npc_id text COLLATE "C" PRIMARY KEY,created_at bigint NOT NULL CHECK(created_at>=0));
CREATE TABLE town_services.catalogs(version bigint PRIMARY KEY CHECK(version>0),activated_at bigint NOT NULL CHECK(activated_at>=0),definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=32768));
CREATE TABLE town_services.control(singleton integer PRIMARY KEY CHECK(singleton=1),catalog_version bigint NOT NULL REFERENCES town_services.catalogs(version));
CREATE TABLE town_services.operations(
 id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),agent_id text NOT NULL REFERENCES iam.agents(id),npc_id text NOT NULL REFERENCES town_services.npcs(npc_id),
 service_id text NOT NULL CHECK(service_id IN ('greet','welcome.claim','tavern.host','inn.rest')),catalog_version bigint NOT NULL REFERENCES town_services.catalogs(version),campaign_id text,
 state text NOT NULL CHECK(state IN ('active','completed','cancelled')),started_at bigint NOT NULL CHECK(started_at>=0),ended_at bigint CHECK(ended_at>=started_at),
 item_instance_id text,topic text CHECK(topic IN ('welcome','town')),response text CHECK(length(response)<=1000),cancel_code text CHECK(length(cancel_code)<=100),qualification jsonb NOT NULL CHECK(jsonb_typeof(qualification)='object' AND octet_length(qualification::text)<=4096),
 CHECK((state='active')=(ended_at IS NULL)),CHECK(state<>'active' OR service_id='inn.rest'),CHECK((campaign_id IS NOT NULL)=(service_id='welcome.claim')));
CREATE UNIQUE INDEX town_claim_once ON town_services.operations(agent_id,campaign_id) WHERE campaign_id IS NOT NULL AND state='completed';
CREATE UNIQUE INDEX town_one_active_rest ON town_services.operations(agent_id) WHERE state='active';
CREATE INDEX town_operations_agent ON town_services.operations(agent_id,id COLLATE "C");
CREATE TABLE town_services.item_instances(
 id text COLLATE "C" PRIMARY KEY,version bigint NOT NULL CHECK(version>0),agent_id text NOT NULL REFERENCES iam.agents(id),kind text NOT NULL CHECK(kind IN ('tavern_voucher','inn_voucher')),
 state text NOT NULL CHECK(state IN ('available','reserved','consumed')),source_operation_id text NOT NULL REFERENCES town_services.operations(id),issued_at bigint NOT NULL CHECK(issued_at>=0),updated_at bigint NOT NULL CHECK(updated_at>=issued_at),reservation_id text REFERENCES town_services.operations(id) DEFERRABLE INITIALLY DEFERRED,consumed_by text REFERENCES town_services.operations(id) DEFERRABLE INITIALLY DEFERRED,holding_id text NOT NULL UNIQUE REFERENCES inventory.holdings(id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(source_operation_id,kind),CHECK((state='reserved')=(reservation_id IS NOT NULL)),CHECK((state='consumed')=(consumed_by IS NOT NULL)));
ALTER TABLE town_services.operations ADD FOREIGN KEY(item_instance_id) REFERENCES town_services.item_instances(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX town_items_agent ON town_services.item_instances(agent_id,id COLLATE "C");
CREATE TABLE town_services.npc_relations(agent_id text NOT NULL REFERENCES iam.agents(id),npc_id text NOT NULL REFERENCES town_services.npcs(npc_id),version bigint NOT NULL CHECK(version>0),familiarity integer NOT NULL CHECK(familiarity BETWEEN 0 AND 100),created_at bigint NOT NULL CHECK(created_at>=0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),PRIMARY KEY(agent_id,npc_id));
CREATE TABLE town_services.familiarity_facts(agent_id text NOT NULL,npc_id text NOT NULL,service_id text NOT NULL CHECK(service_id IN ('welcome.claim','tavern.host','inn.rest')),operation_id text NOT NULL UNIQUE REFERENCES town_services.operations(id),completed_at bigint NOT NULL CHECK(completed_at>=0),delta integer NOT NULL CHECK(delta BETWEEN 0 AND 1),PRIMARY KEY(agent_id,npc_id,service_id),FOREIGN KEY(agent_id,npc_id) REFERENCES town_services.npc_relations(agent_id,npc_id));
CREATE TRIGGER immutable_town_npc BEFORE UPDATE OR DELETE ON town_services.npcs FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER immutable_town_catalog BEFORE UPDATE OR DELETE ON town_services.catalogs FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
CREATE TRIGGER immutable_npc_familiarity_fact BEFORE UPDATE OR DELETE ON town_services.familiarity_facts FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();
`};
export const TOWN_BEHAVIOR_MIGRATION={moduleId:'behavior',version:2,name:'town_services_source_projection',dependencies:['behavior','town_services'],sql:`
ALTER TABLE behavior.coverage DROP CONSTRAINT coverage_scope_check;
ALTER TABLE behavior.coverage ADD CONSTRAINT coverage_scope_check CHECK(scope IN ('world_explicit','world_idle','relationships','interaction','town_services'));
ALTER TABLE behavior.records DROP CONSTRAINT records_source_domain_check;
ALTER TABLE behavior.records ADD CONSTRAINT records_source_domain_check CHECK(source_domain IN ('world','relationships','interaction','town_services'));
`};
export const TOWN_PERMISSIONS_SQL=`REVOKE ALL ON SCHEMA town_services FROM connet_app;GRANT USAGE ON SCHEMA town_services TO connet_app;
REVOKE ALL ON ALL TABLES IN SCHEMA town_services FROM connet_app;
GRANT SELECT ON ALL TABLES IN SCHEMA town_services TO connet_app;
GRANT INSERT ON town_services.operations,town_services.item_instances,town_services.npc_relations,town_services.familiarity_facts TO connet_app;
GRANT UPDATE(version,state,ended_at,cancel_code) ON town_services.operations TO connet_app;
GRANT UPDATE(version,state,updated_at,reservation_id,consumed_by) ON town_services.item_instances TO connet_app;
GRANT UPDATE(version,familiarity,updated_at) ON town_services.npc_relations TO connet_app;`;
