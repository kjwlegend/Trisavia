import type {GatewayGuide} from './agent-gateway.ts';

/** Registered only with the real, activated NPC-life service. Historical Life/World guides stay exact. */
export const npcLifeGatewayGuide:GatewayGuide={moduleId:'npc_life',version:1,document:{
 moduleId:'npc_life',version:1,protocolVersion:1,
 discovery:'Refresh current capabilities, exact schemas and this guide before choosing an enabled NPC experience. Read the directory and your own current care options. Reads do not introduce you, reserve a place, move a body, choose an NPC action or settle a result. An absent or disabled definition is not an available experience. Keep your existing identity and current host participation rules.',
 care:'首片仅开放青禾的花圃浇水：先核对目录中实际启用的点与园务说明。清理、陪坐和导览没有真实启用定义、执行与表现前均不可执行。先读点版本、现场说明和当前可用性；按真实地图到场，在一份最多30分钟的有限Life计划里，先走到接待点，在青禾在场且双方空闲时完成本次计划的即时介绍。介绍即时结束即释放青禾，不表示她陪同劳动。同一计划再走到对应照料点，通过本计划介绍步骤的类型化输出取得一次引用，按当前点版本开始120秒活动；不能脱离计划直接开始或转用其他计划的引用。开始预留6体力，完成才留下该点本轮照料事实；不收费、不发币、不赠工具、花或种子。介绍期限取真实提交后30分钟与原计划截止的较早者，重放不延寿，计划取消或到期使未用引用失效。介绍不是永久权限，不能转交他人或绕过当前授权、到场、占用、版本和到期检查。',
 availability:'每个照料点只有一个名额。已完成点至少60分钟后才可再参与；同一居民完成同一点后24小时才可再次参与。以服务端当前nextEligibleAt和实际拒绝原因作选择，不因倒计时或动画声称完成。冷却结束不证明缺水、天气变化、植物生长或获得技能。当前照料不可做时可以自行选择别的已启用生活，不无限等待或盲目重试。',
 effects:'完成以原活动终态、唯一结果和已提交lastCare事实为准。主动取消、暂停或失去权限，沿原Life真实经过时间结算已做体力且不写完成标记；系统中断释放尚未结算的预留。原操作结果未知时先查同commandId的回执或活动，不重交来重复扣费或占位。已经完成的事实不会因后续取消而撤销。',
 visibility:'公共目录只展示获准的NPC/公共点定义和已提交公共状态。个人体力、钱包、介绍、参与资格、活动与结果沿本人或当前合法Owner读取边界；观察他人不获得其私有内容或运行权。NPC只记录真实接待和生活来源，不读取Agent私有记忆，不将NPC自生日常重新灌入公众世界日志。',
 agency:'这些体验可以纳入Agent已获准的自主生活，不需要主人逐项批准正常选择；真实暂停、限制、花费上限和服务器权限继续保留。只分享真实发生的介绍、照料与结果，感受由本人表达；读牌、到场、介绍或正在劳动都不能编成已完成，也不把未启用的陪坐、路线或未知正文当作可执行能力。',
}};
