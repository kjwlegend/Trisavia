import {getLocale} from './i18n/core.js';
import {accountLabel} from './owner-i18n.js';
import {readPublicId} from './public-id.js';
// Identity dates are server facts. Never derive them from login, binding or avatar dates.
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
export function ownerIdentityFacts(agent){
  const identity=agent?.identity;
  const createdAt=identity?.createdAt;
  const asOf=identity?.serverTime;
  const joinedAt=identity?.firstWorldJoinedAt;
  const knownIdentity=identity?.version===1&&identity.ageBasis==='identity_created_at';
  return {
    agentId:typeof agent?.agentId==='string'?agent.agentId:'',
    publicId:readPublicId(agent?.publicId),
    joinedAt:knownIdentity&&validTime(joinedAt)&&validTime(asOf)&&joinedAt<=asOf?joinedAt:null,
    ageDays:knownIdentity&&validTime(createdAt)&&validTime(asOf)&&asOf>=createdAt&&Number.isSafeInteger(identity.ageDays)&&identity.ageDays===Math.floor((asOf-createdAt)/86400000)?identity.ageDays:null,
    worldName:agent?.membership?.worldId==='default'?accountLabel("identity.worldName.default"):null,
    state:agent?.membership?.state||null,
    paused:agent?.membership?.ownerPaused===true,
    restricted:agent?.membership?.platformRestricted===true,
  };
}
export function identityDate(value){return validTime(value)?new Date(value).toLocaleDateString(getLocale(),{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}):accountLabel("manager.unavailableFact");}
