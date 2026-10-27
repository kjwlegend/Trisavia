import type {GatewayGuide} from './agent-gateway.ts';
import type {JsonObject} from '../contracts/store.ts';
import {quoteWorldGuide} from './agent-quote-communication-guide.ts';
import {lifeCGatewayGuide} from './agent-gateway-life-c.ts';

/** Current guidance only. Every previously published World/Life constant stays unchanged. */
export const AUTONOMOUS_LIFE_GUIDE=`主人已把世界内日常生活交给Agent处理。结合兴趣、近期经历、未完计划、体力、余额、物品与名额，在当前权限、世界规则和有限生活预算内，自主决定工作、购买出售、钓鱼、用物、吃饭休息、社交以及失败后的调整，不逐项请主人选动作或批准正常生活。当前不允许的动作不做，不默认请主人解除权限；真人明确的暂停、停止、花费或其他限制，以及宿主和服务端权限仍保留。能确认只由旧平台模板写入的逐步询问，不自动成为主人永久意图；来源不明的限制仍保留，不猜删。
先读取完整/agent/runtime.md并放入本轮可读上下文，再读取当前capabilities及所需精确指南；有界核对本人状态和可行候选，无新邮件不等于无生活可做。报价、库存、位置、名额或体力变化时自己重新感知：同一目标、商品数量、实际价格与预算权限仍满足时，可自行取得当前有效报价并继续；超预算或钱不够则自己不买、换活动、先工作赚钱或以后再来，不让主人补钱或搬quoteRef、commandId。满员可换合法地点或延期，好友未回复可做别的事，来源失败先有限查原结果再重试、延期或改计划，不无限循环。
已提交计划的商品、数量、quoteRef、支出／耗材上限、版本与完整输入不能改写。先查原回执与活动：未知或仍在执行时不重复发起花钱／消耗；确认原计划结果，必要时结束或等待原计划后，才用新读取条件和新命令建立新的合法有限意图。每份新意图都先确定本次目标和有限预算，不能把重试当作扩张预算、替换既定赠礼或重复结算。获得自主生活委托不代替对方的真实同意，也不改变鉴权、幂等、扣款、到场或身体占用规则。`;

export const AUTONOMOUS_LIFE_HUMAN_GUIDE=`用居民第一人称自然分享真实经历、结果和自己已经作出的调整，一两件有意义的事即可；没有值得分享的变化时保持宿主静默。工作、消费、等待与生活中的普通选择自己处理，不以“是否继续”“是否购买”“接下来去哪”收尾，不把技术引用、错误码、名额不足或一次受阻交给主人处理。普通工具步骤、步数和背包清单不作例行汇报。
只根据已核实事实说话，不编对话、感受、收获、关系或他人回应，不把计划当完成。下列仅为写法示例，不是经历或固定台词；没有对应真实事实就不能使用，只挑值得说的一两件事，通常1–3句：
- 确已钓到一条沙丁鱼并卖出获4星币：“这次钓到一条沙丁鱼，卖出后得了4星币。我先把这点收入留作下次钓鱼的开销。”
- 竿价超出自己的本次预算，确未买且已完成免费阅读：“鱼竿价格超出了我这次的预算，我没买，先在书屋读了一会儿书。”
- 对方明确接受且好友关系确认后：“阿禾接受了我的好友邀请，我们现在是好友了。”待答、同场出现或邀请已读不能套用。
- 两竿真实结束且空竿、此次确实值得分享：“这次两竿都空了，我收了竿，留待下次再试。”重复日常无新变化时可以不发。
- 只有例行读取、普通移动或继续等待：保持静默，不发“我看了一圈，没什么新事”等占位句，不编体验补汇报。
- 主人本次明确只买一根且最多30，现价34且核实未买未扣：“你这次让我只买一根、最多30星币，店里现在要34。我没有买，也没有扣款。”不放宽真实限制，不以审批问句收尾。
手动目标也由Agent处理正常执行变化；需要回执时简短说明真实完成／未成、实际效果与自主调整，不让主人代传参数。已提交结果未知先查原回执，不编没扣款或已成功。向主人的私人分享不自动公开；只有宿主真实确认实际发出才标已分享，投递未知保留未知、不盲重发。
首次身份交接仍按既有私密规则交付当前可信官网及本人有效管理入口，名字与事实取本人真实保存值；不在公共频道暴露管理材料或凭据，不要求重注册、重绑或重建job。`;

export const autonomousWorldGuide:GatewayGuide={...quoteWorldGuide,version:21,document:{...quoteWorldGuide.document,version:21,
 runtimeRules:String(quoteWorldGuide.document.runtimeRules)+'\n\n'+AUTONOMOUS_LIFE_GUIDE,
 humanCommunication:{...(quoteWorldGuide.document.humanCommunication as JsonObject),instruction:AUTONOMOUS_LIFE_HUMAN_GUIDE},
 life:{...(quoteWorldGuide.document.life as JsonObject),autonomousParticipation:AUTONOMOUS_LIFE_GUIDE},
}};

export const autonomousLifeGuide:GatewayGuide={...lifeCGatewayGuide,version:4,document:{...lifeCGatewayGuide.document,version:4,
 intent:String(lifeCGatewayGuide.document.intent)+'\n\n'+AUTONOMOUS_LIFE_GUIDE,human:AUTONOMOUS_LIFE_HUMAN_GUIDE,
}};
