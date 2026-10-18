# 世界内账户与管理 · 开发交接

日期：2026-10-18。共同基线：`22e0d82c862a8dce019dc466d26eb5aa5236d66a`。网页首包为 `05fc5d1f4e84baf9b1d3a8896a84d156aab079b4`，首轮候选 `841947c29445e6b6f3da97b70c82776f279996e9` 的阻塞已修订。现 main／8789 产品源码为 `7ea0659b7398449e05acd7af7742f91a0e154bd1`；原独审已静态接受 WAC-R01—R05 及本次启动定点修订。设计负责人对 `8acde84` 的未变 UI 接受范围保留。真实浏览器仅完成下述启动／面板切换定点，不等于完整用户验收通过。

设计唯一依据为[世界内账户合同](../design/world-account-entry-contract.md)与[桌面效果稿](../../../design/world-account-entry-desktop.html)。效果稿是虚构示例，不是产品截图或运行证据。

## 范围与模块

本轮把原账户与管理呈现迁入同一世界壳、单一面板宿主，保留 M1 原鉴权、目标与回执边界；另按新增授权提供体验／真实邮件两种验证码模式。API 作者首包 `cbf3b9cb5af984b0903d63a643069e17b3a85fc4` 仅使 `/owner` 直接返回 `index.html`，integration 对应 `4458418`；模式增量为 `e085ff9874d650c7cf096380695cd36b25428ced` → `90bc9ec9c54b8a16233b138a07eac25b919eea2c`，涉及 email-onboarding、m1-service、邮件契约／配置加载与 `.env.example`，后者收紧模式切换屏障。公开接入说明首包为 `5ab8292069b1dec73b081c67e00f008b6eb09e50`，integration 对应 `6301848`。本地交付沿用原用户库与身份，schema 升级事实见下文。

以下网页模块均位于 `apps/web/public/`，按原作者固定交接与源码文件清单记录：

| 模块 | 本轮职责 |
| --- | --- |
| `world-bootstrap.js`、`owner-entry.js` | 导入世界前可靠暂存并清除私密 fragment；独立私密入口队列，不把证明交给普通 HUD 状态 |
| `owner-markup.js` | 唯一账户模板，删除旧 `owner.html`，不挂第二套后台或 iframe |
| `index.html`、`owner.css` | 共用启动入口与账户面板样式 |
| `owner-panel.js`、`hud/shell.js` | 440px 账户呈现、内联确认与唯一 PanelHost；账户／M2／场所面板互斥，关闭只收起 |
| `owner.js` | 单实例、限定账户根的控制器，保留原命令／回执与未决流程 |
| `owner-email-flow.js`、`owner-email-state.js`、`owner-recovery-assistance.js` | 注入账户 root 范围，呈现原尝试模式与挑战／回执，保留独立备份协助 |
| `hud/session-api.js` | 仅真实账号／授权 Agent 安全摘要适配，不复制主人秘密或控制器状态 |
| `home.js`、`hud/scene-renderer.js` | 世界只启动一次，账户表单与场景输入／焦点分离 |

可见入口为 `#hud-account`（访客「登录／注册」、未完「继续上次操作」、已登录真实用户名）、`#hud-agent`（当前 Agent →「我的 Agent」）和 `#hud-agent-entry`（「接入 Agent」）。共用 `#hud-window`、`#hud-title`、`#hud-close`；账户根为 `#account-root`，子页覆盖 agents／profile／appearance／participation／policy／runtime／records／invite／security／entry／success／unavailable。原认证、邮件、恢复与关联表单入口保留；新增恢复密码确认与形象表单只改变呈现，不新增业务权限。

「忘记密码？」下为「通过体验验证码找回」（真实模式为「通过原邮箱找回」）与「使用备用恢复文件」；没有有效私密请求时，验证码路径只说明请原 Agent 发起，不直接重设。有效请求内继续本次受限挑战；体验不被写成已发邮件、已验证真实邮箱或恢复已完成。

