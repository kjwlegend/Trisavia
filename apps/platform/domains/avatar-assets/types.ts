import type {JsonObject} from '../../contracts/store.ts';
export const AVATAR_ASSET_ACTIONS=['avatar_assets.tasks.create','avatar_assets.tasks.revoke','avatar_assets.drafts.create','avatar_assets.apply','avatar_assets.restore_builtin'] as const;
export const AVATAR_ASSET_QUERIES=['avatar_assets.spec','avatar_assets.tasks','avatar_assets.task','avatar_assets.drafts','avatar_assets.draft'] as const;
export type AvatarAssetAction=typeof AVATAR_ASSET_ACTIONS[number];
export interface AvatarClip {file:string;frames:number;frameMs:number}
export interface AvatarManifest {version:1;type:'trisavia-avatar-strips';frame:{width:96;height:64;foot:{x:48;y:39}};facing:{default:'right';left:'mirror-about-foot';vertical:'keep-last-horizontal'};clips:{idle:AvatarClip;walk:AvatarClip;work?:AvatarClip;rest?:AvatarClip};fallback:{work:'idle';rest:'idle'}}
export interface AvatarFile {name:string;contentType:'image/png'|'image/jpeg';sha256:string;bytes:number;width:number;height:number}
export interface AvatarValidationError {code:string;path:string;message:string;fix:string}
export interface AvatarValidation {valid:boolean;errors:AvatarValidationError[]}
export interface AvatarTask {id:string;version:number;agentId:string;ownerId:string;bindingId:string;bindingVersion:number;origin:string;recoveryEpoch:string;state:'active'|'revoked';creatorKind:'agent'|'owner';creatorId:string;creationPolicyVersion:number;instruction:string;createdAt:number;expiresAt:number;revokedAt:number|null}
export interface AvatarAsset {id:string;version:1;taskId:string;agentId:string;creatorKind:'agent'|'owner';creatorId:string;kind:'reference'|'avatar';createdAt:number;manifest:AvatarManifest|null;files:AvatarFile[];validation:AvatarValidation;digest:string;publicDocument:JsonObject|null}
export interface AvatarPublication {assetId:string;agentId:string;publishedAt:number;ownerId:string;bindingId:string;bindingVersion:number}
export interface CustomAvatar extends JsonObject {kind:'custom';assetId:string;version:1;digest:string;manifestUrl:string}
export const AVATAR_ASSET_LIMITS=Object.freeze({fileBytes:2*1024*1024,totalBytes:8*1024*1024,bodyBytes:12*1024*1024,files:4,referenceWidth:2048,referenceHeight:2048,decodedPixels:4194304,optionalFrames:16,optionalFrameMsMin:100,optionalFrameMsMax:1000,assetsPerTask:16,assetsPerAgent:128,bytesPerAgent:64*1024*1024,tasksPerAgent:256,taskLifetimeMs:7*86400000});
export const publicAvatarFilePath=(id:string,digest:string,name:string)=>`/v1/avatar-assets/public/${id}/1/${digest}/${name}`;
