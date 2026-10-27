/** Authored place descriptions are public read models, never ownership or service commands. */
export interface PlaceProfileImage {
  url: string;
  sourceWidth: number;
  sourceHeight: number;
  frame: [number, number, number, number];
  sourceRef: string;
}
export interface PlaceProfileSource {
  profileId: string;
  /** Existing business place reference; a building ID is never promoted to a Life place ID. */
  placeId: string | null;
  targetIds: string[];
  kind: 'building' | 'commons' | 'region' | 'life-place' | 'care-point' | 'notice';
  name: string;
  area: string;
  description: string;
  ownerNpcId: string | null;
  image: PlaceProfileImage;
  availabilityNote: string | null;
}
export interface PlaceProfileCatalog {
  version: 1;
  map: {mapId: string; layoutSha256: string; geometryDigest: string};
  profiles: PlaceProfileSource[];
}
export interface PlaceProfile extends PlaceProfileSource {
  owner: {npcId: string; name: string} | null;
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cc}]/u.test(value);
const id = (value: unknown): value is string => text(value, 100) && /^[A-Za-z0-9_.:-]+$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Fail during assembly if an authored record cannot identify one exact, bounded image frame. */
export function assertPlaceProfileCatalog(catalog: PlaceProfileCatalog): void {
  if (catalog.version !== 1 || !id(catalog.map?.mapId) || !hash(catalog.map.layoutSha256) || !hash(catalog.map.geometryDigest) || !Array.isArray(catalog.profiles) || !catalog.profiles.length || catalog.profiles.length > 100) throw Error('place_profiles_catalog_invalid');
  const targets = new Set<string>();
  for (const p of catalog.profiles) {
    const im = p.image, frame = im?.frame;
    if (!id(p.profileId) || p.placeId !== null && !id(p.placeId) || !['building','commons','region','life-place','care-point','notice'].includes(p.kind) || !text(p.name, 100) || !text(p.area, 100) || !text(p.description, 2000) || p.availabilityNote !== null && !text(p.availabilityNote, 500) || p.ownerNpcId !== null && !id(p.ownerNpcId) || !Array.isArray(p.targetIds) || !p.targetIds.includes(p.profileId) || p.targetIds.length > 10) throw Error('place_profiles_catalog_invalid');
    if (!im || !/^\/assets\/[A-Za-z0-9_./-]+\.(png|webp|svg)$/.test(im.url) || im.url.includes('..') || !text(im.sourceRef, 500) || !Number.isSafeInteger(im.sourceWidth) || !Number.isSafeInteger(im.sourceHeight) || im.sourceWidth < 1 || im.sourceHeight < 1 || !Array.isArray(frame) || frame.length !== 4 || frame.some(v => !Number.isSafeInteger(v) || v < 0) || frame[2] < 1 || frame[3] < 1 || frame[0] + frame[2] > im.sourceWidth || frame[1] + frame[3] > im.sourceHeight) throw Error('place_profiles_image_invalid');
    for (const target of p.targetIds) {
      if (!id(target) || targets.has(target)) throw Error('place_profiles_target_invalid');
      targets.add(target);
    }
  }
}
