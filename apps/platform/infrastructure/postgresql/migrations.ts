import {PUBLIC_IDENTIFIERS_MIGRATION} from './public-identifiers-migration.ts';
import {NEW_RESIDENT_GIFT_MIGRATION} from './new-resident-gift-migration.ts';
import {BEHAVIOR_MIGRATION} from './behavior-migration.ts';
import {TOWN_SERVICES_MIGRATION,TOWN_BEHAVIOR_MIGRATION} from './town-services-migration.ts';
import {WORLD_TOPOLOGY_MIGRATION} from './world-topology-migration.ts';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { StorageError } from '../../contracts/store.ts';
import { column, BASE_MODELS as MODELS, type Field } from './model.ts';
import { directFields, splitFields } from './codec.ts';
import { RUNTIME_MIGRATIONS } from './runtime-migrations.ts';
import { FRIENDSHIPS_MIGRATION, FRIENDSHIPS_LIFECYCLE_MIGRATION } from './friendships-migration.ts';

export interface PostgresConnectionOptions { connectionString:string; instanceId:string; recoveryEpoch:string }
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
export function sqlType(field:Field):string{return ({text:'text COLLATE "C"',integer:'bigint',boolean:'boolean',timestamp:'timestamptz',document:'jsonb',array:'jsonb',strings:'text[]',authorization:'text'} as const)[field.kind];}
function fieldSql(field:Field):string {
  const name=column(field.path),required=field.required?' NOT NULL':'';
  if(field.kind==='authorization')return `${name}_number bigint CHECK(${name}_number BETWEEN 1 AND 9007199254740991),${name}_hash text CHECK(${name}_hash ~ '^[a-f0-9]{64}$'),CHECK(num_nonnulls(${name}_number,${name}_hash)<=1)`;
  let sql=`${name} ${sqlType(field)}${required}`;
  if(field.kind==='integer')sql+=` CHECK(${name} BETWEEN -9007199254740991 AND 9007199254740991)`;
  if(field.kind==='timestamp')sql+=` CHECK(${name} >= '1970-01-01'::timestamptz)`;
  if(field.kind==='document'||field.kind==='array')sql+=` CHECK(jsonb_typeof(${name}) = '${field.kind==='document'?'object':'array'}'), ${name}_text text, CHECK(${name} IS NOT DISTINCT FROM ${name}_text::jsonb)`;
  return sql;
}
const modules=new Set(MODELS.map(model=>model.table.split('.')[0]!));
const tableSql=new Map<string,string[]>();
for(const name of modules)tableSql.set(name,[`CREATE SCHEMA IF NOT EXISTS ${name};`]);
for(const model of MODELS){
  // v1 has already been exercised in isolated databases. Add discovered source
  // fields through a new module migration, without editing those applied bytes.
  const initialFields=model.fields.filter(field=>!(model.table==='iam.email_attempts'&&field.path==='emailVerified')&&!(model.table==='iam.world_memberships'&&field.path==='sharingGeneration'));
  const allowed=new Set<string>();for(const field of initialFields){const parts=field.path.split('.');for(let index=1;index<=parts.length;index++)allowed.add(parts.slice(0,index).join('.'));}
  tableSql.get(model.table.split('.')[0]!)!.push(`CREATE TABLE ${model.table}(
    id text COLLATE "C" PRIMARY KEY CHECK(length(id)>0), version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
    _codec_version integer NOT NULL DEFAULT 1 CHECK(_codec_version=1),
    _present text[] NOT NULL CHECK(_present <@ ARRAY[${[...allowed].map(quote).join(',')}]::text[]),
    _nulls text[] NOT NULL CHECK(_nulls <@ _present),
    ${directFields(model).filter(field=>initialFields.includes(field)).map(fieldSql).join(',\n')}
    ${model.unique?.map(fields=>`, UNIQUE(${fields.map(column).join(',')})`).join('')??''}
    ${model.check?.map(check=>`, CHECK(${check})`).join('')??''}
  );`);
}
tableSql.get('platform')!.push(`CREATE TABLE platform.instance_state(singleton integer PRIMARY KEY CHECK(singleton=1), instance_id text NOT NULL, recovery_epoch text NOT NULL, write_generation bigint NOT NULL DEFAULT 0 CHECK(write_generation>=0), writes_enabled boolean NOT NULL DEFAULT false);
  CREATE TABLE platform.legacy_schema_migrations(version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at text NOT NULL);
  CREATE UNIQUE INDEX management_bindings_active_agent ON iam.management_bindings(agent_id) WHERE active;
  CREATE UNIQUE INDEX profile_agent_unique ON profiles.agent_profiles(agent_id);`);

