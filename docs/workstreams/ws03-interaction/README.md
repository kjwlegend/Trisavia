# WS03 · 互动与反馈

让居民自愿发出邀请、选择是否参与，并完成一次有明确结果的异步交流。

**当前阶段：既有文本反馈、好友／亲密度与镇民关系已交付；生活行为设计已接管，实现待推进。** 当前实现和各自未测范围以[唯一状态表](../../planning/workstream-status.md)为准；2026-10-15对WS02的只读跨流复核仍见原[review第6节](../ws02-perception/review.md#6-2026-10-15对象通知与主动感知新讨论)，不改写其历史结论。

**当前新增入口：**[M3生活行为v1](life-actions-v1/README.md)，完整范围为A工作／免费休息／有限计划／4NPC→B购物／钓鱼／出售→C餐饮／旅舍／书屋／到访／赠礼。WS03已接设计，最小A及各域接口责任见[交付§7](life-actions-v1/05-delivery-and-acceptance.md#m3-a-handoff-20261025)；不混入当前0.1.2／0.2.0 UAT批次。

**第一次阅读：**[用户故事](01-user-stories.md) → [功能与流程](02-features-and-flows.md)。

## 已有材料

| 阶段 | 材料及用途 |
| --- | --- |
| 用户故事 | [01 用户故事](01-user-stories.md)：邀请、参与、反馈、结束与主人观察 |
| PRD／流程 | [02 功能与流程](02-features-and-flows.md)：双主体文本反馈候选闭环 |
| 技术架构提案 | [03 技术设计](03-technical-design.md)：身份、异步状态与业务边界 |
| 交付建议 | [04 交付计划](04-delivery-plan.md)：建议切片与未来验收条件 |
| 详细规格与历史审查 | [plan.md](plan.md)保留原任务卡；[review.md](review.md)保留规划复核，均不是实现验收 |

以上原规划及复核保留历史范围；新增生活设计不是实现／素材验收证明，不为未发生的交付建立空报告。

## 依赖与负责范围

依赖 [WS01 身份](../ws01-registration/README.md)、[WS02 读取与感知规划](../ws02-perception/README.md)及 [WS06 异步与宿主运行边界](../ws06-platform/README.md)。经历如何用于成长见 [WS04](../ws04-growth/README.md)，真实服务承接见 [WS05](../ws05-real-world/README.md)；这些后续方向不扩大本流首期范围。

业务归 WS03，稳定负责人、派单与可写范围以[会话登记](../../planning/session-registry.md)为准。返回[总索引](../../INDEX.md)。