`/owner#handoff=…`、`/owner#assistance=…` 和获准目标入口保留；origin、instanceId、Agent 身份与凭据不因换壳改变。普通账号名、Agent 公开名字与内部 ID 分别表达；关闭面板不等于取消、退出或完成。未确认操作先于新入口，原操作号、目标与私有续接材料继续由现有控制器管理。标准 HTTP 是接入主路径，Node 参考客户端可选，本轮无需 CLI 差异。

## 首轮反馈与修订交接

首轮[独立静态代码审查](../validation/m1-world-account-static-code-review-2026-10-18.md)提出 1 项 P1、3 项 P2；WAC-R01 与设计 WA-D01 为同一入口问题，设计另有 WA-D02。首轮修订来源为 `37ec470c75795213605920247aab1017b73a16a2`，体验／模式屏障至 `fe5d58f`，后续 WAC-R05 至 6523d58 收口。原 reviewer 最终对 WAC-R01—R05 无遗留静态阻塞；以下为源码修订与静态接受，未标运行 PASS。

| 首轮问题 | 修订范围 |
| --- | --- |
| WAC-R01／WA-D01：右上账户被历史 resume 状态困住 | 按当前未决任务／未保存输入决定续接；普通已登录入口进入账户与安全，关闭重开不改变该规则 |
| WAC-R02：访客返回进入管理／邀请准备 | 返回导航由控制器判断认证与任务；访客回世界／登录，准备与签发邀请也校验当前主人上下文 |
| WAC-R03：显式目标不可访问却编辑另一 Agent | 目标不可用进入明确错误，不自动回落到旧选择或首项编辑；须由人另行明确选择 |
| WAC-R04：备份恢复仍自动进入管理 | 与邮箱恢复统一成功提示，再用新密码普通登录；保留精确原回执、操作键及新旧证明，不因改变呈现丢失未知结果续接 |
| WA-D02：合法 handoff 未直接展开新注册 | 固定目标后直接进入新账号注册／邮箱验码呈现，保留已有账号登录确认路径；不把打开入口当作已绑定 |
| WAC-R05：首次恢复发码／注册开始回执续接被锁住 | 两种 start 回执接受后自动只读当前 attempt；后续 GET 失败不冒充原回执缺失，不重提原开始命令，保留模式与未知进度屏障 |

## 验证码模式增量

`M1_EMAIL_MODE` 在启动前显式设为 `experience` 或 `resend`，省略为 resend，异常值使通道 unavailable；`.env.example` 不会自动加载。体验使用四位 `1234`，无 Resend 依赖、不发信，`deliveryStatus:not_sent`；真实邮件保留八位随机码及原四项私有邮件配置。capabilities 的 `emailMode` 与可用性布尔只说明配置，attempt 的 `verificationMode,codeLength` 固定原模式，新 GET 的 `currentMode,modeMismatch` 表示当前屏障，旧回执不能冒充现态。模式不匹配时拒绝新的 send／verify／建号／重设；已提交原操作仍可精确读取／GET receipt 或按原权限取消，保留原证明、payloadHash 与未知进度，不把旧挑战当成新模式授权。

新模式记录的两个 verify 请求须带当前挑战原 `sendOperationId`，按 GET 的 `sendOperationIdRequired` 提交；历史无 mode 的真实记录保原正文／hash／回执续接。用途、目标、代次、操作、期限与计数均由服务端约束。体验新账号 `emailVerified:false`，体验恢复不升级原 false，也不抹去已有真实验证事实；本次来源单独标记 experience。Agent 仍只发起／读取／取消自身协助，不接收人类验证码或主人 session。标准 HTTP 与可选 Node CLI 的 Agent 命令不变。

## 用户任务覆盖交接

下表仅记录源码迁入范围；静态接受、服务就绪和启动定点均不能替代完整用户流程验收。

