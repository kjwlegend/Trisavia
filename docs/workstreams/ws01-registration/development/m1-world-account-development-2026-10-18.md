# 世界内账户与管理 · 开发交接

日期：2026-10-18。共同基线：`22e0d82c862a8dce019dc466d26eb5aa5236d66a`。网页首包为 `05fc5d1f4e84baf9b1d3a8896a84d156aab079b4`，首轮候选为 `841947c29445e6b6f3da97b70c82776f279996e9`。首轮独立静态审查有阻塞，网页修订最终源为 `fe5d58f3fc03e5e16db369e29a32312dde669b0a`（含 37ec470 五项修订、efe995c 体验模式与最后模式屏障）。开发完成，测试待安排；须交原 reviewer／设计负责人复核，运行验证因用户要求未执行。

设计唯一依据为[世界内账户合同](../design/world-account-entry-contract.md)与[桌面效果稿](../../../design/world-account-entry-desktop.html)。效果稿是虚构示例，不是产品截图或运行证据。

## 范围与模块

本轮把原账户与管理呈现迁入同一世界壳、单一面板宿主，保留 M1 原鉴权、目标与回执边界，不迁移数据；另按新增授权提供体验／真实邮件两种验证码模式。API 作者首包 `cbf3b9cb5af984b0903d63a643069e17b3a85fc4` 仅使 `/owner` 直接返回 `index.html`，integration 对应 `4458418`；模式增量为 `e085ff9874d650c7cf096380695cd36b25428ced` → `90bc9ec9c54b8a16233b138a07eac25b919eea2c`，涉及 email-onboarding、m1-service、邮件契约／配置加载与 `.env.example`，后者收紧模式切换屏障。公开接入说明首包为 `5ab8292069b1dec73b081c67e00f008b6eb09e50`，integration 对应 `6301848`。

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

首轮[独立静态代码审查](../validation/m1-world-account-static-code-review-2026-10-18.md)提出 1 项 P1、3 项 P2；WAC-R01 与设计 WA-D01 为同一入口问题，设计另有 WA-D02。作者已在 `37ec470c75795213605920247aab1017b73a16a2` 实施下列修订，待与模式增量一并由原负责人复核，不是问题已验证关闭或运行 PASS。

| 首轮问题 | 修订范围 |
| --- | --- |
| WAC-R01／WA-D01：右上账户被历史 resume 状态困住 | 按当前未决任务／未保存输入决定续接；普通已登录入口进入账户与安全，关闭重开不改变该规则 |
| WAC-R02：访客返回进入管理／邀请准备 | 返回导航由控制器判断认证与任务；访客回世界／登录，准备与签发邀请也校验当前主人上下文 |
| WAC-R03：显式目标不可访问却编辑另一 Agent | 目标不可用进入明确错误，不自动回落到旧选择或首项编辑；须由人另行明确选择 |
| WAC-R04：备份恢复仍自动进入管理 | 与邮箱恢复统一成功提示，再用新密码普通登录；保留精确原回执、操作键及新旧证明，不因改变呈现丢失未知结果续接 |
| WA-D02：合法 handoff 未直接展开新注册 | 固定目标后直接进入新账号注册／邮箱验码呈现，保留已有账号登录确认路径；不把打开入口当作已绑定 |

## 验证码模式增量

`M1_EMAIL_MODE` 在启动前显式设为 `experience` 或 `resend`，省略为 resend，异常值使通道 unavailable；`.env.example` 不会自动加载。体验使用四位 `1234`，无 Resend 依赖、不发信，`deliveryStatus:not_sent`；真实邮件保留八位随机码及原四项私有邮件配置。capabilities 的 `emailMode` 与可用性布尔只说明配置，attempt 的 `verificationMode,codeLength` 固定原模式，新 GET 的 `currentMode,modeMismatch` 表示当前屏障，旧回执不能冒充现态。模式不匹配时拒绝新的 send／verify／建号／重设；已提交原操作仍可精确读取／GET receipt 或按原权限取消，保留原证明、payloadHash 与未知进度，不把旧挑战当成新模式授权。

新模式记录的两个 verify 请求须带当前挑战原 `sendOperationId`，按 GET 的 `sendOperationIdRequired` 提交；历史无 mode 的真实记录保原正文／hash／回执续接。用途、目标、代次、操作、期限与计数均由服务端约束。体验新账号 `emailVerified:false`，体验恢复不升级原 false，也不抹去已有真实验证事实；本次来源单独标记 experience。Agent 仍只发起／读取／取消自身协助，不接收人类验证码或主人 session。标准 HTTP 与可选 Node CLI 的 Agent 命令不变。

## 用户任务覆盖交接

下表仅记录源码迁入范围，不能作为可见流程已完成或运行通过的证据；首轮缺口按上表修订并待复核。

| 任务 | 迁入世界内的范围 |
| --- | --- |
| 访客注册／登录 | 首页账户入口，完成原注册用途挑战后才建账号；真实空态，不强制 JSON |
| Agent 私密入口新注册 | 捕获并清除 fragment，固定目标，验码后一次注册并绑定，不增加二次认领 |
| 已有账号关联 | 登录后显示当前账号与目标，由人明确确认；原有 Agent 与恢复材料保留 |
| 第二位 Agent | 真实单次邀请、独立注册凭据、授权列表与显式切换；不把 A 的待确认操作改给 B |
| 找回与账户安全 | 原邮箱恢复、有效独立备份、可选备用恢复启用、当前文件导出与私密进度续接；验证码／主人证明不交 Agent |
| 现有管理 | 资料草稿、发布／撤回、形象、参与各轴、模式／字段锁、运行撤销／替换、邀请与必要记录，不借布局改变权限 |
| 原世界与 M2 | 世界场所与面板互斥；背包／信箱等仍是明确进入的演示，不伪造资产、消息、在线或互动 |

## 待安排

- 原 reviewer／设计负责人复核：首轮 WAC-R01—R04、WA-D01／WA-D02 及修订差异；首轮其余静态覆盖不等于本轮修后运行通过。
- 后续获准运行时：上述用户任务、关闭／返回／焦点、长内容滚动、刷新与未知结果、A/B 隔离及退出清理；本轮不扩写或执行测试套件。
- 两模式挑战、切换后的原操作续接、真实邮件配置／投递／收信及完整闭环均未运行验证；体验码不能充当真实邮箱属权证据，能力布尔或历史 PASS 不替代本轮证据。

本轮未执行测试、typecheck、build、Node 语法检查、浏览器验收、端口探测、应用启动、服务切换、发信、迁移或部署；未改 8789／8799 用户服务和数据。源码开发、独立静态审查与运行验证分别记录，不沿用旧 PASS。
