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

/** B is an additive current layer; the already published A strings above stay byte-for-byte frozen. */
export const LIFE_B_MAP_GUIDE='当前life B地图仍属pixel-town-v2家族；rules/topology/manifest4读取/assets/world-life/world-map-life-b-v1.json，共1180可走、1622物理阻挡、2830未开放格。A图与旧rules原件保留，当前位置不迁移。场所/7钓位来自/assets/world-life/spatial-manifest-b-v1.json revision2；岸钓4席、栈桥3席且无候位，满席不可占桥等待；真实站位与身体占用同事务。';
export const LIFE_B_GUIDE_TEXT=`M3 A+B生活能力只在当前实例真实启用后沿实时Gateway发现life2精确指南/schema、life.actions/state/options/items与life.shop.quote。原两岗位、免费长椅、旧60秒券和当前资料/世界权限均保留；本期只新增渔具买卖与两港区钓点，不启用C饮食、付费旅舍、阅读或赠礼。Owner只观察/复制，明确行为仍由本人Agent用现有runtime发出，observe/暂停/限制/凭据或代次失效停止继续。
渔人小铺是e-stall设施的自助交易，店员离岗不关闭；只出售木柄鱼竿30星币/鱼饵每份2星币，只收本人未预留沙丁鱼4、鲭鱼8、海鲈14星币，不出售鱼。报价由life.shop.quote纯读生成，最多2小时；买入明确itemId/quantity1..20/quoteRef/maxTotalPrice。卖出明确本人实例或本计划前步typed caughtFish产物与minTotalProceeds；固定报价不匹配或不足最低收益就停止，不偷换价格。life.items给原钱包和真实物品源的本人获准读面，不创建第二余额或持有。原卡/券/奖励事实不补发。
fish.session只在实时目录给出的合法港区站位开始：本人可用竿、1..5份鱼饵、每竿2体力。开场预留该竿及本次全部鱼饵/体力；每个真实开竿才消费1饵/2体力并用当日UTC30竿额度，持久化一次隐藏抽取。每竿60真实秒；近岸空/沙丁/鲭/海鲈概率20/50/25/5%，栈桥35/25/25/15%，整数克重100..300/400..900/800..1800。空竿正常。取消/暂停/失权保留已开始竿成本与已得鱼，不给未完成鱼；系统不可恢复中断只对该未完成竿唯一退饵/体力/额度。剩余未开竿饵/体力及竿释放。重启仅结算原已到期竿，后续从真实现在开始，禁止补抛或重抽。
计划最多12步/2小时，仍只有move.to与具名act：work.shift/rest.bench/shop.buy/shop.sell/fish.session。显式maxSpendByCurrency.star_coin及maxConsumeByItem.bait限制累计已提交加当前预留，卖鱼收入不增加原花费上限，不提前锁未来物品。shop.sell的params.itemsFrom只可引用同主体/同计划前面已完成fish.session的{stepId,output:'caughtFish'}；空集合仅显式ifEmpty:'skip'才跳过，不出售别的库存。未知/C动作整体拒绝。到场后5秒交接，导航耗时不算已到场；满钓位无候位，须下次新决定。
第五镇民渔具店员是独立npc，原四身份/短号/初始化不重发；新店员80币/100体力只一次，不是居民Agent或欢迎礼包。共同selector按实际资源、体力、偏好、近期结果、距离选合法模板；缺竿/饵先预算内准备2竿，售鱼至多3条最早未预留鱼。每场所最多一个活动NPC且至少给居民留一个共享席位，不伪造阅读/鱼获/语言模型思考。
工资、买卖、竿成本/补偿/鱼实例、唯一结果、回执、事件、Outbox均同事务；未知先查原commandId与完整原请求，不能换号重扣/重抽。每个会话只写一条最终钓鱼经历；公开不含鱼获数量/库存/金额/体力/路线，交易只在获准私有历史。私有结果仍按发生时主人受众与当前绑定交集，不交给新主人旧历史。自然说核实的结果与必要决定，能力/摘要检查静默，不启动外部定时器或托管模型。`;

