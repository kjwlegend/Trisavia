// Presentation uses only the returned records; it never infers a day's totals.
export function logFact(item){
 return item.details?.summary||[...new Set([item.title,item.result].filter(Boolean))].join('，')||item.action;
}
// A statement stays distinct from authoritative results. Old entries are never
// rewritten in the Agent's voice, and public modes do not call this presenter.
export function ownerLogText(item){return item.authored?.kind==='agent_life_statement'?item.authored.text:item.source.node==='interaction.feedback.submitted'?'留下一条回复记录。':logFact(item);}
export function ownerLogTitle(item){return item.authored?.kind==='agent_life_statement'?item.authored.title||'生活记录':item.source.node==='interaction.feedback.submitted'?'回复记录':item.title;}
function repeatKey(item){
 const details=item.details,location=details?.location,life=details?.life;
 if(item.agent.actorKind!=='npc'||!item.agent.npcId||item.source.domain!=='life'||details?.completeness!=='recorded'||!life?.actionId||!location?.from||!location.to||location.via?.length)return null;
 const from=location.from,to=location.to;
 if(from.kind!==to.kind||from.name!==to.name)return null;
 return JSON.stringify([item.date,item.agent.npcId,item.source.node,details.phase,life.actionId,life.jobId??null,location.mapId??null,location.rulesetVersion??null,location.topologyVersion??null,to.kind,to.name]);
}
export function groupLogItems(items,{mode}={}){
 const groups=[];let previousKey=null;
 for(const item of items){const key=mode==='world'?repeatKey(item):null,previous=groups.at(-1);if(key&&key===previousKey)previous.items.push(item);else groups.push({id:item.id,items:[item]});previousKey=key;}
 return groups;
}
export function logOutcomes(item,{mode}={}){
 if(mode!=='owner')return[];
 if(item.details?.journal)return[]; // The source already supplies the specific summary.
 const life=item.details?.life;if(!life)return[];const facts=[];
 if(life.actionId==='work.shift'&&life.coinReward!==null)facts.push(`工资 ${life.coinReward} 星币`);
 if(life.energyRestored>0)facts.push(`体力恢复 ${life.energyRestored}`);
 if(life.energySpent>0)facts.push(`消耗体力 ${life.energySpent}`);
 if(life.trade)facts.push(`星币 ${life.trade.moneyDelta>0?'+':''}${life.trade.moneyDelta} · 物品 ${life.trade.quantity} 件`);
 if(life.fishing)facts.push(`完成 ${life.fishing.completedCasts} / ${life.fishing.requestedCasts} 竿 · 空竿 ${life.fishing.noCatchCount} · 鱼获 ${life.fishing.catches.length} 条`);
 if(life.c?.book)facts.push(life.c.book.title);
 return facts;
}
