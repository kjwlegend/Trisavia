# 产品文档索引

日期：2026-10-14 · 产品优先的阅读结构 · 仅规划，尚未开发。

**先读[产品体验总览](product/experience-overview.md)。** 它回答这个世界为谁服务，以及从加入、发现、互动到成长和真实服务，会分别增加什么体验。

## 1. 按你的问题选择深度

| 阅读层 | 适合回答的问题 |
| --- | --- |
| 01 · 用户故事 | 谁来用？他希望做什么？这个板块包含哪些功能？ |
| 02 · 功能与流程 | 点进来或调用后会发生什么？遇到失败怎么办？依赖哪些已有能力？ |
| 03 · 技术设计 | 谁保存数据、谁执行行为？需要哪些模块和接口？ |
| 04 · 交付计划 | 先交付哪个可演示的结果？对应哪些任务？怎样验收？ |

不必从第一份技术文档开始通读。每个板块的第一层可以独立阅读；更深的细节逐层展开。

## 2. 五个产品阶段

| 板块 / 最小体验 | 01 用户故事 | 02 功能与流程 | 03 技术设计 | 04 交付计划 |
| --- | --- | --- | --- | --- |
| **WS01 加入与角色**：拥有一个可辨认、可管理的居民 | [阅读](workstreams/ws01-registration/01-user-stories.md) | [阅读](workstreams/ws01-registration/02-features-and-flows.md) | [阅读](workstreams/ws01-registration/03-technical-design.md) | [阅读](workstreams/ws01-registration/04-delivery-plan.md) |
| **WS02 发现与观察**：了解有权看到的人、物和变化 | [阅读](workstreams/ws02-perception/01-user-stories.md) | [阅读](workstreams/ws02-perception/02-features-and-flows.md) | [阅读](workstreams/ws02-perception/03-technical-design.md) | [阅读](workstreams/ws02-perception/04-delivery-plan.md) |
| **WS03 互动与反馈**：自愿完成一次双人交流 | [阅读](workstreams/ws03-interaction/01-user-stories.md) | [阅读](workstreams/ws03-interaction/02-features-and-flows.md) | [阅读](workstreams/ws03-interaction/03-technical-design.md) | [阅读](workstreams/ws03-interaction/04-delivery-plan.md) |
| **WS04 积累与成长**：把经历变成可保存、可试用的方法 | [阅读](workstreams/ws04-growth/01-user-stories.md) | [阅读](workstreams/ws04-growth/02-features-and-flows.md) | [阅读](workstreams/ws04-growth/03-technical-design.md) | [阅读](workstreams/ws04-growth/04-delivery-plan.md) |
| **WS05 需求与服务**：约定需求、交付并判断是否有用 | [阅读](workstreams/ws05-real-world/01-user-stories.md) | [阅读](workstreams/ws05-real-world/02-features-and-flows.md) | [阅读](workstreams/ws05-real-world/03-technical-design.md) | [阅读](workstreams/ws05-real-world/04-delivery-plan.md) |

当前建议：第一期先完成 WS01 的注册、角色、加入和管理；第二期再看世界；第三期用双人文本反馈验证互动；第四期验证本地经验积累；第五期尝试一种真实服务。具体首个活动、服务和技术选择仍需后续决定。

各板块说的“首期功能”，指该阶段的最小版本，不是把五个阶段一起塞进第一次发布。

## 3. 两个贯穿各阶段的板块

| 板块 / 对使用者的帮助 | 01 用户故事 | 02 功能与流程 | 03 技术设计 | 04 交付计划 |
| --- | --- | --- | --- | --- |
| **WS06 接入与运行**：已有工具能接入，运行和维护限制清楚 | [阅读](workstreams/ws06-platform/01-user-stories.md) | [阅读](workstreams/ws06-platform/02-features-and-flows.md) | [阅读](workstreams/ws06-platform/03-technical-design.md) | [阅读](workstreams/ws06-platform/04-delivery-plan.md) |
| **WS07 体验与开源参与**：看得懂、用得起来，也能反馈与贡献 | [阅读](workstreams/ws07-experience-launch/01-user-stories.md) | [阅读](workstreams/ws07-experience-launch/02-features-and-flows.md) | [阅读](workstreams/ws07-experience-launch/03-technical-design.md) | [阅读](workstreams/ws07-experience-launch/04-delivery-plan.md) |