| 任务 | 迁入世界内的范围 |
| --- | --- |
| 访客注册／登录 | 首页账户入口，完成原注册用途挑战后才建账号；真实空态，不强制 JSON |
| Agent 私密入口新注册 | 捕获并清除 fragment，固定目标，验码后一次注册并绑定，不增加二次认领 |
| 已有账号关联 | 登录后显示当前账号与目标，由人明确确认；原有 Agent 与恢复材料保留 |
| 第二位 Agent | 真实单次邀请、独立注册凭据、授权列表与显式切换；不把 A 的待确认操作改给 B |
| 找回与账户安全 | 原邮箱恢复、有效独立备份、可选备用恢复启用、当前文件导出与私密进度续接；验证码／主人证明不交 Agent |
| 现有管理 | 资料草稿、发布／撤回、形象、参与各轴、模式／字段锁、运行撤销／替换、邀请与必要记录，不借布局改变权限 |
| 原世界与 M2 | 世界场所与面板互斥；背包／信箱等仍是明确进入的演示，不伪造资产、消息、在线或互动 |

## 本地交付与待验证

首次 `6523d5841e6220d99f27d53b0954237f57661463` 交付的 [历史证据](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-world-account/user-8789-backup-before-world-account-20261018T101910Z/delivery-evidence.json) 保留：事务应用 migration 3／4，schema 2→4，原 10 个数据表记录数与全行指纹不变、新 3 表为空；当时 17 项 HTTP source readiness 未覆盖实际 DOM 启动。

用户报 fatal 后，统筹 ego space36 复现 `owner-panel.js:15:27` 的 `TypeError: Cannot set properties of null (setting 'open')`：控件先搬入尚未复挂的 sections，再从 root 查询得到 null，后续 agent-select 同类。原作者修订 `e68ead79127f1bf8ef167c59aa1c79477e1f2526` 在 move 前保存两个真实节点引用、搬后使用引用；仅三行，不吞异常或删除管理功能。原独审已静态接受准确产品 7ea0659。

以下按本次 [delivery-evidence.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-world-account/user-8789-backup-before-panel-startup-fix-20261018T103855Z/delivery-evidence.json) 及统筹浏览器回报记录，本作者仅静态读取，不重跑操作。

| 项目 | 已记录的交付事实 |
| --- | --- |
| 固定源码与服务 | 快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-world-account/user-delivery-7ea0659` 精确对应 7ea0659。旧 PID 12917 正常 SIGTERM；新 PID 23004 仅监听 `127.0.0.1:8789`，Node 24 直接启动；显式 `M1_EMAIL_MODE=experience`，未继承 Resend 私有配置 |
| 只读就绪核对 | 共 6 项必要只读 HTTP：health／capabilities 核对状态与模式，`emailMode:experience`、两项 ownerEmail 能力为 true；`/`、`/owner`、owner-panel.js、world-bootstrap.js 核对固定源码字节一致 |
| 统筹浏览器定点 | ego space36/p1 已 finish：刷新 `/#account` 渲染世界地图、Dock 与登录面板；关闭重开、点击注册显示 1234、直接 `/owner` 归一至 `/#account` 登录均通过；`startupError:false`、canvas／账户面板各 1。[实际截图](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-world-account/startup-fix-7ea0659.png) 保留本次实看范围 |
| 用户身份与数据 | 沿用 `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite` 与配对 identity，实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f` 不变。本次无新迁移、schema 4，全部 14 表记录数与全行指纹不变 |
| 一致备份 | 上述证据同目录保留 `live-consistent.sqlite`、`stopped-consistent.sqlite` 与配对 identity；SQLite backup API 纳入 WAL，两份 quick_check 为 ok，目录／文件权限 0700／0600 |

旧 fd2 快照保留，但旧程序不能直接打开 schema 3／4；不能沿用「指回 fd2」回退，也不能用旧备份覆盖后续写入。需保全当前数据后另行制定前向修复／回退方案。

除上述启动／面板切换外，注册、登录、私密续接、A/B 隔离、退出清理、两模式挑战及完整业务仍待运行验收。统筹未填写／提交账号、登录或发码，未清存储、未发真实邮件；真实投递／收信未验证，体验码不证明真实邮箱属权。未运行自动化测试、typecheck、build 或语法检查，其他端口与公网未操作。本次文档收口没有新增浏览器、应用或数据库操作，历史 PASS 不替代本轮证据。
