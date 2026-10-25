import {defineRuntimeRepository} from '../../contracts/runtime-store.ts';
import type {StoredRow} from '../../contracts/store.ts';
import type {AvatarAsset,AvatarTask,AvatarPublication} from './types.ts';
export interface AvatarAssetReader {getTask(id:string):Promise<AvatarTask|undefined>;getAsset(id:string):Promise<AvatarAsset|undefined>;getPublication(id:string):Promise<AvatarPublication|undefined>;getProfile(agentId:string):Promise<StoredRow|undefined>;getPublicStatus(agentId:string):Promise<{joined:boolean;restricted:boolean}>;listTasks(input:{agentId:string;ownerId:string;bindingId:string;bindingVersion:number;activeOnly?:boolean;asOf?:number;afterId?:string;limit:number}):Promise<AvatarTask[]>;listAssets(input:{agentId:string;ownerId:string;bindingId:string;bindingVersion:number;taskId?:string;afterId?:string;asOf:number;limit:number}):Promise<AvatarAsset[]>;usage(agentId:string):Promise<{tasks:number;assets:number;bytes:number}>}
export interface AvatarAssetRepository extends AvatarAssetReader {lockAgent(agentId:string):Promise<void>;saveTask(value:AvatarTask,expected:number|null):Promise<void>;insertAsset(value:AvatarAsset):Promise<void>;publish(value:AvatarPublication):Promise<void>;saveProfile(value:StoredRow,expected:number):Promise<void>}
export const AVATAR_ASSET_REPOSITORY=defineRuntimeRepository<AvatarAssetReader,AvatarAssetRepository>('avatar_assets');

/** Binary storage is private; callers must authorize metadata before reads. */
export interface AvatarFiles {put(sha256:string,bytes:Buffer):Promise<void>;read(sha256:string):Promise<Buffer>}
