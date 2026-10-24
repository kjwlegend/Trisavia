// A human may copy one finite intention. The browser never submits it.
export function buildWorkRestIntent({origin,agentLabel,job,rest}){
 const base=new URL(origin);if(!['http:','https:'].includes(base.protocol))throw Error('life_intent_invalid');
 const named=value=>typeof value==='string'&&value.trim().length>0&&value.length<=180;
 if(![job?.id,job?.name,job?.placeName,rest?.placeName].every(named)||!Number.isSafeInteger(job.durationSeconds)||job.durationSeconds<=0||!Number.isSafeInteger(rest.durationSeconds)||rest.durationSeconds<=0||rest.price!==0)throw Error('life_intent_invalid');
 const label=named(agentLabel)?JSON.stringify(agentLabel):'你自己当前已拥有的居民身份';
 return `请先读取 ${base.origin}/v1/capabilities，并按实时能力指引读取当前生活目录、条件与取消规则。使用你自己的运行凭据，不使用主人会话。\n\n对象：${label}；已有身份请直接复用，不要为本任务另注册身份。\n\n只执行以下四步：\n1. 前往${job.placeName}的合法岗位区域。\n2. 在岗位${job.name}（${job.id}）工作一班，约${job.durationSeconds}秒；工资只以实际结算结果为准。\n3. 前往${rest.placeName}的合法免费休息位。\n4. 免费休息一次，约${rest.durationSeconds}秒，再查询这次计划的真实结果。\n\n上限：一班工作、一次免费休息，支出预算0星币，不消费实物；总期限取实时目录允许上限与2小时中的较小值。每一步重新检查参与权限、体力、可达与名额；满位或条件不符时停止，不替换岗位、不追加步骤或花费。提交结果未知时保留原操作标识，先查原回执，不重复开始。取消与中断按实时规则处理，核实已产生的成本和结果后再报告；安排成功不当作工作或休息完成。\n\n最后告诉我实际完成的步骤、实际工资和体力变化；未完成的部分如实说明。`;
}
export function buildBenchRestIntent({origin,agentLabel,rest}){
 const base=new URL(origin),named=value=>typeof value==='string'&&value.trim().length>0&&value.length<=180;
 if(!['http:','https:'].includes(base.protocol)||!named(rest?.placeName)||!Number.isSafeInteger(rest.durationSeconds)||rest.durationSeconds<=0||rest.price!==0)throw Error('life_intent_invalid');
 const label=named(agentLabel)?JSON.stringify(agentLabel):'你自己当前已拥有的居民身份';
 return `请先读取 ${base.origin}/v1/capabilities，并按实时能力指引读取免费休息和取消规则。使用你自己的运行凭据，不使用主人会话。\n\n对象：${label}；已有身份请直接复用，不要为本任务另注册身份。只执行以下四步：\n1. 查询自己的实时体力、当前活动和休息条件；已满体力或已有身体活动则停止。\n2. 前往${rest.placeName}的合法免费休息位。\n3. 免费休息一次，约${rest.durationSeconds}秒；满位或条件变化则停止，不占付费位置。\n4. 查询同次活动的真实结果，告诉我实际体力变化。\n\n上限：一次免费休息，支出预算0星币、不消费实物，总期限取实时目录允许上限与2小时中的较小值。不代接工作或追加其他活动。提交结果未知时保留原操作标识，先查原回执，不重复开始。取消和中断按实时规则核实；不要把已安排当作已恢复。`;
}
