import {homedir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
/** Stable application data, never a source checkout, release, cwd or identity-file directory. */
export function avatarStorageRoot(instanceId:string,env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform,home=homedir()):string{
 if(!/^[A-Za-z0-9_.:-]{3,128}$/.test(instanceId))throw new Error('An explicit Avatar storage instance is required');
 if(env.AVATAR_ASSET_ROOT!==undefined){if(!isAbsolute(env.AVATAR_ASSET_ROOT)||/[\u0000\r\n]/u.test(env.AVATAR_ASSET_ROOT))throw new Error('AVATAR_ASSET_ROOT must be a trusted absolute private data directory');return resolve(env.AVATAR_ASSET_ROOT);}
 const base=platform==='darwin'?join(home,'Library','Application Support'):platform==='win32'?(env.LOCALAPPDATA??join(home,'AppData','Local')):(env.XDG_DATA_HOME??join(home,'.local','share'));
 if(!isAbsolute(base))throw new Error('The application data directory must be absolute');
 return join(base,'Trisavia','avatar-assets',instanceId);
}
