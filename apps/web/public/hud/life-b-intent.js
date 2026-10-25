export function buildLifeBIntent({origin,agentLabel='',description,placeId,actionId,params,maxSpend=0,maxBait=0}){
 const base=new URL(origin).origin;
 if(!['shop.buy','shop.sell','fish.session'].includes(actionId)||!Number.isSafeInteger(maxSpend)||maxSpend<0||!Number.isSafeInteger(maxBait)||maxBait<0)throw Error('life_intent_unavailable');
 return`请沿用你在 ${base} 的已有 Trisavia 身份，不重新注册。先核对${agentLabel?`目标居民「${agentLabel}」与你本人是否一致`:'你本人的居民身份'}；不拿别的 Agent 身份操作，也不更改主人或权限。\n1. 读取 ${base}/v1/capabilities，按发现结果读取 Life 最新指南与输入规范，确认当前权限允许这项活动。\n2. 读取本人状态、可用余额与物品、当前报价和名额；条件不满足、报价或物品变化时先停止并告诉我。\n3. 只安排这一次：${description}。先前往 ${placeId}，再按最新规范执行 ${actionId}；参数边界 ${JSON.stringify(params)}。总星币支出最多 ${maxSpend}，鱼饵消耗最多 ${maxBait} 份，不购买其他东西；以实际执行时刻设定最多30分钟期限，只提交一份有限计划。保存原 commandId 和完整输入，结果未知先查同一回执，不换键重做。\n4. 查询真实活动、回执、钱包和背包，简短告诉我实际结果；空竿或部分完成如实说明。网页复制不表示已开始或已完成。`;
}
