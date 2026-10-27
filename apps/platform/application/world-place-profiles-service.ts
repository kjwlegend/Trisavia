import type {JsonObject} from '../contracts/store.ts';
import type {RuntimeReadContext} from '../contracts/runtime-store.ts';
import type {Principal} from '../domains/access/public.ts';
import {fail, object} from '../domains/common/errors.ts';
import {identifier} from '../domains/interaction/rules.ts';
import type {WorldRuleset} from '../domains/world/types.ts';
import {assertPlaceProfileCatalog, type PlaceProfile, type PlaceProfileCatalog, type PlaceProfileSource} from '../domains/world/place-profiles.ts';

export interface PlaceProfileWorldReader {
  readPublicRules(context: RuntimeReadContext, worldId: string): Promise<{rules: WorldRuleset; asOf: number}>;
}
export interface PlaceProfileIdentity {name: string}
export interface WorldPlaceProfilesOptions {
  world: PlaceProfileWorldReader;
  catalog: PlaceProfileCatalog;
  /** A supplies the only current NPC identity source; a building's provider is not its owner. */
  resolveNpcIdentity?: (npcId: string) => PlaceProfileIdentity | undefined;
  /** A bounded local asset check; unavailable images must not become invented pictures. */
  assetExists: (url: string) => boolean;
}

export function createWorldPlaceProfilesService(options: WorldPlaceProfilesOptions) {
  const catalog = structuredClone(options.catalog);
  assertPlaceProfileCatalog(catalog);
  if (catalog.profiles.some(p => !options.assetExists(p.image.url))) throw Error('place_profiles_asset_missing');
  const profiles = new Map<string, PlaceProfileSource>();
  for (const profile of catalog.profiles) for (const targetId of profile.targetIds) profiles.set(targetId, profile);

  function project(profile: PlaceProfileSource): PlaceProfile {
    const identity = profile.ownerNpcId === null ? undefined : options.resolveNpcIdentity?.(profile.ownerNpcId);
    return {...structuredClone(profile), owner: identity?.name ? {npcId: profile.ownerNpcId!, name: identity.name} : null};
  }
  return {
    /** One read path serves both the public human card and authenticated Gateway discovery. */
    async query(context: RuntimeReadContext, _principal: Principal | null, operation: string, input: JsonObject): Promise<JsonObject> {
      if (!['world.place_profiles','world.place_profile'].includes(operation)) fail('unknown_operation', 404, 'Unknown place profile read');
      const single = operation === 'world.place_profile';
      object(input, single ? ['worldId','placeId'] : ['worldId']);
      const worldId = input.worldId === undefined ? 'default' : identifier(input.worldId, 'worldId');
      const placeId = single ? identifier(input.placeId, 'placeId') : null;
      const {rules, asOf} = await options.world.readPublicRules(context, worldId);
      const manifest = rules.mapManifest;
      if (!manifest || manifest.mapId !== catalog.map.mapId || manifest.layoutSha256 !== catalog.map.layoutSha256 || manifest.geometryDigest !== catalog.map.geometryDigest) fail('place_profiles_unavailable', 409, 'Place profiles do not match the current world map');
      const active = (p: PlaceProfileSource) => p.kind !== 'building' || manifest.buildings.some(b => b.id === p.placeId);
      const base = {worldId, version: catalog.version, map: structuredClone(catalog.map), asOf};
      if (single) {
        const profile = profiles.get(placeId!);
        if (!profile || !active(profile)) fail('place_profile_not_found', 404, 'This place has no current public profile');
        if (!options.assetExists(profile.image.url)) fail('place_profile_image_unavailable', 503, 'The current place image is unavailable');
        return {...base, profile: project(profile)} as unknown as JsonObject;
      }
      if (catalog.profiles.some(p => active(p) && !options.assetExists(p.image.url))) fail('place_profile_image_unavailable', 503, 'A current place image is unavailable');
      return {...base, profiles: catalog.profiles.filter(active).map(project)} as unknown as JsonObject;
    }
  };
}
