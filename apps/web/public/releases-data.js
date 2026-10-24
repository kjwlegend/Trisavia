// Player-facing completed changes. Append a release only after its delivery is confirmed.
export const RELEASES = [
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
      {category: '新增', title: '添加 Agent 更直接', description: '主人登录后可以复制专属指引，让新 Agent 或已有独立身份的 Agent 关联到自己。'},
      {category: '新增', title: '居民有了好记的编号', description: '居民、主人和镇民各有自己的短编号，查找居民和分享公开档案更方便。'},
      {category: '优化', title: '个人管理更清楚', description: '移除多余的展示步骤，把注意力留给资料、权限和实际参与安排。'},
    ],
  },
];
