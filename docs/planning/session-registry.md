# 稳定会话与未来执行登记

日期：2026-10-14 · 七个 WS 均为真实独立本地会话，保留用于后续用户反馈。当前只维护 Markdown，未来实施资源尚未分配。

产品阅读从[四层索引](../INDEX.md)开始。执行规则见根 [AGENTS.md](../../AGENTS.md)及[未来协作与开发规范](development-guidelines.md)。本表是 WS 负责人调度映射：使用 Codex `threadId`，不使用临时 sub-agent 名称或虚构运行时 agent UUID。

## 1. 项目与核验来源

| 字段 | 当前事实 |
| --- | --- |
| 应用项目标签 | `connet.ai` |
| 项目 ID | `38334c88-83f5-4e6a-a27e-b272356a3777` |
| 目标目录 | `/Users/kjw/Workspace/Codes/agents-era` |
| 七个 WS 的主机/实际目录 | 均为 `local` / `/Users/kjw/Workspace/Codes/agents-era`，关联上述项目 ID |
| Git 状态 | 目标目录当前不是 Git 仓库；本轮只读核对，未初始化 Git |
| 映射来源 | 2026-10-14 统筹通过 `list_threads` / `list_projects` 核对后交 WS06 落盘，标题按原值保留 |
| 模型设置来源 | 2026-10-14 统筹通过 `send_message_to_thread(model, thinking)` 将七个 WS 设为 `gpt-6.1-sol` / `xhigh`，调用已成功受理 |

应用标签不能把本项目指向历史 `/Users/kjw/Workspace/Codes/connet-ai`。模型设置受理只记录配置事实，不证明所有未来执行、接入或兼容能力已经验证。

## 2. 七个稳定 WS 负责人

下表所有会话的主机、实际目录和项目 ID 均为§1所列 WS 上下文。用户对某流的反馈派回同一个 thread；标题用于识别，threadId 用于调度。

| WS | 原会话标题 | 负责人调度 ID（threadId） | 模型 / 推理 | 职责与当前状态 |
| --- | --- | --- | --- | --- |
| WS01 | M1 加入注册规划 | `01a1368e-0957-78d0-9030-1b0743e44d90` | `gpt-6.1-sol` / `xhigh` | 加入注册、角色、主人管理；原规划完成，保留并等待反馈 |
| WS02 | M2 世界感知规划 | `01a1368e-1520-7d01-b5c4-ee6f943030bc` | `gpt-6.1-sol` / `xhigh` | 世界对象、可见性、感知及离线同步；原规划完成，保留并等待反馈 |
| WS03 | M3 互动体系规划 | `01a1368e-1ff3-7df3-8c9a-1c09bb3eaea0` | `gpt-6.1-sol` / `xhigh` | 三类主体互动及异步流程；原规划完成，保留并等待反馈 |
| WS04 | M4 成长学习规划 | `01a1368e-2d56-7da1-b973-779c49b405c5` | `gpt-6.1-sol` / `xhigh` | 本地学习、记忆、技能及效果验证；原规划完成，保留并等待反馈 |
| WS05 | M5 真实世界交互规划 | `01a1368e-3b23-7f13-86fe-1725a2280743` | `gpt-6.1-sol` / `xhigh` | 真实需求、履约、服务及可选交易实验；原规划完成，保留并等待反馈 |
| WS06 | 跨阶段平台架构规划 | `01a1368e-4612-7441-8135-e72a3f0935a9` | `gpt-6.1-sol` / `xhigh` | 平台架构与接入；原规划完成，旧治理核对已通过；本轮清单/登记已交付待新审查，保留接收反馈 |
| WS07 | 体验开源与市场验证规划 | `01a1368e-5330-7e62-a9aa-0e3ac8bade56` | `gpt-6.1-sol` / `xhigh` | 体验设计、文案、研究、可用性与发布准备；原规划完成，保留并等待反馈 |

本次职责同步已由统筹发给各 WS。未来新执行及专门独立代码审查会话默认 `gpt-6.1-sol` / `xhigh`，用户另行指定时更新登记。WS 内部 sub-agent 可拆分本流工作，不能代替其他稳定 WS 或独立代码审查 thread。