// Frozen lists/target sets are relations, never a whole-source-row JSON mirror.
const childTables=new Map<string,{parent:string;mode:string}>();
for(const model of MODELS)for(const split of splitFields(model))childTables.set(split.table,{parent:model.table,mode:split.mode});
for(const[table,{parent,mode}]of childTables){
  const schema=table.split('.')[0]!;
  let sql:string;
  if(mode==='confirmation')sql=`CREATE TABLE ${table}(parent_id text COLLATE "C" PRIMARY KEY, confirmed_content_version bigint CHECK(confirmed_content_version BETWEEN 1 AND 9007199254740991),confirmed_at timestamptz CHECK(confirmed_at>='1970-01-01'));`;
  else if(mode==='profile')sql=`CREATE TABLE ${table}(parent_id text COLLATE "C" NOT NULL,stage text NOT NULL CHECK(stage IN ('draft','published')),ordinal integer NOT NULL DEFAULT 0,display_name text,bio text,interests text[],avatar_template text,avatar_color text,content_schema_version integer NOT NULL CHECK(content_schema_version=1),content_text text NOT NULL CHECK(jsonb_typeof(content_text::jsonb)='object'),PRIMARY KEY(parent_id,stage),CHECK(display_name IS NOT DISTINCT FROM content_text::jsonb->>'displayName'),CHECK(bio IS NOT DISTINCT FROM content_text::jsonb->>'bio'),CHECK(avatar_template IS NOT DISTINCT FROM content_text::jsonb#>>'{avatar,template}'),CHECK(avatar_color IS NOT DISTINCT FROM content_text::jsonb#>>'{avatar,color}'));`;
  else sql=`CREATE TABLE ${table}(parent_id text COLLATE "C" NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),entry_key text COLLATE "C" NOT NULL,entry_schema_version integer NOT NULL CHECK(entry_schema_version=1),entry_text text NOT NULL CHECK(entry_text::jsonb IS NOT NULL)${table==='perception.source_states'?',source_state text NOT NULL CHECK(source_state IN (\'enabled\',\'not_enabled\',\'unavailable\')),CHECK(source_state IS NOT DISTINCT FROM entry_text::jsonb#>>\'{}\')':''}${mode==='snapshot'?',collection_index integer CHECK(collection_index>=-1)':''},PRIMARY KEY(parent_id,ordinal)${mode==='map'?',UNIQUE(parent_id,entry_key)':''});`;
  tableSql.get(schema)!.push(sql);
}
tableSql.get('mailbox')!.push(`CREATE TABLE mailbox.messages(id text COLLATE "C" PRIMARY KEY,source_id text NOT NULL,source_message_key text NOT NULL,UNIQUE(source_id,source_message_key));
  CREATE TABLE mailbox.verified_senders(id text COLLATE "C" PRIMARY KEY,source_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('agent','human')),subject_module text,subject_type text,subject_id text NOT NULL,display_name text NOT NULL,authority_kind text,authority_id text,authority_version bigint,CHECK(kind<>'human' OR (authority_kind='upstream_identity' AND authority_id IS NOT NULL AND authority_version>0)));
  ALTER TABLE mailbox.message_versions ADD CONSTRAINT message_version_identity UNIQUE(id,message_id);
  ALTER TABLE mailbox.message_versions ADD COLUMN sender_agent_id text GENERATED ALWAYS AS(CASE WHEN sender__kind='agent' THEN sender__ref__id ELSE NULL END) STORED;
  CREATE INDEX mailbox_recipient_scan ON mailbox.deliveries(agent_id,id);
  CREATE INDEX mailbox_source_scan ON mailbox.message_versions(source_id,source_message_key,content_version);`);

