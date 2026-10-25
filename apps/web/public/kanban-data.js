// World copy: WS02 world-story-20261025; life cards follow the approved M3 roadmap.
export const WORLD_INTRODUCTION = {
  goal: '从清昼小镇出发，一起把想生活的世界建出来。',
  vision: '先认得几条街，结识几位邻居，留下属于自己的经历。以后，我们希望居民能够一起讨论要添什么、改什么，再把值得尝试的想法一步步做成可到访的地方。',
  town: '初晓洲河岸边的一座小镇，也是新居民的第一站。市政厅、港湾酒馆、石岸旅舍和公告牌就在街道旁；从认路、问候和第一次到访开始，陌生的名字会慢慢成为熟悉的邻居。',
  scope: '目前仅清昼小镇可以到访，其他地区与场景仍在规划中。共同建设是未来目标，自由建造与跨城旅行尚未开放。',
};

export const BOARD_COLUMNS = [
  {id: 'voting', title: '投票', empty: '暂未开放投票。未来会在这里征询生活与地图提案。'},
  {id: 'planned', title: '未来', empty: '这里暂时没有事项。'},
  {id: 'in-progress', title: '进行中', empty: '这里暂时没有事项。'},
  {id: 'completed', title: '已完成', empty: '这里暂时没有事项。'},
];

export const MAP_CARDS = [
  {id: 'map-atlas', column: 'completed', title: '展开新城地图册', summary: '浏览四方地区与故事，再回到已经开放的清昼小镇。', scope: '地图 · 已完成', completedVersion: '0.2.0', experienceHref: '/?atlas=1'},
  {id: 'map-sunset-bay', column: 'planned', title: '日落海 · 暮帆湾', summary: '构想一处看落日的海湾，让远方海岸有落脚的地方。', scope: '海岸场景 · 尚未开放'},
  {id: 'map-plain-outpost', column: 'planned', title: '逐鹿原 · 风禾驿', summary: '从一段路和几处地标开始，构想中央草原的落脚点。', scope: '草原场景 · 尚未开放'},
  {id: 'map-dawn-lake', column: 'planned', title: '初晓洲 · 晨露湖畔', summary: '在小镇之外构想湖岸与步道，留下下一处可探索的风景。', scope: '湖岸场景 · 尚未开放'},
  {id: 'map-mist-valley', column: 'planned', title: '远岚山地 · 松雾谷', summary: '构想北方山地的溪谷路线，走过松林、雾气与山口。', scope: '山地场景 · 尚未开放'},
];

export const LIFE_CARDS = [
  {id: 'life-work-shift', column: 'completed', title: '上班赚取星币', summary: '在码头或酒馆完成一班工作，按真实结果领取星币。', scope: '生活体验 · 本地已完成', completedVersion: '0.3.0'},
  {id: 'life-bench-rest', column: 'completed', title: '在长椅休息恢复体力', summary: '在花园长椅免费休息，完成后按实际结果恢复体力。', scope: '生活体验 · 本地已完成', completedVersion: '0.3.0'},
  {id: 'life-work-rest-plan', column: 'completed', title: '一次安排工作与休息', summary: '把工作、走路和休息排成一次有限计划，本地宿主离线后仍可按规则执行。', scope: '生活体验 · 本地已完成', completedVersion: '0.3.0'},
  {id: 'life-npc-routines', column: 'completed', title: '首批镇民主动生活', summary: '镇长、酒保、旅舍老板和码头熟手会按安排工作、休息或值守。', scope: '生活体验 · 本地已完成', completedVersion: '0.3.0'},
  {id: 'life-shop-goods', column: 'planned', title: '购买鱼具与生活用品', summary: '挑选鱼具与日常用品，为小镇生活做准备。', scope: '生活体验 · 尚未开放'},
  {id: 'life-sea-fishing', column: 'planned', title: '去海边钓鱼', summary: '带上鱼具去海边，把一次等候变成自己的收获。', scope: '生活体验 · 尚未开放'},
  {id: 'life-sell-fish', column: 'planned', title: '出售鱼获换取星币', summary: '把钓到的鱼卖出去，换取生活所需的星币。', scope: '生活体验 · 尚未开放'},
  {id: 'life-tavern-meals', column: 'planned', title: '在酒馆吃饭与加工鱼餐', summary: '到酒馆吃一顿饭，也能把鱼获交给酒馆加工成鱼餐。', scope: '生活体验 · 尚未开放'},
  {id: 'life-paid-lodge-rest', column: 'planned', title: '花星币在旅舍休息', summary: '增加花星币在旅舍休息的选择，同时保留免费长椅与已有休息券。', scope: '生活体验 · 尚未开放'},
  {id: 'life-bookhouse-reading', column: 'planned', title: '去书屋阅读', summary: '走进书屋，留一段时间给阅读。', scope: '生活体验 · 尚未开放'},
  {id: 'life-scenic-visits', column: 'planned', title: '到访小镇风景', summary: '沿着小镇的路走走，留下到访风景的经历。', scope: '生活体验 · 尚未开放'},
  {id: 'life-friend-gifts', column: 'planned', title: '给好友送一份礼物', summary: '把礼物送给好友，对方接受后才会放入对方的背包。', scope: '生活体验 · 尚未开放'},
  {id: 'life-more-npc-routines', column: 'planned', title: '结识更多会生活的镇民', summary: '认识更多有自己工作、休息与日常安排的镇民。', scope: '生活体验 · 尚未开放'},
  {id: 'life-diary', column: 'planned', title: '把新的生活写进日记', summary: '从自己获准查看的历史和他人最近10条公开经历中，读到新的小镇生活。', scope: '生活体验 · 尚未开放'},
];
