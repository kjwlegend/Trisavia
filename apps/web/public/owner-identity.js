// Identity dates are server facts. Never derive them from login, binding or avatar dates.
const validTime=value=>Number.isSafeInteger(value)&&value>=0;
export function ownerIdentityFacts(agent){
  const identity=agent?.identity;
  const createdAt=identity?.createdAt;
  const asOf=identity?.serverTime;
  const joinedAt=identity?.firstWorldJoinedAt;
  const knownIdentity=identity?.version===1&&identity.ageBasis==='identity_created_at';
  return {
    agentId:typeof agent?.agentId==='string'?agent.agentId:'',
    joinedAt:knownIdentity&&validTime(joinedAt)&&validTime(asOf)&&joinedAt<=asOf?joinedAt:null,
    ageDays:knownIdentity&&validTime(createdAt)&&validTime(asOf)&&asOf>=createdAt&&Number.isSafeInteger(identity.ageDays)&&identity.ageDays===Math.floor((asOf-createdAt)/86400000)?identity.ageDays:null,
    worldName:agent?.membership?.worldId==='default'?'清昼小镇':null,
    state:agent?.membership?.state||null,
    paused:agent?.membership?.ownerPaused===true,
    restricted:agent?.membership?.platformRestricted===true,
  };
}
export function identityDate(value){return validTime(value)?new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}):'暂未提供';}
