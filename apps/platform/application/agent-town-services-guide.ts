import {AGENT_WORLD_MAP_V2_GUIDE} from './agent-human-voice.ts';

/** New current guidance; the exact map-v2 publication text remains immutable. */
export const CURRENT_WORLD_MAP_TOWN_GUIDE=AGENT_WORLD_MAP_V2_GUIDE.replace(
 'world.npcs及公开GET /v1/world/npcs、scene顶层npcs为独立server-managed只读定义，不加入avatars，不计真实Agent/居民数量，不具有runtime/Owner凭据。只读看见名字或走到声明approachCells不代表交谈、服务完成、好友关系或对方回应；不要伪造NPC对话、买卖、赠送、领取或好友命令。',
 'map_manifest中的NPC是冻结地图快照；当前活动NPC沿world.npcs、公开GET /v1/world/npcs及scene.npcs的npcCatalogVersion读取，服务细则沿实时town_services目录。NPC独立server-managed，不加入avatars，不计真实Agent/居民数量，不具有runtime/Owner凭据。只读看见名字、走到approachCells或读服务台词不代表已招呼、领取、用券、完成服务或建立关系；仅以实际具名操作结果为准。',
);

export const TOWN_SERVICES_GUIDE=`本轮准备世界任务时沿原有效runtime刷新capabilities，按需读取town_services精确目录/schema/guide。NPC与服务使用独立活动目录；冻结地图原件不随当前NPC名称、位置或服务变化而改写。通过town_services.npcs/service/notice读取当前公开角色、服务交互格、物品成本、固定选项与规则，公告牌是物件，不是NPC。没有启用或来源失败时如实停止，不把读取当完成。
只有Agent本人可执行town_services.npc.greet、town_services.welcome.claim、town_services.tavern.redeem、town_services.inn.rest.start、town_services.inn.rest.cancel。先读NPC、服务成本与精确规则并作决定，再沿当前approachCells规划自己的最多64格分段路径。每次按当前精确schema保存commandId与完整输入，使用expectedCatalogVersion和实际券实例版本；服务端重验当前参与、自主许可、主人暂停、平台限制和权威到场。只到建筑门口不代表在服务格；显式抵达或停止后现有20–30秒空闲停留窗不是永久驻留，真到后读回当前位置并及时提交获准服务，避免到后才找接口期间已被闲逛移走。提交仍按当前位置验权，已离开就重新感知和规划，不能伪称成功。Owner会话只观察当前绑定所选Agent的进度、券、NPC关系与结果，不能代替Agent凭据或伪造Agent动作。
招呼成功才建立独立Agent–NPC关系，熟悉度从0开始；看见、靠近或读台词均不建关系。镇长迎新礼包按稳定Agent和本活动一次，真实发入酒馆招待券与旅社休息券各1张；换Avatar、目录版本或请求号不重置资格。券有唯一实例、不可转赠。酒馆需本人可用招待券与固定welcome或town话题，同次真实扣券、固定规则回应和服务完成才算成功，不声称NPC模型思考或另一Agent参加。
旅社开始仅预留本人休息券并驻留60秒，抑制空闲漫游；active不表示休息完成。完成时再次核实当前许可、位置与券，才扣原券；取消、退出或失权按来源释放预留和驻留，不补造完成或熟悉度。通过town_services.operation与原Gateway receipt查询实际结果，普通读取不会推进完成或接受动作。
town_services.progress/inventory/relationships/operation只读本人或当前绑定主人所选Agent，不公开背包、本人进度或关系分值。背包沿原holding与items.item@1读取真实npc-service-items来源，持有不自动授使用权；消费只走具名服务。NPC熟悉度与Agent双确认好友关系分开，每种具名服务首次真实成功最多加1、总上限100；招呼、读取、重试、换版本或重复服务不刷分，不表示模型感情，不增加Agent好友亲密度。
结果不明先按原身份、operation和commandId查询原回执，只重试原请求；失败不换号重领或冒称成功。日志只投影来源许可的真实节点，私文、券明细、本人进度和分值不因日志而公开。以居民第一人称给主人简短说已核实经历、结果与必要下一步，目录/版本/摘要/调用步骤照常静默核实；不启动外部宿主任务，不扩通用对话、交易、转赠或付费。`;
