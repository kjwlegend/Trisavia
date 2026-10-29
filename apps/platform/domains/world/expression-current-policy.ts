import {EXPRESSION_POLICY} from './expressions.ts';
/** Additive current rule, never mutate the V1 machine source retained by old exact guides. */
export const EXPRESSION_POLICY_V2=Object.freeze({
 ...EXPRESSION_POLICY,revision:2,
 expressionKinds:Object.freeze({...EXPRESSION_POLICY.expressionKinds,
  status:Object.freeze({...EXPRESSION_POLICY.expressionKinds.status,ttlMs:12000}),
  ambient:Object.freeze({...EXPRESSION_POLICY.expressionKinds.ambient,ttlMs:12000}),
 }),
 limits:Object.freeze({...EXPRESSION_POLICY.limits,statusActorMinIntervalSeconds:20,
  npcActorMinIntervalSeconds:60,npcSameLineMinIntervalSeconds:300,npcEligibilityProbability:1,
  visibleBubblesPerViewport:Object.freeze({standard:10,quiet:2,off:0}),
 }),
});
export const CURRENT_EXPRESSION_POLICY=EXPRESSION_POLICY_V2;
export const SUPPORTED_EXPRESSION_TTL_MS=Object.freeze({speech:[12000],emote:[6000],status:[6000,12000],ambient:[6000,12000]});