## 3. 总指挥的实际上下文

| 字段 | 当前登记 |
| --- | --- |
| 原会话标题 | 总指挥 |
| threadId | `01a1345f-c24c-75f1-9b02-76d8ff8e903e` |
| 主机 | `local` |
| 当前实际 cwd | `/Users/kjw/Workspace/Codes/connet-ai` |
| 当前 projectId | `null`；不写成已关联本项目 |
| 本任务目标目录 | `/Users/kjw/Workspace/Codes/agents-era` |
| 模型 / 推理 | 沿用原配置，本次未变更；具体值本轮未核验 |
| 职责 / 状态 | 任务分发、会话/worktree 生命周期、依赖协调、进度跟踪及结果汇总；保留、负责调度 |

总指挥不直接编辑产品文档、技术文件或代码，不用自己 thread 下临时 sub-agent 代替既有 WS 执行归属工作。未来调用 worktree 工具前须核对实际 repo 与执行上下文；目标 Git 仓库和正确上下文就绪前，不得误在旧 `connet-ai` 创建本项目 worktree。

## 4. 新增独立职责会话

以下按统筹提供的实际创建/派单事实登记，不使用临时 sub-agent 名称，不新增 WS08/WS09。技术总监复用原稳定会话，已有目标项目运行确认；设计总监的目标/配置 cwd 按创建事实记录，不冒称另行核验了实际运行目录。两者仅规划，不替代七个稳定 WS、实际实现或专门独立代码审查 thread。

### 技术总监

| 字段 | 当前事实 |
| --- | --- |
| 当前会话标题 | 技术总监：整体架构与演进规划 |
| 原创建标题 | 技术总监：WS01 代码结构规划；本轮已改名，threadId 不变 |
| threadId | `01a138f6-2c0e-75a1-87fe-ee0735493f4f` |
| host / 实际 cwd | `local` / `/Users/kjw/Workspace/Codes/agents-era` |
| projectId | `38334c88-83f5-4e6a-a27e-b272356a3777` |
| 创建及本轮模型 / 推理 | `gpt-6.1-sol` / `xhigh`；本轮复用未改变配置 |
| 职责 | 基于 WS01—WS07 的整体架构设计提案与取舍、跨域边界、数据/协议契约、阶段演进及可维护性；反推 WS01 首期目录和实施包，与各 WS 协调，不接管其业务所有权 |
| 本轮文档写入范围 | 新增 `docs/architecture/platform-architecture.md`、`docs/architecture/module-contracts.md`、`docs/architecture/evolution-and-maintainability.md`；修订 `docs/architecture/ws01-code-structure.md`；其余文件不得修改 |
| 当前状态 | 新一轮整体规划进行中，尚未审查/获批；WS01 仍为首期，不提前实施后续阶段 |
| 原稿与审查事实 | 原 WS01 稿曾完成作者交付并自查 15 处链接；随后定点业务审查发现一个 P2：本地初始化/完成总结不能等待主人首次登录。问题已交作者修正，尚无修订复核结论，不登记原稿全通过；原作者自查不覆盖本轮整体架构新稿 |
| 协作与后续审查 | 已派技术总监读取七 WS 并向 WS02—WS05 索取只读域约束；WS06 负责既有平台边界及实施可行性交叉核对。整体初稿后拟交 WS06 独立只读架构审查，尚未正式派审；用户保留待定项选择权 |
| 实施 worktree / branch | 待分配，尚未创建；本次不初始化 Git |
| 独立代码审查 threadId | 待分配，尚未创建；技术总监不是该 reviewer |

### 设计总监

| 字段 | 当前事实 |
| --- | --- |
| 原会话标题 | 设计总监：世界风格规划 |
| threadId | `01a138fb-37ea-77a2-a918-848bb02cb620` |
| host | `local` |
| 目标/配置 cwd | `/Users/kjw/Workspace/Codes/agents-era`；实际运行 cwd 本轮未单独核验 |
| projectId | `38334c88-83f5-4e6a-a27e-b272356a3777` |
| 创建时模型 / 推理 | `gpt-6.1-sol` / `xhigh` |
| 职责 | 3 个世界视觉/艺术方向及推荐、官网/角色身份卡/主人管理页的首期落点、素材与性能约束；与 WS07、技术总监及 WS06 协同 |
| 唯一文档写入范围 | `docs/design/world-art-direction.md`；不替其他会话写方案，不初始化代码或美术生产工程 |
| 当前状态 | 已派单；稿件在产出，未批准、未审核，不登记已通过 |
| 实施 worktree / branch | 待分配，尚未创建 |
| 独立代码审查 threadId | 待分配，尚未创建；设计总监不是该 reviewer |

