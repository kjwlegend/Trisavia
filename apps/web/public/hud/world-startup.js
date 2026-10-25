import {readWorldRules,readWorldPage} from './world-scene-projection.js';
const invalid=()=>Object.assign(Error('world_response_invalid'),{code:'world_response_invalid'});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const name=value=>typeof value==='string'&&value.length>0&&value.length<=200;
// This is one public world observation, never capabilities or account authority.
export function readWorldStartup(raw,worldId='default'){
 const d=raw?.data,keys=['startupVersion','publicOnly','instanceId','worldId','gatewayCatalogRevision','rulesetVersion','topologyVersion','worldRevision','asOf','rules','scene'];
 if(raw?.protocolVersion!==1||!name(raw.requestId)||!name(raw.instanceId)||!integer(raw.serverTime)||!d||Object.keys(d).some(key=>!keys.includes(key))||d.startupVersion!==1||d.publicOnly!==true||d.instanceId!==raw.instanceId||d.worldId!==worldId||typeof d.gatewayCatalogRevision!=='string'||!/^gateway-[a-f0-9]{24}$/.test(d.gatewayCatalogRevision)||!integer(d.asOf)||!integer(d.worldRevision)||d.worldRevision<1||!integer(d.rulesetVersion)||d.rulesetVersion<1||!integer(d.topologyVersion)||d.topologyVersion<1)throw invalid();
 const rules=readWorldRules(d.rules,worldId),scene=readWorldPage(d.scene,rules);
 if(rules.version!==d.rulesetVersion||rules.topologyVersion!==d.topologyVersion||d.rules.world.revision!==d.worldRevision||scene.worldRevision!==d.worldRevision)throw invalid();
 return{instanceId:raw.instanceId,rules,sceneEnvelope:{protocolVersion:1,instanceId:raw.instanceId,serverTime:raw.serverTime,data:d.scene}};
}
// Known older public contracts only. A denied target, body failure or inconsistent
// current observation must never be disguised as an unsupported endpoint.
export const startupUnsupported=error=>error?.status===404&&['not_found','capability_not_available'].includes(error.code)||error?.status===400&&error.code==='world_startup_version_required';
