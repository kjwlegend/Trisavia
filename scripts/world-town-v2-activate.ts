import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {requirePrivateFile} from './postgresql/runtime.ts';
import {checkedWorldDatabase} from './world-core-database.ts';
import {townV2Rules} from '../apps/platform/domains/world/town-v2.ts';
import {createWorldRepository} from '../apps/platform/infrastructure/postgresql/world-repository.ts';
import {runtimeSql} from '../apps/platform/infrastructure/postgresql/runtime-sql.ts';
import {verifySchema,type PostgresScope} from '../apps/platform/infrastructure/postgresql/transaction-host.ts';
import {POSTGRES_SCHEMA_SIGNATURE} from '../apps/platform/infrastructure/postgresql/migrations.ts';
/** Paired maintenance only. The write gate must stay closed; no Agent/Avatar seed or business reset. */
export async function activateTownV2(connectionFile:string,identityFile:string,expectedDatabase:string){
 if(!isAbsolute(connectionFile)||!isAbsolute(identityFile))throw new Error('Absolute paired private files are required');checkedWorldDatabase(expectedDatabase);
 const connectionString=(await requirePrivateFile(connectionFile)).trim(),url=new URL(connectionString),identity=JSON.parse(await requirePrivateFile(identityFile)) as {version:number;instanceId:string;recoveryEpoch:string};
 if(url.hostname!=='127.0.0.1'||decodeURIComponent(url.pathname.slice(1))!==expectedDatabase||identity.version!==1||!identity.instanceId||!identity.recoveryEpoch)throw new Error('World database or identity pairing differs');
 const bytes=await readFile(new URL('../apps/web/public/world-map-v2.json',import.meta.url)),rules=townV2Rules(JSON.parse(bytes.toString()),createHash('sha256').update(bytes).digest('hex'));
 const options={connectionString,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch},pool=new Pool({connectionString,max:1}),client=await pool.connect();let alive=true;
 try{await client.query('BEGIN');await verifySchema(client,options);const guard=(await client.query('SELECT instance_id,recovery_epoch,writes_enabled FROM platform.instance_state WHERE singleton=1 FOR UPDATE')).rows[0];
  if(guard?.instance_id!==identity.instanceId||guard?.recovery_epoch!==identity.recoveryEpoch||guard?.writes_enabled!==false)throw new Error('Activation requires the same deployment with its write gate closed');
  const scope:PostgresScope={client,write:true,alive:()=>alive,beforeCommit(){throw new Error('Unexpected maintenance callback');},async attempt(work){return work();}};
  const repo=createWorldRepository(runtimeSql(scope,Date.now)).writer,world=await repo.lockWorld('default');if(!world?.active)throw new Error('Initialize the existing World before activating topology');
  const next=await repo.activateRuleset(rules,world.revision),changed=next.revision!==world.revision;if(changed)await client.query('UPDATE platform.instance_state SET write_generation=write_generation+1 WHERE singleton=1');
  await client.query('COMMIT');return {database:expectedDatabase,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch,changed,worldRevision:next.revision,rulesetVersion:next.rulesetVersion,topologyVersion:rules.topologyVersion,geometryDigest:rules.mapManifest!.geometryDigest,layoutSha256:rules.mapManifest!.layoutSha256,schemaSignature:POSTGRES_SCHEMA_SIGNATURE,writeGate:false,avatarPositionsChanged:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{alive=false;client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[connectionFile,identityFile,database,...extra]=process.argv.slice(2);(async()=>{if(!connectionFile||!identityFile||!database||extra.length)throw new Error('Usage: world-town-v2-activate.ts PRIVATE_MIGRATION_CONNECTION_FILE PAIRED_IDENTITY_FILE EXPECTED_WORLD_DATABASE');return activateTownV2(connectionFile,identityFile,database);})().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>{process.stderr.write('world_town_v2_activation_failed; paired target retained and write gate remains closed\n');process.exitCode=1;});}
