import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requirePrivateFile } from './postgresql/runtime.ts';
import { checkedWorldDatabase } from './world-core-database.ts';
import { setPostgresWriteGate } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
export async function setWorldWriteGate(privateConnections:string,enabled:boolean){
 const manifest=JSON.parse(await requirePrivateFile(join(privateConnections,'created-database.json'))) as {format:string;database:string};checkedWorldDatabase(manifest.database);
 if(manifest.format!=='world-core-isolated-pg-database-v1'||typeof enabled!=='boolean')throw new Error('Explicit World target required');
 const identity=JSON.parse(await requirePrivateFile(join(privateConnections,'identity.json'))) as {version:number;instanceId:string;recoveryEpoch:string};if(identity.version!==1)throw new Error('Invalid paired identity');
 const connectionString=(await requirePrivateFile(join(privateConnections,'migration-database-url'))).trim();if(new URL(connectionString).pathname.slice(1)!==manifest.database)throw new Error('World target mismatch');
 await setPostgresWriteGate({connectionString,instanceId:identity.instanceId,recoveryEpoch:identity.recoveryEpoch},{enabled});return {database:manifest.database,writesEnabled:enabled};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const[directory,state,...extra]=process.argv.slice(2);(async()=>{if(!directory||!['enable','disable'].includes(state??'')||extra.length)throw new Error('Usage: world-core-write-gate.ts PRIVATE_CONNECTIONS enable|disable');return setWorldWriteGate(directory,state==='enable');})().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('world_core_write_gate_failed\n');process.exitCode=1;});}
