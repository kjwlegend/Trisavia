# WS02 · 完整世界感知

默认让 Agent 完整遍历当前有权感知的全世界，按需读到获准详情，回来能补看；人类在持续动态世界及背包、信箱中理解同源信息。

**2026-10-19 当前授权：**完整感知接口规划＋现有背包／信箱／世界 HUD 交互改进。整套真实感知后端尚未授权。本轮业务入口已覆盖此前“只读局部”的默认，不沿用旧 PASS；状态与发现见 [review](review.md)。`Option 2` 仍指 WS02。

**先读可执行流程：**[范围摘要与未决项](discussion-brief.md) → [用户故事](01-user-stories.md) → [范围与流程](02-features-and-flows.md)。

| 交付层 | 唯一职责与入口 |
| --- | --- |
| 业务与对象 | [世界对象全清单](world-objects.md)、[信箱与阅读状态](mail-and-perception.md) |
| 接口合同 | [world-perception-api.md](world-perception-api.md)：拟议 HTTP、字段、JSON、完整分页与恢复；是唯一线协议稿，全部待实现 |
| 技术边界 | [03](03-technical-design.md)：来源 owner、保存与一致性责任；不重复另一套接口 |
| 任务与验收 | [04](04-delivery-plan.md)：本轮前端与未来后端分开、原十卡映射；[plan](plan.md)保留原卡与历史规格 |
| 设计／评估 | [WS07 内容设计](design/ws02-perception-experience.md)、[WS07 设计合同](design/ws02-design-contract.md)、[技术总监评估](architecture/ws02-technical-evaluation.md)、[WS06 引擎评估](architecture/ws02-world-engine-evaluation.md)由原 owner 维护，按本轮业务输入分别同步，实际复核各记范围，不将旧稿视为本轮已验收 |

世界 HUD 返回动态画布并关闭内容窗，不新增静态世界卡片；删除的是编造演示动态列表，其他地图／Agent 漫游不扩大修改。背包用游戏网格，信箱支持附加详情、本人已读／未读与列表删除；真实来源未接时明确演示，状态不影响 Agent 或源业务。

当前工作基线 main `6cdb47fc`、8789 固定 `d836a4a` 仅按[登记](../../planning/session-registry.md)引用，不在本轮操作服务／数据。现有 M1 已知 ID 的公开资料和访问期望间隔都不等于全世界目录或服务端调度。WS01 保有身份／资料／账号业务，WS03—05 保有原业务真源，WS02 组织发现与读取；[WS06 当前架构](../ws06-platform/architecture/README.md)提供公共机制方向。

D1—D4 保持[显式待选](discussion-brief.md#四个真正影响首期的选择)，已确认的默认全域遍历和本轮交互不被无关待选阻塞。返回[总索引](../../INDEX.md)。
