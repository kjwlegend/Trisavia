import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {publishedPlaceProfileCatalog} from '../domains/world/place-profile-catalog.ts';
import {createWorldPlaceProfilesService, type PlaceProfileIdentity, type PlaceProfileWorldReader} from './world-place-profiles-service.ts';

/** Assembly helper for the existing World/Gateway owner; all image paths have been bounded by the catalog. */
export function createPublishedWorldPlaceProfilesService(world: PlaceProfileWorldReader, resolveNpcIdentity?: (npcId:string)=>PlaceProfileIdentity|undefined) {
  const root=new URL('../../web/public/',import.meta.url);
  return createWorldPlaceProfilesService({world,catalog:publishedPlaceProfileCatalog,...(resolveNpcIdentity?{resolveNpcIdentity}:{}),assetExists:url=>existsSync(fileURLToPath(new URL(url.slice('/assets/'.length),root)))});
}
