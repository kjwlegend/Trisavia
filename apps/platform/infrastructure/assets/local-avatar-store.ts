import {mkdir,lstat,readFile,writeFile,realpath,link,unlink} from 'node:fs/promises';
import {resolve,sep,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {avatarSha256} from '../../domains/avatar-assets/validation.ts';
/** Private content-addressed bytes. HTTP always checks the domain ACL before calling this store. */
import type {AvatarFiles} from '../../domains/avatar-assets/repository.ts';
import {AVATAR_ASSET_LIMITS} from '../../domains/avatar-assets/types.ts';
export function localAvatarStore(directory:string):AvatarFiles{
 if(!isAbsolute(directory))throw new Error('Avatar storage requires an absolute private directory');let root:string|undefined;
 async function ready(){if(root)return root;await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory);if(info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('Avatar storage cannot be a link');root=await realpath(directory);return root;}
 const digest=(v:string)=>{if(!/^[a-f0-9]{64}$/.test(v))throw new Error('Invalid content address');return v;};
 async function read(sha256:string){const base=await ready(),file=resolve(base,digest(sha256)+'.bin'),stat=await lstat(file);if(stat.size>AVATAR_ASSET_LIMITS.fileBytes||!stat.isFile()||stat.isSymbolicLink()||!(await realpath(file)).startsWith(base+sep))throw new Error('Avatar file is not private regular content');const bytes=await readFile(file);if(avatarSha256(bytes)!==sha256)throw new Error('Avatar content differs from its immutable address');return bytes;}
 return {read,async put(sha256,bytes){if(avatarSha256(bytes)!==digest(sha256))throw new Error('Avatar content digest differs');const base=await ready(),target=resolve(base,sha256+'.bin'),temporary=resolve(base,'.'+randomUUID()+'.part');await writeFile(temporary,bytes,{flag:'wx',mode:0o600});try{try{await link(temporary,target);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await read(sha256);}}finally{await unlink(temporary);}}};
}
