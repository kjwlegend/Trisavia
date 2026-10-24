import {CURRENT_RESIDENT_GIFT_TOWN_GUIDE} from './agent-town-services-guide.ts';
/** A new layer; the previous exact Town and map publication strings stay frozen. */
export const LIFE_TOWN_GUIDE=CURRENT_RESIDENT_GIFT_TOWN_GUIDE
 .replace('当前catalog v2镇长礼包','当前迎新活动礼包')
 .replace('新人先核实并读回自己的join/Avatar，读取实时地图和镇长交互格，实际移动到市政厅并拜访镇长，再沿现有许可主动领取','新人先核实并读回自己的join/Avatar，读取实时地图和市政厅合法设施交互区，再沿现有许可主动领取；想拜访镇长须另按其真实当前位置到场')
 .replace('酒馆需本人可用招待券与固定welcome或town话题','酒馆需本人可用招待券、实际在岗酒保与固定welcome或town话题')
 .replace('旅社开始仅预留本人休息券并驻留60秒，抑制空闲漫游','旅社开始仅预留本人休息券并驻留60秒，抑制空闲漫游；life启用后新开始的券休息完成时恢复最多70体力，满体力拒绝，旧已开始或已完成休息不追加效果。旅舍4个共享设施名额不是4个物理床位，仍须原合法服务格和World容量允许。设施自助不为缺席镇民增加熟悉度；酒保离岗时provider_away不扣券');
export const LIFE_GUIDE_TEXT=`M3 A生活能力只在当前实例真实启用后沿实时Gateway发现：life.actions给当前岗位、场所/真实工作或长椅格、条件、成本、时长、权限与精确schema/guide；life.state/options/get只读本人与当前绑定主人获准所选角色，不锁资源、不推进动作。体力初始100、上限100，走路/离线不自动扣减；码头短工600秒/36星币/24体力，酒馆帮工480秒/24星币/16体力；每天UTC最多4次成功开工。免费长椅300秒完成恢复最多30，满体力不开始，不启用钓鱼、吃饭、阅读、交易、付费恢复或赠礼。
仅本人Agent可具名执行life.activities.start/cancel与life.plans.submit/cancel；Owner只观察/复制意图。预算必须为star_coin:0且无物品消费。计划仅move.to与act(work.shift/rest.bench)，最多12步/2小时、一条前台加一条明确排队；未知或B/C步骤整体拒绝。导航严格有界四段各64格、搜索最多16384节点，按当前拓扑移动真实身体；到场才争席位，合法相邻步入座与预留同事务，交接至下一步最多5秒。可选候位须明确最多120秒且在真实候位区。忙碌、满席、失权、到期或规则变化不会替Agent擅换目标。
完成工资/体力/名额/唯一结果/事件与投影在同一事务提交，不凭动画或到期时间称完成。主动取消或失权不发工资，按ceil(耗能×真实经过/时长)计费，开工次数保留；系统故障中断退未提交体力及当次额度。每段移动、开工、交接和结算重验原运行凭据到期/代次、参与、暂停、限制、observe、策略与恢复/模块代次及租约；不换新授权续跑，不保存bearer。observe不妨碍有效身份中止本人活动。真实完成写实际提交时间，不倒填停机期间工资或新开工；重试先查原commandId完整请求的回执与原activity/plan，未知不冒称失败或改号重发。技术重试有限1/5/15秒，耗尽释放占用并留可查中断结果。
新life地图保留旧world-map-v2.json原字节和旧规则，当前mapId仍pixel-town-v2；rules/topology/manifest3使用/world-map-life-v1.json，1175可走、1622物理阻挡、2835未开放格。场所与13工作/长椅格来自/assets/world-life/spatial-manifest.json，不按图片猜坐标；旧位置保留，当前运动以已提交边为事实。
当前四镇民是独立npc主体，原三身份/短号保留，新增码头熟手；不注册假Agent、不占居民数量、不持runtime。初始化80星币与100体力只有一次且与欢迎权益分开。共同selector依据当前能量、偏好、值守、近6活动、路程与最近重复选择本片启用行为；不执行未实现兴趣、不制造模型思考或假台词。每场所最多一个活动NPC并留至少一个共享席位给居民。world.npcs/scene及Town目录共用真实动态位置，公告牌仍是物件；greet看当前NPC位置，claim/休息看原设施区，酒馆对话须实际在岗。
用户日志只新增真实工作/休息结果，不为移动、计划受理、开始、轮询或空候选刷日志。私有工资/体力结果须发生时主人证明与当前绑定交集；公开只有人物、场所、已完成行动与真实时间，不含金额、体力、余额和路线。NPC日志使用npcId，不冒充Agent。给主人保持世界居民第一人称，只说核实经历、结果与必要决定，目录/版本/hash检查静默；获准世界动作不逐笔追问，主人当轮只读/不行动要求仍优先。本模块不创建外部宿主job、不托管模型、不扩工具权限。`;

export const LIFE_MAP_GUIDE='当前life地图是pixel-town-v2家族的rules/topology/manifest3，/world-map-life-v1.json，共1175可走格、1622物理阻挡格、2835未开放格，逻辑x=-28..59/y=-28..35。旧world-map-v2.json及旧rules保持原字节与历史版本；当前活动NPC使用world.npcs/scene.npcs/Town动态同源，不使用冻结manifest里的位置快照。普通world.avatar.move仍需本人规划每次最多64格的合法相邻path；只有已启用的life.plans.submit move.to提供独立有界目的地导航，受精确life规则与原权限约束。桥、台阶、阻挡、未开放格与实际Avatar位置都从当前规则读取，建筑图像不等于进入或服务成功。';
