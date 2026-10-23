import type {JsonObject} from '../../contracts/store.ts';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const colorBytes=readFileSync(new URL('../../../web/public/world-pixel/appearance-colors-v1.json',import.meta.url));
export const APPEARANCE_COLORS=JSON.parse(colorBytes.toString('utf8')) as {version:number;hairColors:{id:string;displayName:string;swatch:string}[];clothingColors:{id:string;displayName:string;swatch:string}[]};
export const APPEARANCE_COLORS_DIGEST=createHash('sha256').update(colorBytes).digest('hex');
export const APPEARANCE_COLORS_URL='/assets/world-pixel/appearance-colors-v1.json';
export const HAIR_COLOR_IDS=APPEARANCE_COLORS.hairColors.map(color=>color.id);
export const CLOTHING_COLOR_IDS=APPEARANCE_COLORS.clothingColors.map(color=>color.id);

export const APPEARANCE_CATALOG_VERSION='2026-10-21.appearance-v1.1';
export const APPEARANCE_ASSET_VERSION='2026-10-21.r3';
export const APPEARANCE_CATALOG_DIGEST='30c00558d539a194e6936b24e0179a2558cad4b047251265231388e9c63c2b82';
export const DEFAULT_LOOK_ID='sunnyside-human-shorthair';
/** Fixed historical renderer order, independent of catalogue display order. */
export const LEGACY_HAIR_ORDER=['shorthair','longhair','curlyhair','bowlhair','mophair','spikeyhair'] as const;
const names=['短发','长发','卷发','齐刘海','蓬松发','尖发'] as const;
export const APPEARANCE_LOOKS=LEGACY_HAIR_ORDER.map((hair,index)=>({
 lookId:`sunnyside-human-${hair}`,displayName:names[index]!,selectable:true,
 preview:{kind:'layered-sprite',layers:['/assets/world-pixel/assets/human-base-idle.png',`/assets/world-pixel/assets/human-${hair}-idle.png`],frame:{x:0,y:0,width:96,height:64},anchor:{x:48,y:39}},
}));
/** The published catalogue carries visual resources; a profile stores only the stable selection. */
export function avatarCatalog():JsonObject{return JSON.parse(JSON.stringify({version:3,catalogVersion:APPEARANCE_CATALOG_VERSION,assetVersion:APPEARANCE_ASSET_VERSION,catalogDigest:APPEARANCE_CATALOG_DIGEST,defaultLookId:DEFAULT_LOOK_ID,looks:APPEARANCE_LOOKS,base:{id:'sunnyside-human',mutable:false},colorCustomization:{...APPEARANCE_COLORS,defaults:{hairColorId:'original',clothingColorId:'original'},url:APPEARANCE_COLORS_URL,digest:APPEARANCE_COLORS_DIGEST,digestAlgorithm:'sha256-file-bytes'},supportedAttributes:['lookId','hairColorId','clothingColorId'],requiredFields:['displayName','avatar']})) as JsonObject;}
