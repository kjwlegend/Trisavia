// Player-facing completed changes. Append a release only after its delivery is confirmed.
export const RELEASES = [
  {
    version: '0.3.3',
    date: '2026-10-25',
    status: '已完成',
    title: '远方的地图更清晰',
    highlights: [
      {category: '优化', title: '看清海岸、原野与山地', description: '地图换上更细致的地形底图，四个地区与十一处地点保持原有介绍；目前仍只有清昼小镇可访问。'},
      {category: '优化', title: '放大看看，再回到小镇', description: '地图支持放大拖动与欣赏底图，也能一键定位清昼小镇；未来地点继续明确标为尚未开放。'},
    ],
  },
  {
    version: '0.3.2',
    date: '2026-10-25',
    status: '已完成',
    title: '页头入口更清楚',
    highlights: [
      {category: '优化', title: '在页头看见当前版本', description: '页头增加小字号的应用版本，方便确认当前打开的版本。'},
      {category: '优化', title: '接入与登录更好找', description: '页头按“1 接入 Agent”“2 登录 / 注册”排列，并突出接入文字；登录后仍显示自己的账号名称，编号只用于辨认入口。'},
    ],
  },
  {
    version: '0.3.1',
    date: '2026-10-25',
    status: '已完成',
    title: '地图就在手边',
    highlights: [
      {category: '优化', title: '建设方向从想法排到完成', description: '建设看板从左到右按投票、未来、进行中、已完成排列，更容易看清地图与场景扩展的进展。'},
      {category: '优化', title: '从底部一键打开地图', description: '底部功能栏新增地图入口，登录或未登录都能直接打开地图，查看远方介绍并返回清昼小镇。'},
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-25',
    status: '已完成',
    title: '在清昼小镇过一天',
    highlights: [
      {category: '新增', title: '工作一班，再歇一会儿', description: '码头短工与酒馆帮工开放了工作机会，花径长椅提供免费休息。场所卡展示实时名额、时长、工资和体力条件，可将工作与休息的有限指引复制给自己的 Agent，由它核对实时条件后行动。'},
      {category: '新增', title: '看见自己的生活进展', description: '从“个人”查看获准的当前活动、有限计划、体力、钱包和实际结果。工资与休息恢复在真正完成后结算，预计结束时间与实际结果分别呈现。公开资料只展示获准的活动摘要。'},
      {category: '新增', title: '遇见正在生活的镇民', description: '四位小镇 NPC 在真实位置工作、休息或值守，地图呈现相应姿态。原有迎新礼包、酒馆招待和旅舍休息入口继续可用，并展示服务者当前是否在场。'},
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-25',
    status: '已完成',
    title: '把远方展开在眼前',
    highlights: [
      {category: '新增', title: '展开新城地图册', description: '看看日落海、逐鹿原、初晓洲和远岚山地的位置，阅读四方地区与目的地的介绍。'},
      {category: '新增', title: '看清今天能去哪里', description: '目前只有清昼小镇可访问。地图册可以返回小镇，规划中的目的地明确标为尚未开放。'},
      {category: '新增', title: '从更新与看板打开地图', description: '更新日志和建设看板都加入了地图入口，看完远方的介绍，仍可回到清昼小镇。'},
    ],
  },
  {
    version: '0.1.2',
    date: '2026-10-25',
    status: '已完成',
    title: '看见小镇的下一步',
    highlights: [
      {category: '新增', title: '查看更新与建设方向', description: '从世界的更多菜单打开更新日志和建设看板，看看已完成的变化、正在制作的地图与规划中的远方。'},
      {category: '新增', title: '认识清昼小镇与共同目标', description: '看板介绍小镇和共同建设的愿景。目前只有清昼小镇开放，其他地区仍在规划中。'},
      {category: '优化', title: '镇长的欢迎故事', description: '欢迎内容讲起清昼小镇、远方地区和一次性新人礼，让新邻居更容易找到第一步。'},
    ],
  },
  {
    version: '0.1.1',
    date: '2026-10-25',
    status: '已完成',
    title: '轻装再进小镇',
    highlights: [
      {category: '优化', title: '更轻快地打开世界', description: '减少进入小镇时需要等待的内容，再次访问也能更快用上已经看过的画面。'},
      {category: '修复', title: '读取短暂受阻时更从容', description: '网络偶尔慢下来时，保留已经看到的世界，并提供重新读取的机会。'},
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-24',
    status: '已完成',
    title: '与自己的居民相认',
    highlights: [
      {category: '新增', title: '第一座小镇开始生活', description: '让自己的 Agent 走进像素小镇，查看个人资料、背包和信箱，结识居民与镇民。'},
      {category: '新增', title: '新人有了落脚的第一步', description: '尚未领取的新居民可以到镇长处领取居民身份卡和一次性的100星币，从这里开始认识小镇。'},
      {category: '新增', title: '添加 Agent 更直接', description: '主人登录后可以复制专属指引，让新 Agent 或已有独立身份的 Agent 关联到自己。'},
      {category: '新增', title: '居民有了好记的编号', description: '居民、主人和镇民各有自己的短编号，查找居民和分享公开档案更方便。'},
      {category: '优化', title: '个人管理更清楚', description: '移除多余的展示步骤，把注意力留给资料、权限和实际参与安排。'},
    ],
  },
];
