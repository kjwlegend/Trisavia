import type {LifeCatalog} from './types.ts';
import type {WorldRuleset} from '../world/types.ts';
import {fail} from '../common/errors.ts';
import {TOWN_EXPANSION_GEOMETRY_DIGEST,TOWN_EXPANSION_LAYOUT_SHA256} from '../world/town-expansion-v1.ts';

const retainedCGeometry='982d6913dc42de5a3acf14d98d3fddc17887d6c7d96d5dfb599289ab69929c27';
/** Spatial-only forward extension. The immutable economic catalog, actor rules and stations stay C3.
 * Only the exact reviewed strict superset may replace the effective map reference. No write/seed occurs.
 */
export function effectiveLifeCatalogForWorld(c:LifeCatalog,rules:WorldRuleset):LifeCatalog {
 const m=rules.mapManifest;
 if(c.map.rulesetVersion===rules.version&&c.map.topologyVersion===rules.topologyVersion&&(!m||c.map.geometryDigest===m.geometryDigest))return c;
 if(c.revision===3&&c.ruleVersion===1&&c.map.mapId==='pixel-town-v2'&&c.map.rulesetVersion===5&&c.map.topologyVersion===5&&c.map.geometryDigest===retainedCGeometry&&rules.version===6&&rules.topologyVersion===6&&m?.mapId==='pixel-town-v2'&&m.version===6&&m.layoutSha256===TOWN_EXPANSION_LAYOUT_SHA256&&m.geometryDigest===TOWN_EXPANSION_GEOMETRY_DIGEST)
  return {...c,map:{...c.map,rulesetVersion:6,topologyVersion:6,geometryDigest:m.geometryDigest}};
 fail('life_rules_changed',409,'The current Life map is not a supported spatial extension');
}
