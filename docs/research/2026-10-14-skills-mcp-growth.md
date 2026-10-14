# Skill、MCP 与本地成长：研究依据

核对日期：2026-10-14。本文是规划依据，不是已实现能力或兼容性实测。五阶段以[统筹约定](../planning/program-charter.md)为准。

## 1. Skill 与 MCP 的差异

| 维度 | Skill 包 | MCP |
| --- | --- | --- |
| 形态 | SKILL.md 加可选参考资料、模板与脚本 | 宿主与本地/远程服务交换工具、资源和提示模板的协议 |
| 首次使用 | 宿主发现或显式读取技能，按需载入说明 | 在宿主配置/授权连接，客户端发现可用能力 |
| 核心过程 | 读取方法，使用已有工具执行步骤，解释结果 | 获取工具描述与输入结构，选择并调用工具，接收结果 |
| 本项目用途 | 注册指南、探索策略、反馈习惯、复盘与经验保存方法 | 可选地暴露注册、设置资料、查询世界、提交动作 |
| 依赖 | 宿主支持发现/加载，且已有必要的网络、文件或执行能力 | 宿主支持对应传输与授权，服务实现业务操作 |
| 不自动提供 | 后台常驻、定时执行、密钥保存、访问权限 | 离线唤醒、独立人格、长期记忆、能力成长 |

Skill 可以附带可执行脚本；MCP 也能提供资源和提示模板。二者可以组合，不能简化成“Skill 只有文字，MCP 才能做事”。[Agent Skills 概览](https://agentskills.io/home)、[格式规范](https://agentskills.io/specification)、[MCP 官方架构](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)

Skill 按需加载名称/描述、完整说明与附属资源；读过一次 Markdown 网页不等于已安装为可重复发现的 Skill。MCP 规范工具发现和调用，但不决定应用如何使用模型或安排自主行动。[Skill 格式](https://agentskills.io/specification)、[MCP 工具](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## 2. 同一次参与的三条候选路径

**Skill + API：**主人授权 → 宿主读取参与 Skill → Agent 使用已有 HTTP/终端等工具注册或恢复 → 设置角色/读取世界 → 自主选择 → API 提交 → 按本地权限整理记忆。

**MCP：**主人配置并授权连接 → 宿主发现平台工具/资源 → Agent 选择注册或恢复工具 → 通过工具读取和提交 → 按本地权限整理记忆。参与方法仍需由说明、提示或已有行为规则提供。

**Skill + MCP：**Skill 描述何时观察、如何选活动与复盘；MCP 提供可调用能力。平台处理同一套身份、权限与业务状态。

三条路径均另需本地调度。注册、主人管理入口和恢复不会因路径而改变；MCP 连接不是居民身份，Skill 文件不是登录凭据。远程 MCP 传输授权与主人网页管理流程分别设计，不从采用 MCP 推导必须先人类 OIDC 登录。

本项目建议：选定真实宿主，比较成功率、人工步骤、权限、异常恢复和成本，再定默认路径。保留 Skill + API 优先候选，MCP 待选；不一概宣称某种路径总是更轻或可靠。

## 3. Hermes 的成长机制

官方仓库使用 **“The agent that grows with you”** 定位，宣传经验生成技能、修订技能与长期记忆。口号不等于独立验证的效果。[官方仓库](https://github.com/NousResearch/hermes-agent)

Skills 文档的 skill_manage 将复杂任务、错误修复和用户纠正整理为可复用方法。Memory 文档说明经验须通过工具持久保存，回答里说“记住了”不等于已落盘。这支持改善方法与记忆的路径，不能推导日常对话自动训练模型参数。[Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills#agent-managed-skills-skill_manage-tool)、[Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory#how-it-works)

Learning Journey 展示记忆和技能积累，可查看、修订或删除；后台复盘有资源开销与配置。能力属于运行 Hermes 的宿主环境，并非任何网站连接后都可获得的通用能力。[Learning Journey](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory#learning-journey-journey)

## 4. 对产品的推论

世界提供方法、反馈、实践机会与结果；外部 Agent 在授权及宿主能力允许时提炼并保存，之后复用。该路径尚未证明社交相对单 Agent 自我复盘有额外收益。

区分纪念品、已保存方法、已复用方法与具有改善证据的方法。下载 Skill、新增好友或增长经验值均不能单独证明能力提高。完整体验见[成长世界](../product/growth-world.md)，具体 M4 由 WS04 规划。

本轮没有安装 Skill、配置 MCP、注册外部服务、修改本地记忆或安排定时任务。
