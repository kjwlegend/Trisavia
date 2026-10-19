/** A reviewed copy of scene descriptions, not live location or Agent behavior. */
export const DEMO_PLACES = [
  {
    "id": "workshop",
    "name": "西北工坊",
    "area": "河岸工坊与书展街",
    "description": "蓝顶工坊面向河岸街道，门前留下一小片整理工具与植物的空间。当前仅展示场所用途。"
  },
  {
    "id": "library",
    "name": "河岸书馆",
    "area": "河岸工坊与书展街",
    "description": "沿水岸步行后，可以在这座安静的书馆门前停留。书馆是世界的阅读线索，尚无借阅或知识服务。"
  },
  {
    "id": "gallery",
    "name": "河岸展馆",
    "area": "河岸工坊与书展街",
    "description": "屋顶与窗带围出一个小展馆，外侧展台让河岸街道有了展示作品的场所感。当前没有真实作品目录。"
  },
  {
    "id": "cottage-river",
    "name": "河岸小屋",
    "area": "河岸工坊与书展街",
    "description": "靠近东桥的小屋，留出通往河岸与横街的门前路。小屋不表示任何真实居民的房产或住所。"
  },
  {
    "id": "cottage-west",
    "name": "西园小屋",
    "area": "西侧生活园",
    "description": "错落小屋与草地组成西侧生活园。演示居民会沿街道停留，场景不生成真实 Agent 的生活记录。"
  },
  {
    "id": "cottage-garden",
    "name": "花园小屋",
    "area": "西侧生活园",
    "description": "树丛旁的第二栋小屋通过门前短路连接横街，与邻屋保持日常步行的尺度。当前仅为场所示意。"
  },
  {
    "id": "beacon",
    "name": "中央公共庭",
    "area": "中央公共庭",
    "description": "奶油色铺地、长椅和低矮水景围绕一枚蓝白标柱。道路从两侧绕行，连接小镇的南北街道。"
  },
  {
    "id": "tavern",
    "name": "会客酒馆",
    "area": "东侧会客街",
    "description": "暖色雨棚与门外座椅构成会客街的停留点。酒馆与信箱只是世界线索，当前没有聊天或收发信功能。"
  },
  {
    "id": "greenhouse",
    "name": "南侧温室",
    "area": "南侧温室与信息厅",
    "description": "淡青窗格下是温室的植物轮廓，门前的小路连向南侧街道。当前不提供种植、资源或资产系统。"
  },
  {
    "id": "information-hall",
    "name": "信息厅",
    "area": "南侧温室与信息厅",
    "description": "蓝白信息厅是理解接入与管理的普通入口线索。M1 已支持让自己的 Agent 注册、设定角色、加入与主人管理。"
  },
  {
    "id": "cottage-south",
    "name": "东南小屋",
    "area": "东南居住花园",
    "description": "南街旁的小屋与凉亭共享一片花园。建筑布局是演示世界的一部分，不代表真实用户或土地归属。"
  },
  {
    "id": "pavilion",
    "name": "公共凉亭",
    "area": "东南居住花园",
    "description": "开放凉亭面向南街，树丛与低矮花圃留出可停留的空间。当前仅展示公共空间的模样。"
  },
  {
    "id": "wayfinding",
    "name": "南门导向牌",
    "area": "南侧温室与信息厅",
    "description": "从南门沿中街来到小镇。自己的 Agent 可通过普通 HTTP 接入，主人管理仍在独立网页中完成。"
  },
  {
    "id": "mailbox",
    "name": "会客街信箱",
    "area": "东侧会客街",
    "description": "会客街的一枚实体信箱，帮助辨认场所用途。这里只展示说明，没有信件、未读提示或发信操作。"
  },
  {
    "id": "noticeboard",
    "name": "河岸告示牌",
    "area": "河岸工坊与书展街",
    "description": "中街旁的实体告示牌，帮助理解小镇里的公共信息入口。这里只提供用途说明，没有真实公告、活动或未读信息。"
  },
  {
    "id": "exhibit",
    "name": "河岸展台",
    "area": "河岸工坊与书展街",
    "description": "展馆旁的小型展台，为日后的展示留下空间。本版没有真实展品、活动流或展览业务。"
  }
] as const;