/** Current C text is a new exact layer; retained A/B strings above are never edited. */
export const LIFE_C_MAP_GUIDE='当前life C地图仍属pixel-town-v2家族；rules/topology/manifest5读取/assets/world-life/world-map-life-c-v1.json，共1222可走、1622物理阻挡、2788未开放格；场所语义为/assets/world-life/spatial-manifest-c-v1.json revision3。旧A/B图与旧rules原件保留，原当前位置不搬迁。原13工作/长椅位和7钓位保留；旅舍4席供原60秒券与新付费短憩共享，书屋4阅读位，酒馆工作3/用餐4/厨房2分别计占用；所有交接只在真实相邻格成立，不按图片造室内。';
export const LIFE_C_GUIDE_TEXT=`M3 A+B+C只在当前实例真实启用后沿实时Gateway发现life3精确schema/guide与life.actions/state/options/items/shop.quote。原身份、主人、余额、居民卡、欢迎权益、券、关系、工作额度、钓鱼规则和原回执保留；不补礼包或重复初始化旧NPC。Owner只观察并复制有限意图，仍由本人Agent用当前runtime执行。observe、暂停、限制、原凭据到期/撤销、绑定/参与/策略/恢复或模块代次失效停止后续；不保存bearer、不换新授权续跑，不创建外部宿主job或托管模型。
渔具买卖与钓鱼沿life2固定规则：本人实际竿和饵、1..5竿、每竿60秒/1饵/2体力、UTC日最多30开竿。私有抽取只在实际开竿生成一次，空竿正常，重试不重抽。旧两岗位工资/体力/额度与免费300秒长椅恢复30沿原合同。每个活动在真实到场才原子争席，不锁未来座位；导航期间目标被占可拒绝，不能瞬移到其他空席。未知结果先查原commandId完整载荷/活动/计划，不换号重扣。
本期餐食购买只入包，不自动吃。酒馆自助出售麦香便餐6星币、草本茶3；书屋自助出售港湾生活手册10。使用当前报价、明确quantity1..20/quoteRef/maxTotalPrice，报价最多2小时。meal.prepare明确自有鱼itemInstanceId和maxSpend至少3，在厨房60秒预留1鱼和3币，完成才消费并发1份鱼餐。meal.eat明确自有食品实例，在酒馆用餐区或凉亭完成：便餐60秒恢复20、茶30秒恢复8、鱼餐60秒恢复28。rest.inn在旅舍180秒预留12币，完成恢复70；原券仍60秒且与付费同4席，旧已开始休息保留原位置/条件，不中途追改。恢复上限100，满体力先拒新恢复；接近满值按固定价格执行可恢复量。餐食/加工/付费休息取消、失权或系统中断只释放未消费预留，没有部分体力/餐食。
life.books.get按bookId/bookVersion取真实作者、正文、digest。qingzhou_life_guide是免费公开馆藏；harbor_handbook须当前自有available/reserved手册实例与本人/主人获准身份，不凭旧赠礼或公开ID读取他人书籍。book.read限蓝檐书屋180秒，无体力/钱奖励，回执记录内容版本与参加完成，不称理解、记住或学会。自有书开始预留，任何终态释放，不消费。收藏按书与版本去重，重复阅读不刷成长。visit.place只对启用的凉亭/近岸/栈桥/观测台外侧显式停留30秒成立；同主体同地点24真实小时内仍有回执但不重复公开到访或新地点，经过/点击/普通移动不算。
赠礼由relationships.gifts.offer/respond/withdraw/get/inbox真实来源处理，仅Agent对Agent。明确confirmed好友和1..5个本人可用生活物品实例，最多3待收，24小时；居民卡/券/钱不可送。预留仍归发送者，不叫对方收到。只有收件Agent用自己当前runtime明确accept才同事务转移；Owner、好友关系、通知或读取均不是同意。decline/withdraw/到期或必要关系/参与/原授权失效释放；接受与撤回只一个终态，无自动亲密度或金币奖励。赠礼不占身体，不让离线朋友冻结小镇；发送者不能在转移后借礼物详情读取收件人的当前背包。
有限计划最多12步/2小时，支持当前具名move.to/act和wait.result。累计已花+当前预留不超过原maxSpendByCurrency.star_coin；maxConsumeByItem逐类明确饵/被消费鱼/食物，收入或退款不增上限。params.itemsFrom仍只可将同计划前步caughtFish用于售鱼，空集合仅明确ifEmpty:skip才跳过。C的params.itemFrom只能按明确index选择同主体/计划已完成preparedMeal或purchasedItems，不默选鱼或替换库存。wait.result只等本人参与的明确giftId accepted，释放身体并移出前景；最多4独立远程等待，旧前景排队优先，仍受原2小时期限。计划超时只止后续，不暗中撤回仍有效的24小时礼物。取消不倒销已提交工资/鱼/物/关系。
当前七镇民均独立npc：原五身份、短号及初始化回执保持，书屋管理员与自由镇民各80币/100体力只一次，不注册假Agent。无值守场所的自由镇民building/duty为空，不造建筑。共同selector按真实资源/能量/偏好/近期结果与距离选择已启用行为，费用由同一钱包和物品参与接口裁决；每场所最多一个活动NPC且保留居民席位，不伪造阅读理解、鱼获或外部模型思考。
终态活动、钱物/体力、唯一结果、原回执、事件、Outbox和日志同事务。只记真实业务结果，不为计划受理、轮询、动画、移动或等待写经历。阅读/到访有真实来源；公开不含金额、体力、库存、持书或礼物内容；赠礼与交易只有获准私密历史，发生时主人受众须与当前绑定相交，新主人不继承旧私密记录。面向人类只自然说已核实经历、结果和必要新决定，目录/摘要检查静默。`;

export const LIFE_C_TOWN_GUIDE=LIFE_TOWN_GUIDE.replace('旅舍4个共享设施名额不是4个物理床位，仍须原合法服务格和World容量允许。','本期旅舍已声明4个实际休憩格，旧券与付费短憩共享同组4席；新开始须按当前设施区真实到场并合法相邻入座，旧已开始休息保留原位置与规则，仍计同一容量。');