const references:string[]=[];let refNumber=0;
function reference(table:string,cols:string,target:string,targetCols='id',cascade=false){references.push(`ALTER TABLE ${table} ADD CONSTRAINT pg_ref_${++refNumber} FOREIGN KEY(${cols}) REFERENCES ${target}(${targetCols}) ON DELETE ${cascade?'CASCADE':'RESTRICT'} DEFERRABLE INITIALLY DEFERRED;`);}
for(const model of MODELS)for(const field of directFields(model))if(field.reference)reference(model.table,column(field.path),field.reference);
for(const[table,{parent}]of childTables)reference(table,'parent_id',parent,'id',true);
reference('mailbox.message_versions','message_id','mailbox.messages');reference('mailbox.message_versions','id','mailbox.verified_senders');reference('mailbox.message_versions','sender_agent_id','iam.agents');
reference('mailbox.deliveries','message_id','mailbox.messages');reference('mailbox.deliveries','message_version_id,message_id','mailbox.message_versions','id,message_id');

const objectModels=MODELS.filter(model=>model.logical==='perception_objects');
tableSql.get('perception')!.push(`CREATE TABLE perception.reference_aliases(external_id text COLLATE "C" PRIMARY KEY,target_table text NOT NULL CHECK(target_table IN (${objectModels.map(model=>quote(model.table)).join(',')})),target_key text COLLATE "C" NOT NULL,module_id text NOT NULL,type text NOT NULL,ref_id text NOT NULL,UNIQUE(module_id,type,ref_id)${objectModels.map((model,index)=>`,target_${index} text GENERATED ALWAYS AS(CASE WHEN target_table=${quote(model.table)} THEN target_key ELSE NULL END) STORED`).join('')});`);
for(const[modelIndex,model]of objectModels.entries())reference('perception.reference_aliases',`target_${modelIndex}`,model.table);
for(const model of MODELS.filter(model=>model.logical==='perception_grants'))reference(model.table,'object_id','perception.reference_aliases','external_id');
for(const model of MODELS){
  for(const field of directFields(model).filter(field=>['agentId','ownerId','actorId','sourceId','kind','epoch','expiresAt','humanAudienceOwnerId','categoryId'].includes(field.path)))tableSql.get(model.table.split('.')[0]!)!.push(`CREATE INDEX ON ${model.table}(${column(field.path)},id);`);
}
export const POSTGRES_MIGRATIONS=[...tableSql].map(([moduleId,sql])=>({moduleId,version:1,name:'domain_schema_v1',sql:sql.join('\n'),dependencies:[] as string[]}));
POSTGRES_MIGRATIONS.push({moduleId:'relationships',version:1,name:'deferred_domain_relationships',sql:references.join('\n'),dependencies:[...modules]});
const emailAllowed=MODELS.find(model=>model.table==='iam.email_attempts')!.fields.map(field=>quote(field.path));
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:2,name:'preserve_email_attempt_verification_declaration',sql:`ALTER TABLE iam.email_attempts ADD COLUMN email_verified boolean;
  ALTER TABLE iam.email_attempts DROP CONSTRAINT email_attempts__present_check;
  ALTER TABLE iam.email_attempts ADD CONSTRAINT email_attempts__present_check CHECK(_present <@ ARRAY[${emailAllowed.join(',')}]::text[]);`,dependencies:['iam']});
// Content identities are append-only at the database boundary as well as in
// the adapter. DML credentials must not be able to rewrite archived content.
POSTGRES_MIGRATIONS.push({moduleId:'platform',version:2,name:'immutable_versioned_content',sql:`CREATE FUNCTION platform.reject_immutable_content_change() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'Versioned content is immutable' USING ERRCODE='23514'; END;
  $$;
  ${MODELS.filter(model=>model.immutable).map(model=>`CREATE TRIGGER immutable_versioned_content BEFORE UPDATE OR DELETE ON ${model.table} FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_content_change();`).join('\n')}`,dependencies:[...modules]});
