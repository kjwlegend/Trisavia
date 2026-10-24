// World copy: WS02 world-story-20261025, approved map and scene scope only.
export const WORLD_INTRODUCTION = {
  goal: '从清昼小镇出发，一起把想生活的世界建出来。',
  vision: '先认得几条街，结识几位邻居，留下属于自己的经历。以后，我们希望居民能够一起讨论要添什么、改什么，再把值得尝试的想法一步步做成可到访的地方。',
  town: '初晓洲河岸边的一座小镇，也是新居民的第一站。市政厅、港湾酒馆、石岸旅舍和公告牌就在街道旁；从认路、问候和第一次到访开始，陌生的名字会慢慢成为熟悉的邻居。',
  scope: '目前仅清昼小镇可以到访，其他地区与场景仍在规划中。共同建设是未来目标，自由建造与跨城旅行尚未开放。',
};

export const BOARD_COLUMNS = [
  {id: 'in-progress', title: '进行中', empty: '这里暂时没有事项。'},
  {id: 'completed', title: '已完成', empty: '这里暂时没有事项。'},
  {id: 'planned', title: '未来计划', empty: '这里暂时没有事项。'},
  {id: 'voting', title: '投票中', empty: '暂未开放投票。未来会在这里征询新的地图提案。'},
];

export const MAP_CARDS = [
  {id: 'map-atlas', column: 'completed', title: '展开新城地图册', summary: '浏览四方地区与故事，再回到已经开放的清昼小镇。', scope: '世界地图 · 已完成', completedVersion: '0.2.0', experienceHref: '/?atlas=1'},
  {id: 'map-sunset-bay', column: 'planned', title: '日落海 · 暮帆湾', summary: '构想一处看落日的海湾，让远方海岸有落脚的地方。', scope: '海岸场景 · 尚未开放'},
  {id: 'map-plain-outpost', column: 'planned', title: '逐鹿原 · 风禾驿', summary: '从一段路和几处地标开始，构想中央草原的落脚点。', scope: '草原场景 · 尚未开放'},
  {id: 'map-dawn-lake', column: 'planned', title: '初晓洲 · 晨露湖畔', summary: '在小镇之外构想湖岸与步道，留下下一处可探索的风景。', scope: '湖岸场景 · 尚未开放'},
  {id: 'map-mist-valley', column: 'planned', title: '远岚山地 · 松雾谷', summary: '构想北方山地的溪谷路线，走过松林、雾气与山口。', scope: '山地场景 · 尚未开放'},
];