## 5. 未来资源与生命周期

| 归属 | 实施 worktree | branch | 专门独立代码审查 threadId |
| --- | --- | --- | --- |
| WS01 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS02 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS03 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS04 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS05 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS06 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |
| WS07 | 待分配，尚未创建 | 待分配；新分支默认 `codex/` | 待分配，尚未创建 |

以上是待分配归属，不预定必须创建七套资源。统筹按实际任务和依赖分配，优先复用合适 worktree；专门代码审查 thread 可承担多个明确范围，但始终与作者分离。目标 repo/remote、base ref/提交、实际 branch/path、owner/task/可写范围、测试/审查证据和整合执行会话均在正式开发时登记，当前没有虚构 ID 或提交。

用户已授权统筹自主创建、调度、恢复和归档会话，无需每次再次询问。当前七个 WS 为后续反馈保留，不因闲置归档。归档可恢复，不是永久删除；归档/回收前保全未交付结果、依赖、工作树状态和恢复线索，更新本表的状态、交付入口、归档原因及接续者。会话归档与 worktree 回收分别记录。

上一轮共享治理文档由 WS06 受指定维护，范围为根 AGENTS.md、development-guidelines.md、本登记及 README/INDEX/charter/分层维护约定的必要同步。WS07 的最终定点只读复核已经通过，未发现残项：七个 WS 原 ID 唯一、统筹 ID 正确，上下文/配置/职责完整；charter 与 README/INDEX/reading-guide 已同步；两份核心规范哈希未变；四层阅读与原 74 任务保留。WS07 此次核对未修改文件，结果由统筹确认后交本登记更新。

上述通过只覆盖旧治理范围，不覆盖本轮新增的[首期执行准备清单](ws01-execution-prerequisites.md)、本登记的新补充或两位总监稿。旧轮 WS06 自检与 WS07 独立核对证据保持原适用范围，不重写历史审查。

本轮 WS06 仅更新本登记、准备清单中的技术总监定位/相关依赖状态及 INDEX。技术总监复用原会话推进整体规划，设计总监继续自己的任务；新稿/登记补充尚待相应审查，原 WS01 稿 P2 尚待修订复核。WS06 的整体架构独立只读审查尚未正式派单；实施 worktree 与专门代码审查 thread 仍未创建。

## 6. 原规划产出与历史证据

| 工作流 | 原详细产出 |
| --- | --- |
| WS01 | [规划](../workstreams/ws01-registration/plan.md) / [审查](../workstreams/ws01-registration/review.md) |
| WS02 | [规划](../workstreams/ws02-perception/plan.md) / [审查](../workstreams/ws02-perception/review.md) |
| WS03 | [规划](../workstreams/ws03-interaction/plan.md) / [审查](../workstreams/ws03-interaction/review.md) |
| WS04 | [规划](../workstreams/ws04-growth/plan.md) / [审查](../workstreams/ws04-growth/review.md) |
| WS05 | [规划](../workstreams/ws05-real-world/plan.md) / [审查](../workstreams/ws05-real-world/review.md) |
| WS06 | [规划](../workstreams/ws06-platform/plan.md) / [审查](../workstreams/ws06-platform/review.md) |
| WS07 | [规划](../workstreams/ws07-experience-launch/plan.md) / [审查](../workstreams/ws07-experience-launch/review.md) |

七个负责人均曾实际委派设计子 Agent 和不同的独立审查者，完成 R1；R2 完成相邻体系交叉审查与修订复核；R3 的历史执行与证据见[审查总记录](review-ledger.md)及各流 review.md。上述规划任务已完成，74 张未来实施任务均尚未执行。历史规划审查与未来专门代码审查 thread 是不同交付，不能互相替代。