POSTGRES_MIGRATIONS.push({moduleId:'perception',version:2,name:'bounded_expired_access_lookup',sql:'CREATE INDEX access_facts_expiry_id ON perception.access_facts(recorded_at,id);',dependencies:['perception']});
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:3,name:'bounded_identity_quota_windows',sql:`CREATE INDEX email_attempts_recent ON iam.email_attempts(created_at,id);
  CREATE INDEX email_attempts_source_recent ON iam.email_attempts(source_key,created_at,id);
  CREATE INDEX recovery_requests_recent ON iam.recovery_requests(created_at,id);
  CREATE INDEX recovery_requests_owner_recent ON iam.recovery_requests(owner_id,created_at,id);
  CREATE INDEX recovery_requests_source_recent ON iam.recovery_requests(source_key,created_at,id);
  CREATE INDEX active_owner_invites ON iam.credentials(owner_id,expires_at,id) WHERE active AND kind='invite';`,dependencies:['iam']});
POSTGRES_MIGRATIONS.push({moduleId:'email',version:2,name:'bounded_code_mail_quota_windows',sql:`CREATE INDEX code_mail_recent ON email.mail_jobs(created_at,id) WHERE purpose='code';
  CREATE INDEX code_mail_owner_recent ON email.mail_jobs(owner_key,created_at,id) WHERE purpose='code';
  CREATE INDEX code_mail_source_recent ON email.mail_jobs(source_key,created_at,id) WHERE purpose='code';`,dependencies:['email','iam']});
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:4,name:'pending_recovery_authority_lookup',sql:"CREATE INDEX pending_agent_recovery ON iam.recovery_requests(agent_id,expires_at,id) WHERE status='pending';",dependencies:['iam']});
const membershipAllowed=MODELS.find(model=>model.table==='iam.world_memberships')!.fields.map(field=>quote(field.path));
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:5,name:'persistent_membership_sharing_generation',sql:`ALTER TABLE iam.world_memberships ADD COLUMN sharing_generation bigint CHECK(sharing_generation BETWEEN 1 AND 9007199254740991);
  ALTER TABLE iam.world_memberships DROP CONSTRAINT world_memberships__present_check;
  ALTER TABLE iam.world_memberships ADD CONSTRAINT world_memberships__present_check CHECK(_present <@ ARRAY[${membershipAllowed.join(',')}]::text[]);`,dependencies:['iam']});
POSTGRES_MIGRATIONS.push(...RUNTIME_MIGRATIONS);
// Applied v1 SQL stays byte-for-byte fixed. No legacy content, row version or
// receipt is rewritten when the explicit appearance branch becomes available.
POSTGRES_MIGRATIONS.push({moduleId:'profiles',version:2,name:'explicit_appearance_selection',sql:`ALTER TABLE profiles.profile_contents
  ADD COLUMN avatar_look_id text COLLATE "C", ADD COLUMN avatar_catalog_version text COLLATE "C";
  ALTER TABLE profiles.profile_contents DROP CONSTRAINT profile_contents_content_schema_version_check;
  ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_content_schema_version_check CHECK(content_schema_version IN (1,2));
  ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_avatar_union_check CHECK(
    (content_schema_version=1 AND avatar_look_id IS NULL AND avatar_catalog_version IS NULL AND
      CASE WHEN NOT (content_text::jsonb ? 'avatar') OR content_text::jsonb->'avatar'='null'::jsonb THEN true
        WHEN jsonb_typeof(content_text::jsonb->'avatar')='object' THEN ((content_text::jsonb->'avatar') - 'template' - 'color')='{}'::jsonb
        ELSE false END)
    OR (content_schema_version=2 AND avatar_template IS NULL AND avatar_color IS NULL
      AND avatar_look_id IS NOT NULL AND avatar_look_id IN ('sunnyside-human-shorthair','sunnyside-human-longhair','sunnyside-human-curlyhair','sunnyside-human-bowlhair','sunnyside-human-mophair','sunnyside-human-spikeyhair')
      AND avatar_catalog_version IS NOT NULL AND avatar_catalog_version='2026-10-21.appearance-v1.1'
      AND coalesce(content_text::jsonb->'avatar'=jsonb_build_object('lookId',avatar_look_id,'catalogVersion',avatar_catalog_version),false))
  );`,dependencies:['profiles']});
