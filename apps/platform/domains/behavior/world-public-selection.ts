import type {BehaviorNode,BehaviorRecord} from './types.ts';

/** World-feed eligibility only; every candidate still needs its original source/current-public authorization.
 * Rules describe committed event subjects, not the initiator/executor: an Agent's real Town result can
 * involve an NPC. No current NPC-only node represents a public-world event; unknown nodes fail closed.
 * Add an explicitly approved source/node rule when such a real event source exists, never an NPC ban.
 */
interface WorldPublicRule {
 sourceDomain:BehaviorRecord['sourceDomain'];sourceType:BehaviorRecord['sourceRef']['type'];
 subject:'agent'|'npc';nodes:readonly BehaviorNode[];
}
export const WORLD_LOG_PUBLIC_RULES:readonly WorldPublicRule[]=Object.freeze(([
 {sourceDomain:'life',sourceType:'life_activity',subject:'agent',nodes:Object.freeze([
  'life.work.completed','life.rest.completed','life.fishing.finished',
  'life.meal.completed','life.reading.completed','life.visit.completed',
 ] satisfies BehaviorNode[])},
 {sourceDomain:'town_services',sourceType:'town_service',subject:'agent',nodes:Object.freeze(['town_services.service.completed'] satisfies BehaviorNode[])},
] satisfies WorldPublicRule[]).map(rule=>Object.freeze(rule)));

export function eligibleForPublicWorldLog(row:Pick<BehaviorRecord,'sourceDomain'|'sourceRef'|'node'|'agentId'|'npcId'|'publicProjection'>):boolean {
 return row.publicProjection!==null&&WORLD_LOG_PUBLIC_RULES.some(rule=>
  row.sourceDomain===rule.sourceDomain&&row.sourceRef.type===rule.sourceType&&rule.nodes.includes(row.node)&&
  (rule.subject==='agent'?row.agentId!==null&&row.npcId===undefined:row.agentId===null&&!!row.npcId));
}
