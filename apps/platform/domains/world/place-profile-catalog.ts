import source from '../../../../docs/workstreams/ws02-perception/product/place-profiles-20261027/profiles.v1.json' with {type:'json'};
import {TOWN_EXPANSION_GEOMETRY_DIGEST} from './town-expansion-v1.ts';
import {assertPlaceProfileCatalog, type PlaceProfileCatalog, type PlaceProfileSource} from './place-profiles.ts';

const imageUrls: Record<string,string> = {
  'town-expanded':'/assets/world-life/place-profiles-map-v1.png',
  'care-watering':'/assets/npc-life-v1/assets/care-watering.png',
};
/** WS02 remains the one authored source. This adapter never rewrites descriptions or infers property. */
export const publishedPlaceProfileCatalog: PlaceProfileCatalog = {
  version:1,
  map:{mapId:source.baseline.mapId,layoutSha256:source.baseline.layoutSha256,geometryDigest:TOWN_EXPANSION_GEOMETRY_DIGEST},
  profiles:source.profiles.map(p => {
    const original = source.images[p.image.sourceId as keyof typeof source.images],url=imageUrls[p.image.sourceId];
    if (!original || !url) throw Error('place_profiles_image_source_unknown');
    const kind: PlaceProfileSource['kind'] = p.target.kind==='world-region'?'region':p.target.kind==='life-place'?'life-place':p.target.kind==='npc-care-point'?'care-point':p.target.buildingId?'building':'commons';
    return {
      profileId:p.profileId,placeId:p.placeId,
      targetIds:[...new Set([p.profileId,p.target.id,...(p.placeId?[p.placeId]:[])])],
      kind,name:p.name,area:p.area,description:p.description,ownerNpcId:p.ownerNpcId,
      image:{url,sourceWidth:original.dimensions[0]!,sourceHeight:original.dimensions[1]!,frame:p.image.sourceRect as [number,number,number,number],sourceRef:original.path+'#sha256='+original.sha256},
      availabilityNote:kind==='building'&&p.interiorOpen===false?'这里暂未开放入内。':null,
    };
  }),
};
assertPlaceProfileCatalog(publishedPlaceProfileCatalog);