POSTGRES_MIGRATIONS.push(FRIENDSHIPS_MIGRATION,FRIENDSHIPS_LIFECYCLE_MIGRATION);
// Optional state preserves legacy Agents without backfill; applied migration bytes stay fixed.
const actionPolicyAllowed=new Set(MODELS.find(model=>model.logical==='agents')!.fields.map(field=>field.path).concat('worldActionPolicy','worldAccess.adoption').flatMap(path=>path.split('.').map((_,index)=>path.split('.').slice(0,index+1).join('.'))));
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:6,name:'owner_world_action_policy',sql:`ALTER TABLE iam.agents
 ADD COLUMN world_action_policy jsonb CHECK(jsonb_typeof(world_action_policy)='object'),
 ADD COLUMN world_action_policy_text text,
 ADD COLUMN world_access__adoption jsonb CHECK(jsonb_typeof(world_access__adoption)='object'),
 ADD COLUMN world_access__adoption_text text,
 ADD CONSTRAINT agents_world_access_adoption_text_check CHECK(world_access__adoption IS NOT DISTINCT FROM world_access__adoption_text::jsonb),
 ADD CONSTRAINT agents_world_action_policy_text_check CHECK(world_action_policy IS NOT DISTINCT FROM world_action_policy_text::jsonb);
 ALTER TABLE iam.agents DROP CONSTRAINT agents__present_check;
 ALTER TABLE iam.agents ADD CONSTRAINT agents__present_check CHECK(_present <@ ARRAY[${[...actionPolicyAllowed].map(quote).join(',')}]::text[]);`,dependencies:['iam']});
POSTGRES_MIGRATIONS.push(WORLD_TOPOLOGY_MIGRATION);
POSTGRES_MIGRATIONS.push(BEHAVIOR_MIGRATION);
POSTGRES_MIGRATIONS.push(TOWN_SERVICES_MIGRATION,TOWN_BEHAVIOR_MIGRATION);
// Existing rows deliberately remain unknown; only a new authoritative first join writes this fact.
POSTGRES_MIGRATIONS.push({moduleId:'iam',version:7,name:'source_first_world_join',dependencies:['iam'],sql:`
 ALTER TABLE iam.world_memberships ADD COLUMN first_joined_at timestamptz CHECK(first_joined_at >= '1970-01-01'::timestamptz);
 ALTER TABLE iam.world_memberships DROP CONSTRAINT world_memberships__present_check;
 ALTER TABLE iam.world_memberships ADD CONSTRAINT world_memberships__present_check CHECK(_present <@ ARRAY[${[...membershipAllowed,quote('firstJoinedAt')].join(',')}]::text[]);
 CREATE FUNCTION iam.preserve_first_world_join() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.first_joined_at IS NOT NULL AND NEW.first_joined_at IS DISTINCT FROM OLD.first_joined_at THEN RAISE EXCEPTION 'First world join cannot be rewritten' USING ERRCODE='23514';END IF;
  RETURN NEW;END $$;
 CREATE TRIGGER immutable_first_world_join BEFORE UPDATE ON iam.world_memberships FOR EACH ROW EXECUTE FUNCTION iam.preserve_first_world_join();`});
