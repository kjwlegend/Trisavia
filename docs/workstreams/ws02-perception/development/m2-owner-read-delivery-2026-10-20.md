# WS02 主人只读与真实 HUD 本地交付

2026-10-20。技术总监：整体架构与演进规划，稳定会话 `01a138f6-2c0e-75a1-87fe-ee0735493f4f`。

本批已整合并交付 [本地 8789](http://127.0.0.1:8789/)：默认背包／信箱读取平台数据，公开物品、公告和事件可从既有 HUD 进入。原独立 reviewer 接受固定 `a46d81d → adae355`，OWN-CR01—03 关闭；独立普通用户 UI 新版复验由总指挥另派，本交付不将旧 d125 观察或作者测试改记为该复验通过。

## 1. 固定版本与职责

| 项目 | 实际事实 |
| --- | --- |
| 基线 | `a46d81df85cd1b1a55775fe54281124f8bfbe34e` |
| API 作者 | `owner_read_api`，`gpt-6.1-sol`／`xhigh`，独占 m1-api；提交 `d5b03405aec8b67d501410d9de887b6aa7237700` |
| web 作者 | `owner_read_web`，`gpt-6.1-sol`／`xhigh`，独占 m1-web；最终提交 `8e9e463354d3154d0fbc881029d3b13c0a9830c9` |
| 最终生产组合 | `d6118adaa9b3972a89881a5cb9ac8273d9d68c1b` |
| acceptance 作者 | 原 m1_acceptance，`gpt-6.1-sol`／`xhigh`，独占 m1-acceptance；仅三文件测试提交 `adae355cd2922883b46b27659aa7da09b34882e8` |
| 运行源码／整合提交 | `adae355cd2922883b46b27659aa7da09b34882e8`；相对 d611 仅上述测试。后续本交付与独审报告的纯文档归档不改变运行代码 |
| 独立代码审查 | 原「M1 后端独立代码审查」`01a13916-02fe-7e90-8881-972aba227d8d`；[完整报告](../validation/m2-owner-read-code-review-2026-10-20.md)保留初审、修订与最终测试增量的各轮事实 |
| integration | `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration`，`codex/ws02-owner-observer-integration`，技术总监独占 |

本批代码／测试共 20 路径。main 在切换前已 fast-forward 至 adae355；原工作区 706 个非忽略脏路径及 index 单独备份，无脏目标路径。保护快照至整合后核对间，`.obsidian/workspace.json` 与原 reviewer 自有报告发生并发更新，前后副本均保留、未回退；原 staged patch 不变。证据为 integration `outputs/ws02-owner-read/main-protection-20261020T041756Z/`。

## 2. 交付行为与权限

| 原独立 UI 发现 | 本批实现与作者证据 | 新版独立普通 UI 状态 |
| --- | --- | --- |
| OWN-UI-01 背包未接真实数据 | 默认读当前所选 Agent 的有效持有；示例须主动进入，并常显示例标识 | 待总指挥另派必要复验 |
| OWN-UI-02 物品详情不能核对持有／来源 | 展示关系数量、状态及来源；获准物品引用的正文另行授权读取 | 同上 |
| OWN-UI-03 通知未接真实数据 | 仅主人有当前有效绑定且来源允许观察的通知，经真实 list／detail 分页和分段读取 | 同上 |
| OWN-UI-04 公开事件不可达 | 世界动态分公告／事件，告示牌有对应入口；区分演示、计划、发生与平台发布 | 同上 |

owner 私有 list／detail 需所选 `profiles.agent@1` 的 `agentRef`，逐次检查当前有效绑定、来源和层级权限；world 不接受跨主体参数。通知的存在、计数、摘要、正文、附件分别授权。owner 私有 overview 仍为本切片未开放，未实现 reader-state 写入；不返回 Agent 阅读状态或确认令牌，真实 UI 无人类已读／隐藏／撤销或 Agent 确认操作。

真实面无权、未启用、不可用、空、部分或网络错误均有明确状态，不静默回退 fixture。旧界面示例保持独立本地存储与显式往返。世界 HUD 仍关闭内容窗回持续动态、可交互画布；动画与场景移动不代表 Agent 真实行为。

## 3. 检查与修订证据

- API 作者 typecheck、WS02 28/28、diff-check 通过；web 作者合成检查与 JS 语法分别记作者检查，不替代独审。
- 原 reviewer 对初始 4f788aa 提出 OWN-CR01—03：私有拒绝后缓存残留、版本变化后的详情恢复、过期续页恢复。acceptance 在真实浏览器复现原候选对应三条 0/3，失败日志保留。
- B 最终修订将版本／页失效转换为明确重载新集合，丢弃旧版本／token；私有拒绝清空持有与通知并阻止旧响应回填。原 reviewer 复核关闭三项。
- acceptance 最终在生产 d6118ad 上执行与后续 adae355 完全相同的测试字节：7 条真实浏览器故事＋3 个生产 provider 检查，10/10、fail 0、skip 0；typecheck、diff-check 通过。浏览器使用 1440×900／1280×800 的必要定点，不是桌面全矩阵或手机验收。
- 四类隔离库独有标题与通知独有长正文，由受审管理 helper 写入该库，经 UI 自身真实 HTTP 读取并显示；成功路径未用合成 200 响应替换。浏览器没有调用 Agent 确认，前后该 fixture 的 perception_states 全表相同；该浏览器 fixture 未先建立“27”场景，不将其写成浏览器确认了原小序 27。
- TD 对纯 Git 归档 adae355 另做 typecheck、83 项相关 WS02／site／CLI 检查、9 个变更 JS 语法及 diff-check，全部通过、无 skip。83 项包含三个 provider 检查，不与上项重复相加。归档在原库只读副本上 ready／close 成功，无监听或账户请求。

精确作者命令、文件与日志 hash、失败历史、清理范围：[verification.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-owner-read/candidate-d6118ad/verification.json)。TD 归档检查：[archive-validation-adae355.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/archive-validation-adae355.json)。自有隔离端口／app／browser 已 finally 关闭。

## 4. 原库保全、来源声明与实际切换

旧运行 `d12553a0d962751e8551926341441917b5ced7e7`／PID 16555，经真实 cwd／监听核对后正常 SIGTERM，无强杀。已在切换前向总指挥通知旧新版本。新运行如下：

| 项目 | 实际值 |
| --- | --- |
| URL／PID | `http://127.0.0.1:8789/`／`9859` |
| 固定快照 | `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/user-delivery-adae355` |
| 原 DB | `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite` |
| 配对 identity | `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite.identity.json` |
| 实例 | `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f` |
| DB／模式 | schema5／20 表；`M1_EMAIL_MODE=experience`（1234），真实时钟 |
| 新目录 | `catalog-r03-20261020-e29b7a68-schema-3`，`skills-catalog-r03-20261020-e29b7a68-schema-3`，schema3／guide3，APIv1／protocol1 |

fresh 备份目录为 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/user-8789-backup-before-owner-read-20261020T042133Z`。含 live、stopped、after-helper、after-start 四份一致 SQLite 与各自配对 identity、完整性及逐表 hash 证据；原备份与旧快照保留。

停机备份之后，仅运行已审 `scripts/ws02-owner-observation.ts`：显式 operator `td-ws02-owner-read-release`，原 source administrator `td-ws02-release-administrator`，operation ID `ws02-owner-read-release-20261020T042133Z`。精确核对现有注册来源 `connet-hud-examples@2` 的 31 个通知 ref，来源声明从无到 v1；回执为同目录 `owner-observation-manifest.private.json`。没有运行 seed、改写任何原 object／grant／state 或复活撤销关系；不是凭 dataMode=demo 授权，其他真实私信仍默认关闭。幂等重放已在副本试演验证，生产只执行一次。

stopped → after-start 核对结果：仅 perception_catalog 与 perception_access 变化；其他 18 表（含 Agent、绑定、凭据、正文对象、grant、确认状态、schema_migrations）逐表精确 hash 相同，identity 和实例相同。56 个旧 catalog 行除 current 外全部原样，旧版本文档／digest 保全。R03 的 m09 v2 与原 Agent 确认记录由上述原表保全覆盖；未进行新的主人认证读取或 Agent 确认。数据库没有新增迁移或表。

实际 HTTP 已核对 health／原实例，以及首页、`/owner`（统一 index 壳）与 10 个变更资源共 12 个公开响应的精确归档字节和 no-store。TD 无生产浏览器动作或认证请求。[保全结果](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/user-8789-backup-before-owner-read-20261020T042133Z/preservation-result.json)、[HTTP 核对](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/user-8789-backup-before-owner-read-20261020T042133Z/http-verification.json)、[运行回执](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-owner-read/delivery-state.json)。

辅助核对曾因 lsof 的 FD 行、以及将统一 `/owner` 误写成独立 owner.html 路径而中止；均为核对脚本问题，修正后完成上述实际核对。首次简报把 live 备份完成时间写早一步，已即时向总指挥校正；实际停机和来源声明均在成功 fresh 备份之后。

## 5. 后续边界与恢复

本批不是完整 WS02、全量回归、手机、真实经济或 Agent 行动验收；普通独立 UI 的新版必要复验与作者定点分开记载。无定时／后台触发，无公网发布／push，其他服务未动，无清缓存／存储／库或 reset。

后续切换仍先 fresh 一致备份。当前原库保持 schema5 且目录已为 schema3；恢复须使用兼容 schema5／schema3 的源码及当时当前原库／identity，保全后续用户写入。不得直接切回只支持 schema2 的 d125 源码，也不得回灌本次或历史旧库。
