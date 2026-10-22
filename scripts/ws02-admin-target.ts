import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadBackendConfig } from '../apps/platform/configuration/backend-config.ts';
import { openPostgresStore } from '../apps/platform/infrastructure/postgresql/postgres-store.ts';
import { verifyApplicationReadiness } from '../apps/platform/application/bootstrap.ts';
import type {M1Store} from '../apps/platform/contracts/store.ts';
/** Shared explicit local PG preflight. Never migrates, seeds, regenerates identity or falls back to SQLite. */
export async function administrativeTarget(args:string[],extraFlags:readonly string[]=[],verifyTarget:(store:M1Store)=>Promise<void>=verifyApplicationReadiness) {
 const values:Record<string,string>={};for(let n=0;n<args.length;n+=2){const flag=args[n],value=args[n+1];if(!flag||!value||!['--connection','--identity','--operator','--manifest',...extraFlags].includes(flag)||values[flag])throw new Error('Explicit connection, identity, actor and new manifest are required');values[flag]=value;}
 if(!values['--operator']||!/^[A-Za-z0-9_.:@-]{1,100}$/.test(values['--operator']))throw new Error('Explicit administrative actor is required');
 for(const flag of ['--connection','--identity','--manifest'])if(!values[flag]||!isAbsolute(values[flag]!))throw new Error('Absolute private paths are required');
 const connectionPath=await realpath(values['--connection']!),identityPath=await realpath(values['--identity']!),manifestPath=resolve(values['--manifest']!);
 if(new Set([connectionPath,identityPath,manifestPath]).size!==3||await realpath(dirname(manifestPath))!==dirname(manifestPath))throw new Error('Unsafe manifest path');
 try{await lstat(manifestPath);throw new Error('Manifest must be a new file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const config=loadBackendConfig({M1_POSTGRES_CONNECTION_FILE:connectionPath,M1_IDENTITY_PATH:identityPath});
 const store=await openPostgresStore(config);try{await verifyTarget(store);}catch(error){await store.close();throw error;}
 return {values,manifestPath,store};
}