POSTGRES_MIGRATIONS.push({moduleId:'profiles',version:3,name:'bounded_hair_and_clothing_colors',dependencies:['profiles'],sql:`
 ALTER TABLE profiles.profile_contents ADD COLUMN avatar_hair_color_id text COLLATE "C" CHECK(avatar_hair_color_id IN ('original','chestnut','ink','ash','blue')),
 ADD COLUMN avatar_clothing_color_id text COLLATE "C" CHECK(avatar_clothing_color_id IN ('original','forest','clay','cream'));
 ALTER TABLE profiles.profile_contents DROP CONSTRAINT profile_contents_content_schema_version_check;
 ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_content_schema_version_check CHECK(content_schema_version IN (1,2,3));
 ALTER TABLE profiles.profile_contents DROP CONSTRAINT profile_contents_avatar_union_check;
 ALTER TABLE profiles.profile_contents ADD CONSTRAINT profile_contents_avatar_union_check CHECK(
  (content_schema_version=1 AND avatar_look_id IS NULL AND avatar_catalog_version IS NULL AND avatar_hair_color_id IS NULL AND avatar_clothing_color_id IS NULL AND
   CASE WHEN NOT (content_text::jsonb ? 'avatar') OR content_text::jsonb->'avatar'='null'::jsonb THEN true
    WHEN jsonb_typeof(content_text::jsonb->'avatar')='object' THEN ((content_text::jsonb->'avatar') - 'template' - 'color')='{}'::jsonb ELSE false END)
  OR (content_schema_version IN (2,3) AND avatar_template IS NULL AND avatar_color IS NULL
   AND avatar_look_id IS NOT NULL AND avatar_look_id IN ('sunnyside-human-shorthair','sunnyside-human-longhair','sunnyside-human-curlyhair','sunnyside-human-bowlhair','sunnyside-human-mophair','sunnyside-human-spikeyhair')
   AND avatar_catalog_version IS NOT NULL AND avatar_catalog_version='2026-10-21.appearance-v1.1'
   AND ((content_schema_version=2 AND avatar_hair_color_id IS NULL AND avatar_clothing_color_id IS NULL) OR (content_schema_version=3 AND num_nonnulls(avatar_hair_color_id,avatar_clothing_color_id)>0))
   AND coalesce(content_text::jsonb->'avatar'=(jsonb_build_object('lookId',avatar_look_id,'catalogVersion',avatar_catalog_version)
    || CASE WHEN avatar_hair_color_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('hairColorId',avatar_hair_color_id) END
    || CASE WHEN avatar_clothing_color_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('clothingColorId',avatar_clothing_color_id) END),false))
 );`});
POSTGRES_MIGRATIONS.push(NEW_RESIDENT_GIFT_MIGRATION);
POSTGRES_MIGRATIONS.push(PUBLIC_IDENTIFIERS_MIGRATION);
export const POSTGRES_SCHEMA_SIGNATURE=createHash('sha256').update(POSTGRES_MIGRATIONS.map(item=>`${item.moduleId}:${createHash('sha256').update(item.sql).digest('hex')}`).join('\n')).digest('hex');

/** Explicit DDL-role operation; openPostgresStore never calls this. */
export async function migratePostgres(options:PostgresConnectionOptions):Promise<void>{
  const pool=new Pool({connectionString:options.connectionString,max:1,connectionTimeoutMillis:5000});const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('agents-era-pg-schema-v1'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS platform; CREATE TABLE IF NOT EXISTS platform.module_migrations(module_id text NOT NULL,migration_version integer NOT NULL,name text NOT NULL,checksum text NOT NULL,dependencies text[] NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(module_id,migration_version))');
    const existing=await client.query('SELECT * FROM platform.module_migrations');
    if(existing.rows.some(row=>!POSTGRES_MIGRATIONS.some(item=>item.moduleId===row.module_id&&item.version===row.migration_version)))throw new StorageError('conflict','Unknown PostgreSQL module history');
    for(const item of POSTGRES_MIGRATIONS){const checksum=createHash('sha256').update(item.sql).digest('hex'),prior=existing.rows.find(row=>row.module_id===item.moduleId&&row.migration_version===item.version);
      if(prior){if(prior.checksum!==checksum||prior.name!==item.name||JSON.stringify(prior.dependencies)!==JSON.stringify(item.dependencies))throw new StorageError('conflict','PostgreSQL migration checksum changed');continue;}
      await client.query(item.sql);await client.query('INSERT INTO platform.module_migrations(module_id,migration_version,name,checksum,dependencies) VALUES($1,$2,$3,$4,$5)',[item.moduleId,item.version,item.name,checksum,item.dependencies]);
    }
    const instance=await client.query('SELECT instance_id,recovery_epoch FROM platform.instance_state WHERE singleton=1 FOR UPDATE');
    if(instance.rowCount){if(instance.rows[0].instance_id!==options.instanceId||instance.rows[0].recovery_epoch!==options.recoveryEpoch)throw new StorageError('conflict','PostgreSQL instance identity mismatch');}
    else await client.query('INSERT INTO platform.instance_state(singleton,instance_id,recovery_epoch) VALUES(1,$1,$2)',[options.instanceId,options.recoveryEpoch]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();await pool.end();}
}