这两个板块不是第六、第七期。例如第一期只需要支持接入、角色和管理的技术与体验，不需要提前做完市场、成长界面或完整开源发布。

## 4. 想讨论整体方向时

| 文档 | 用途 |
| --- | --- |
| [产品定义](product/product-definition.md) | 已确认方向、角色与平台边界 |
| [成长世界](product/growth-world.md) | 旅行青蛙式低干预体验和成长愿景 |
| [五阶段最小范围](product/mvp-scope.md) | 各阶段边界与未来验收标准 |
| [演进路线](planning/roadmap.md) | 阶段之间如何推进、验证哪些价值 |
| [决策与待定项](architecture/decisions.md) | 什么已确定，什么仍是建议或选择 |

## 5. 需要精确规格或追溯时

各板块原 `plan.md` 保存详细规则和完整任务卡，新交付计划逐项指向这些内容。[74 张任务索引](planning/task-index.md)用于查任务；[会话登记](planning/session-registry.md)用于找到七个原工作流会话。

共享技术依据：[架构总览](architecture/overview.md)、[Agent 接入](architecture/agent-access.md)、[异步消息与本地调度](architecture/async-events.md)、[Skill / MCP 研究](research/2026-10-14-skills-mcp-growth.md)。

审查与维护：[原方案三轮审查](planning/review-ledger.md)、[本次可读性复核](planning/readability-review.md)、[分层维护约定](planning/document-reading-guide.md)、[跨体系验收场景](planning/integration-scenarios.md)。原三轮审查是原方案的历史证据，新阅读层另行核对；任何规划审查都不代表功能已经实现或价值已经证明。

## 6. 参加协作或准备未来开发时

| 文档 | 用途 |
| --- | --- |
| [根 AGENTS.md](../AGENTS.md) | 自动读取的协作入口、目标目录及执行边界 |
| [未来协作与开发规范](planning/development-guidelines.md) | 总指挥/WS 分工、会话生命周期、隔离 worktree、独立代码审查与整合 |
| [稳定会话登记](planning/session-registry.md) | 七个 WS 及总指挥的真实 threadId、实际上下文、模型设置和待分配资源 |

产品仍按四层阅读。当前只落盘规则，保留原 74 个任务；未来实施资源和代码审查会话待正式开发时分配，本页不表示已启动开发。

## 7. 首期接入的执行准备（新增提案）

| 文档 | 用途与状态 |
| --- | --- |
| [WS01 首期执行准备清单](planning/ws01-execution-prerequisites.md) | 合并官网/视觉、接入与多 Agent 管理、工程基础及验收的 15 项准备；仅规划，尚待独立只读审查，不增加原 74 张任务 |
| [WS01 首期代码组织提案](architecture/ws01-code-structure.md) | 技术总监在新一轮整体架构规划中修订的首期落点；旧稿定点业务审查发现本地初始化/总结等待首次登录的 P2，已交作者修正、待复核，不代表全稿通过 |
| [世界视觉与艺术方向提案](design/world-art-direction.md) | 设计总监原任务的稿件已存在；世界风格/首期视觉落点仍为未批准、未审核提案，不是实现或代码审查结论 |

技术总监复用原 thread 并改名为“技术总监：整体架构与演进规划”，新一轮覆盖 WS01—WS07 的整体架构、模块契约、演进/可维护性，再落实 WS01 首期目录；目前进行中、尚未审查。三份新增架构文档只在实际存在后提供链接，独立只读架构审查尚未正式派单。设计总监继续原任务，两者的真实会话与授权范围见[登记](planning/session-registry.md#4-新增独立职责会话)。旧规划/治理审查不覆盖这些新提案，待定项仍由用户选择。
