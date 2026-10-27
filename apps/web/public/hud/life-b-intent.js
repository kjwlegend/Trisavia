import {buildLifeIntent} from './life-owner-input.js';
export function buildLifeBIntent({origin,agentLabel='',description,placeId,actionId,params,maxSpend=0,maxBait=0}){
 if(!['shop.buy','shop.sell','fish.session'].includes(actionId)||!Number.isSafeInteger(maxSpend)||maxSpend<0||!Number.isSafeInteger(maxBait)||maxBait<0)throw Error('life_intent_unavailable');
 return buildLifeIntent({origin,agentLabel,description,input:{actionId,placeId,params},maxSpend,consume:{bait:maxBait}});
}
