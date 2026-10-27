import type {JsonObject} from '../contracts/store.ts';
import type {GatewayOperation, GatewayPublicRead} from './agent-gateway.ts';
import type {createWorldPlaceProfilesService} from './world-place-profiles-service.ts';
import {array, nullable, objectSchema as obj, positive, string, timestamp} from './agent-gateway-schema.ts';

const text: JsonObject = {type:'string', minLength:1, maxLength:2000};
const hash: JsonObject = {type:'string', pattern:'^[a-f0-9]{64}$'};
const frame: JsonObject = {type:'array', items:{type:'integer', minimum:0}, minItems:4, maxItems:4};
const image = obj({url:{type:'string', pattern:'^/assets/[A-Za-z0-9_./-]+\\.(png|webp|svg)$'}, sourceWidth:positive, sourceHeight:positive, frame, sourceRef:text});
const profile = obj({placeId:string, targetIds:array(string,10), kind:{enum:['building','commons','region','life-place','care-point','notice']}, name:string, area:string, description:text, ownerNpcId:nullable(string), owner:nullable(obj({npcId:string,name:string})), image, availabilityNote:nullable(text)});
const map = obj({mapId:string, layoutSha256:hash, geometryDigest:hash});
const common = {worldId:string, version:{const:1}, map, asOf:timestamp};
const listInput = obj({worldId:string}, []), detailInput = obj({worldId:string,placeId:string}, ['placeId']);
const listOutput = obj({...common, profiles:array(profile,100)}), detailOutput = obj({...common, profile});
type Service = ReturnType<typeof createWorldPlaceProfilesService>;

export const placeProfileSchemas = {profile, listInput, detailInput, listOutput, detailOutput};
export function placeProfileGatewayOperations(service: Service): GatewayOperation[] {
  return [
    {id:'world.place_profiles',moduleId:'world',schemaVersion:1,kind:'query',actors:['agent','owner'],description:'Read the current map-authored public place profiles; no movement, service or property change.',input:listInput,output:listOutput,query:(ctx,p,input)=>service.query(ctx,p,'world.place_profiles',input)},
    {id:'world.place_profile',moduleId:'world',schemaVersion:1,kind:'query',actors:['agent','owner'],description:'Read one existing map place by its canonical ID or existing click target ID.',input:detailInput,output:detailOutput,query:(ctx,p,input)=>service.query(ctx,p,'world.place_profile',input)},
  ];
}
export function placeProfilePublicReads(service: Service): GatewayPublicRead[] {
  return [
    {id:'world.public_place_profiles',moduleId:'world',schemaVersion:1,path:'/v1/world/place-profiles',description:'The same public authored places used by the human map.',input:listInput,output:listOutput,read:(ctx,input)=>service.query(ctx,null,'world.place_profiles',input)},
    {id:'world.public_place_profile',moduleId:'world',schemaVersion:1,path:'/v1/world/place-profile',description:'One exact public place; an unknown ID is not replaced by a nearby building.',input:detailInput,output:detailOutput,read:(ctx,input)=>service.query(ctx,null,'world.place_profile',input)},
  ];
}
/** Optional guide paragraph for the World guide owner; do not replace its existing movement rules. */
export const placeProfileGuideSection: JsonObject = {
  queries:['world.place_profiles','world.place_profile'],
  public:['GET /v1/world/place-profiles','GET /v1/world/place-profile?placeId=...'],
  meaning:'Place descriptions and exact source image frames are authored public context. Only an explicit ownerNpcId resolved by the current NPC identity source has an owner name. A nearby or service NPC is not proof of ownership. Profile reads never move an actor, reserve a service, grant access indoors or change ownership. Existing service actions and current eligibility remain authoritative in their original catalogs.'
};
