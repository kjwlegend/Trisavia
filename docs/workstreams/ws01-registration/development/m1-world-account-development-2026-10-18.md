# 世界内账户与管理 · 开发交接

日期：2026-10-18。共同基线：`22e0d82c862a8dce019dc466d26eb5aa5236d66a`。网页首包为 `05fc5d1f4e84baf9b1d3a8896a84d156aab079b4`，首轮候选 `841947c29445e6b6f3da97b70c82776f279996e9` 的阻塞已修订。此前世界账户壳启动修复源码为 `7ea0659b7398449e05acd7af7742f91a0e154bd1`；原独审已静态接受 WAC-R01—R05 及该启动定点修订。设计负责人对 `8acde84` 的未变 UI 接受范围保留。该阶段真实浏览器只覆盖启动／面板切换；当前自有 Agent 增量与交付见末节，不等于完整用户验收通过。

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

## 世界账户壳交付历史（6523／7ea）

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

截至 7ea 交付，除上述启动／面板切换外，注册、登录、私密续接、A/B 隔离、退出清理、两模式挑战及完整业务仍待运行验收。该阶段统筹未填写／提交账号、登录或发码，未清存储、未发真实邮件，也未运行自动化测试、typecheck、build 或语法检查；其他端口与公网未操作。体验码不证明真实邮箱属权，历史 PASS 不替代后续证据。

## 自有 Agent 地图增量交付 · dde598b

本次仅实现当前已鉴权主人自有 Agent 的私人静态角色层：姓名、基础形象、唯一当前标识、列表／地图选择及保持缩放的定位；未发布对象明确仅自己可见。原管理的授权、脏表单与未决任务保护保留，不增加公开目录、在线状态或真实 M2。

修订包括：OAM-R01 定位不再被全视口 clamp 抵消；OAM-R02 当前管理回执 401 清除失效角色／高亮而保留原 pending、正文及证明，旧会话迟回和其他用途证明不误清新主人；OA-D01 当前／焦点姓名牌在面板拥挤时避让，保留原可操作节点。[原独审](../validation/m1-owned-agents-static-code-review-2026-10-18.md)已接受完整 `dde598bd41feeb6a866d38d5b8c365b6d3564abb`，无本功能静态阻塞。技术总监在固定源码执行两份纯 Node 定点文件 **10/10**（投影／binding 7 项、生产回执函数 3 项），不挂载完整 controller／DOM，也未跑广泛回归。

[原普通用户模拟报告](../validation/user-simulation/m1-owned-agents-desktop-round-01.md)保留 R1 在 e460 的五项子旅程及当时 OA-D01 open；R2 在 dde 指定姓名牌／键盘焦点、150% 定位与退出烟测 PASS，OA-D01 fixed/verified，没有把 B／Empty 和整轮刷新改记为新版重跑。原设计负责人已接受本功能实际 1440×900 截图，范围与普通模拟、静态审查分别保留。

本次实际交付按 [delivery-evidence.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-8789-backup-before-owned-agents-20261018T114432Z/delivery-evidence.json) 记录：

| 项目 | 交付事实与边界 |
| --- | --- |
| main／8789 | 6 提交、13 文件快进至准确 dde598；快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-delivery-dde598b`。旧 PID 23004 正常 SIGTERM，新 PID 49675 仅 8789；沿用原 origin、显式 experience 环境及真实系统时钟，不含预览库／身份／冻结 clock，不继承 Resend key |
| 数据／备份 | 原用户库、配对 identity 与实例沿用；schema 4、全部 14 表记录数／全行指纹不变，无新迁移。上述新备份目录保留 live-consistent／stopped-consistent SQLite 与 identity，两库 quick_check 为 ok，目录／文件 0700／0600 |
| 只读就绪／实际确认 | 共 9 项 HTTP：health／capabilities 核对状态与模式；两个入口及五个本功能脚本／样式与固定源码字节一致，并核对其 no-store／nosniff。总指挥另实际确认 owned-agents.js 200 且与 dde Git 对象逐字节一致；8789 `/#account` 世界／账户面板正常，startupError=false、canvas=1、accountPanel=1，访客说明正确，未操作真实账户或清 storage。[实际截图](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-8789-backup-before-owned-agents-20261018T114432Z/commander-8789-world-account-confirmation.png) |

可回退至 backend／schema 4 相同的原 7ea 快照，继续使用当前原库和 identity，不回灌旧备份；更旧 fd2 仍不兼容，不能覆盖近期写入。以上合成 QA 不等于完整 M1、真实认证失效浏览器、真实邮件、手机或其他尺寸验收。交付未操作真实用户账号、其他服务或公网；本作者仅静态整理既有回报，没有重跑测试、浏览器、服务或数据库操作。

技术总监已核对固定 dde QA 18892 的 PID 44155／工作目录后正常 SIGTERM，确认无子进程或监听；fixture、证据、旧快照及 worktree 保留，其余服务未动。运行源码 dde、8789 PID 49675 不变。

## 自有 Agent 漫游与底部 HUD 交付 · 514ca56

本次合并交付合法路网漫游／短停、默认无地图文字牌、hover／focus 仅姓名且 focus 优先、随动脚环与保持缩放的实时定位；复用单 RAF、暂停／减少动态及后台 delta 限制，同 ID 刷新保进度。底中横栏为 240×72，原 320／440／520 宽面板在安全区居中，180ms 进入／140ms 退场、reduced 即时终态；场所开关不改镜头。原认证、选择、未决任务与回执边界不变，动画不代表在线或真实 Agent 行为。

固定产品为 `514ca56a950fdd2ee7c12f2d59813db499e537f6`，基线 `ee9745bcc87207b99377e6370972d5f2f451f4c6`。原 web 来源 `4c88e6b` → `2e44c29` → `b1bb9cd` → `5f271d8`；测试来源 `c7c789f`、`3e6229b`、`fad65e7`。[原独审](../validation/m1-owned-agents-static-code-review-2026-10-18.md)最终接受准确 514ca56。OAM-R03 已修正镜头变化后以真实 client 指针位置重新命中，鼠标 hover 与键盘 focus 独立；设计接受默认无文字／移动光圈及三张新 HUD 布局画面，保留各自实看范围。

技术总监分别在 2f4b4f3 执行运动／binding 单文件 **10/10**，fb7fe61 执行过渡驱动 **2/2**，514ca56 增强延迟 ready 后执行同文件 **3/3**；没有把三批拼作同版全量结果。模型测试不证明真实 DOM、焦点、几何或动画帧；未重跑未变回执、全量回归、typecheck 或 build。

[原模拟报告](../validation/user-simulation/m1-owned-agents-desktop-round-01.md)分版保留：R3／2f4b 实际 8.147 秒双角色移动、hover／键盘姓名、切换、暂停恢复、147% 定位保比例及退出；普通滚轮、精确 150% 未测。R4／fb7 底栏、居中、输入焦点和定位范围完成，但退出持续 opacity／scale 1／1 后直接隐藏，失败不抹写。作者 TaskSpace44 另确认 native pending、startTime=null、currentTime=0 时墙钟兜底已取消首帧；5f271d8 改为原生 ready 后才挂同代 duration＋80 兜底，不延长动效，不声称修复浏览器调度。

R5／514ca56 的 TaskSpace45 已 finish，始终访客、无账户写入：先 pending 约 1 秒，随后原生 140ms 内实得 opacity .946→.761→.494→.076、scale .998→.973 再 hidden，退出问题在该范围 fixed/verified；不能称总等待仅 140ms 或已消除启动延迟。pending 期关后重开未被旧回调隐藏，输入可编辑／清空，Escape 回登录入口；实际点击间隔 1003ms，未覆盖原生已运行时亚 140ms 快速点击，也未在新版重跑 R3／R4 整轮。

本次交付按 [delivery-evidence.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-8789-backup-before-wandering-centered-hud-20261018T154044Z/delivery-evidence.json) 记录：

| 项目 | 交付事实与边界 |
| --- | --- |
| main／源码／8789 | 7 提交、14 文件快进至准确 514ca56；702 项他人改动字节保持。快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-delivery-514ca56` 的 129 文件逐项 Git／hash 核对。旧 PID 49675 正常 SIGTERM，新 PID 23948 仅 8789 |
| 全新一致备份 | 上述证据同目录含 live-consistent.sqlite、stopped-consistent.sqlite 与配对 identity，目录／文件 0700／0600，两库 quick_check 为 ok；使用最终切换时的当前用户数据，不复用旧备份 |
| 身份／数据／环境 | 原 `data/m1-account-v2.sqlite`、identity、实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f` 保持；schema 4、全部 14 表行数／全行指纹不变，无新迁移或回灌。沿原 origin、显式 experience／1234 与真实系统时钟，不带 QA 库、identity、冻结 clock 或 Resend key |
| 只读就绪／最终确认 | 15 项必要 HTTP：health／capabilities 核对状态与模式，两个入口与本轮 11 个 JS／CSS 核对固定源码字节及 no-store／nosniff。总指挥另实际确认 11 个 `/assets` 均 200、哈希逐项与 514ca56 一致；TaskSpace43 访客 `#account` 的 1440×900 画面正常呈现底栏／居中登录窗，未见 bootstrap 失败，无登录写入。[最终访客截图](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-owned-agents/user-8789-backup-before-wandering-centered-hud-20261018T154044Z/commander-8789-final-hud-confirmation.png) |
| QA 收尾 | 18892 此前保留待上述确认；技术总监核对 PID 17820、固定 source-514ca56 工作目录及无子进程后，仅对该 PID 正常 SIGTERM，确认 18892 无监听。全部 fixture、快照、报告、备份与 worktree 保留，8789／其他服务未动；运行源码仍 514ca56、PID 23948 |

可回退至同 backend／schema 4 的原 dde598 用户快照，继续使用当前数据库及 identity，不能还原旧备份覆盖后来写入。交付未操作真实账号、真实邮件、公网或其他端口。当前不含新提出的注册／保存即公开、参与状态与访问频率业务／API 变化，全面 Agent 管理新版及原型仍是设计产物。以上不等于完整 M1、真实邮件、手机、其他尺寸或性能验收；本作者仅静态整理，没有重跑验证或操作服务／账号／数据库。

## 新版 Agent 管理交付 · 9d99501（2026-10-19）

本轮基线 `fd4bf0d25623bcd281d893ad941b91e5cfbf89ee`，首轮候选 `06029799a405e8cf6531e12cd728591f464c842a`；来源为设计 `6a68791`、API `4be9e6f`、CLI `9899f01`、网页 `ce1e8d7`，网页后续修订至 `6b0c968`。实现 880px 管理窗与 176px 导航，仍复用原账户宿主／控制器。新注册原子生成默认公开资料及 joined 成员状态；主人与获直接权限的 runtime 保存资料／形象即生效，独立提议仍须主人明确采用，模式／锁／暂停／跨对象与版本边界不放宽。世界访问安排初始未设置，主人保存正整秒或清回 null，自身 runtime 只读；只是私有偏好，不启动实际调度。

实际管理宿主为 `#manage-view.owner-manager`；资料／形象使用 canonical `saveProfile`，世界访问使用独立版本的 `saveWorldAccess`，提议另列确认，历史 left／not_joined 异常保留明确恢复路径。下载版可选 CLI 为 pristine 注册默认保存一次完整初始意图；已有主人改动不覆盖，未知结果沿原操作键／正文续接。

作者验证分别保留基准，不合写同版 9/9 或整轮回归：`ad2ee96` 在 API `4be9e6f`＋fixture `ff62b69` 执行 `node --test tests/integration/agent-manager.test.ts`，**8/8**；覆盖默认公开／幂等、直接保存与提议隔离、权限／锁／暂停／CAS／精确回执、私有访问安排与 SQLite 重开、历史恢复分支。首次 7/8 是旧 avatar 验证错误码期待不符，修为实际 422 后通过，未改产品。`77fd11e` 在上述 API＋CLI `9899f01` 仅按唯一 name-pattern 执行 CLI 组合故事，**1/1**；覆盖 HTTP 下载、显式初始资料公开、已提交丢响应及服务重启、主人先改／版本竞争保护。两次均用 Node 24.16.0 与隔离合成数据；未跑旧套件、全量回归、typecheck、build 或浏览器。

技术总监另在真实用户一致备份的独立副本，以新版 backend 及旧 514 快照分别 ready／close，无监听或账户请求；schema 4、14 表全行指纹与配对 identity 保持，见 [副本兼容证据](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-agent-manager/qa-20261019T033745Z/compatibility-preflight/evidence.json)。本轮无新迁移，旧行读取未设置偏好不回填；该副本检查只证明启动兼容，不替代频率运行验证。

首轮隔离 QA 为固定 `source-0602979`、18892／PID 80214；全新 `fixture-0602979/fixture.private.json` 提供 A 两位可写 direct Agent、B 一位历史 left 受限对象及 Empty 空账号。实例 `instance_49b2a8c3-9f3b-4e50-82b9-42b573c2157e`，真实时钟／experience，无 Resend；当时 101 项源码与 Git 字节、14 项只读 HTTP ready 已由技术总监核对。私密 fixture 仅供获授权隔离验收，不是用户身份。首轮完整独审因 AM-R01 布局、AM-R02 权限未知续接、AM-R03 提议采用丢脏输入而阻断；原模拟布局失败与有限可见保存事实保留，不由后续作者测试改记整轮通过。

新增作者测试 `3f5f59b` 在网页 `6b0c968`＋上述 API 基准执行 `node --test tests/e2e/agent-manager-regressions.node.ts`，真实 Chromium／独立随机 loopback／每例新临时库与 context **6/6**：权限与暂停两动作各含未达／已提交丢响应、刷新、可见下载退出／重登／导入，原键正文续交或精确回执恢复且不替换新 session；另验脏政策与采用提议、输入后不先 Tab 的原生鼠标保存。过程中实际发现内联确认摘下保存节点导致 controls TypeError，原作者 `6b0c968` 保留节点修复；`02bd280` 修复输入 change 重挂 footer 造成鼠标保存丢动作。失败日志保留，不把测试入口期待修正或原失败抹成产品通过。临时服务／浏览器均已清理，未操作正式 QA 或用户账号；六例不等于完整布局／业务验收。

准确组合 `1471b8132496f275df31dfa2f4afb1dc57277b4b` 的生产文件与上述测试固定源完全一致，**6/6 仅为等价源码执行证据，未在该组合重跑**；隔离 QA 18892／PID 92640 使用固定 `source-1471b81`，沿同一合成库／identity／实例。后续设计／公开接入说明收口后，[原独审](../validation/m1-agent-manager-static-code-review-2026-10-19.md)最终接受准确 `d293955`；原报告逐字归档为纯文档后继 `9d9950174d744f4d4c57dffd9297620b9ae4c675`，未改变已审生产／测试或递归重审。

已归档的[原普通模拟报告](../validation/user-simulation/m1-agent-manager-desktop-round-01.md)分版保留 R1／R2 失败及 R3：A 的单次鼠标保存、真实公开刷新、形象／7 分钟期望间隔重开刷新、脏输入切页／切 Agent 保护通过，AM-D02／03 fixed/verified；B 从正常可见入口恢复历史退出状态，并以同一 Agent ID 核对实际公开资料。A／B 均退出，TaskSpace51 finish、三页全关。一次返回公开标签后首次形象导航只重读、再次可达的非阻断观察保留；R2 的 1024px／正文滚动不改写为 R3 重测。以上仅为合成 QA 的指定桌面任务，不扩写为完整 M1、手机、所有异常路径或真实邮件验收。

原设计最终对象 `5a60b4d` 的两笔差异已整合为 `c45a59c`／`44c450d`，主目录效果稿／合同与该对象一致；原 WS01 四份公开接入补丁已逐字整合为 `436c3a0`，并获原独审接受。本次实际交付按 [user-8789-delivery.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-agent-manager/user-8789-delivery.json) 记录：

| 项目 | 最终交付事实与边界 |
| --- | --- |
| main／运行源码 | main 快进到准确 9d99501，704 项既有文件逐项 hash 不变、stage 空。快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-agent-manager/user-delivery-9d99501`；旧 PID 23948 正常 SIGTERM、无子进程，新 PID 4670 在 [本地 8789](http://127.0.0.1:8789/) 运行。本交接是文档后继，不另换运行快照 |
| 数据与环境 | 沿用原 `data/m1-account-v2.sqlite`、配对 identity、实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`；schema 4／14 表保持，无新迁移、业务 SQL 或旧库回灌。live、stopped 与 after-start 的全表行指纹及 identity 一致；沿原七键显式环境、experience／1234 与真实系统时钟 |
| 当前一致备份 | 新目录 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-agent-manager/user-8789-backup-before-agent-manager-20261019T045121Z`。有效文件为 `live-consistent.sqlite`、`stopped-consistent-rw.sqlite`、`after-start-consistent-rw.sqlite`，live／stopped 有配对 identity。readonly WAL 连接失败产物原样保留，其中 `stopped-consistent.sqlite` 不完整、不可用于恢复；正常 local 连接的 SQLite backup 重试解决 |
| 只读就绪 | 19 项 HTTP 全 200：health／capabilities 核对状态及能力，根／owner、10 个 JS／CSS、4 份公开 MD 与下载 CLI 核对固定资源字节及 no-store／nosniff。总指挥另确认原实例 health 为 ok，10 个 JS／CSS 加首页与 `/owner` 共 12 资源 200／no-store、SHA256 精确匹配 9d99501 Git 对象；TaskSpace52 仅访客实看 1200×959 首页及 `/owner`，回 `/#account` 为同世界壳 440px 登录窗、owner-manager.css 已加载且无启动失败，未登录或提交业务，已 finish／p1 关闭无留页。[实际截图](/Users/kjw/Workspace/Codes/agents-era/outputs/user-simulation/agent-manager-20261019/root-delivery-8789-owner-9d99501.png) |
| QA 收尾 | 核对 18892／PID 92640 的固定 source1471 工作目录、listener 与无子进程后正常 SIGTERM，已确认无监听；同一合成库／identity、fixture、快照、日志／截图／证据及 worktree 全保留，无删除／重置，其他端口未动。见 [清理证据](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-agent-manager/qa-20261019T033745Z/qa-cleanup-after-R3.json) |

回退遵循已验证的旧 514 兼容源码继续使用 **当前** 数据库与 identity，不把本次或更旧备份回灌覆盖后续写入。作者三组定点、独立静态审查、普通模拟与服务就绪各保留自身范围；没有追加全量／移动／真实邮件验收，也不声称期望间隔已由工具采用或实际调度。本作者最后仅静态整理既有交付回执，没有重新运行测试、浏览器、服务或数据库操作。

## 接入提示与自然交付 · d836a4a（2026-10-19）

- 范围：父 main `3ef62aa` → `d836a4af6ab4376c1050fabddbdc410fd8f4f941`，9 文件、173+/192-；原 web `5103c2d`／整合 `aba1132` 与原 WS01 四稿 `e4e71fb` 共用同源 prompt 唯一短块、动态 origin。API／CLI／测试／依赖未改；原独审接受 d836，作者仅做 4 JS nodecheck／diffcheck，未跑用例。
- [独立模拟](../validation/user-simulation/m1-round-01.md#2026-10-19-接入指引可读性增量--d836a4a)：TaskSpace53 访客 HUD 入口及旧合成 A 登录后自动续接的同入口，两次正常点击＋原生粘贴均得 129 字符，与页面逐字一致，第二次先用一个公开字符排除剪贴板残留；四项指引清楚。A logout、53 finish、两页全关；未另测登录世界收起后重开按钮，未注册、未验证模型实际回复、未跑矩阵。
- 交付：mainAtSwitch／runtime 准确 d836，旧 PID 4670 正常 SIGTERM 后新 PID 39183 运行于 [8789](http://127.0.0.1:8789/)；固定快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-onboarding-copy/user-delivery-d836a4a`，705 项既有 filehash 保持、stage 空。本交接仅文档后继，不另建运行快照。
- 保数：原 DB／identity／实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`、schema4／14 表与停机→新启动全行指纹保持，原七键环境 experience／1234、真实时钟，无旧库回灌。fresh 备份 `user-8789-backup-before-onboarding-copy-20261019T075505Z` 的 live／stopped／after-start 三份 consistent.sqlite 均有效，live／stopped identity 配对，详见[交付实据](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-onboarding-copy/user-8789-delivery.json)。
- 就绪：97 个 runtime 文件及 12 项只读 HTTP／改动资源字节、no-store／nosniff 已由技术总监核对；用户库无注册或账号提交。总指挥已只读确认 actual8789 的 9 资源与 d836 一致及原实例健康，无真实注册；本作者未重跑验证。
- QA：核对 18892／PID35825 的 d836 工作目录及无子进程后正常 SIGTERM、确认无监听；合成副本、原 R3 库／identity、fixture、快照和证据全保留，见[清理回执](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-onboarding-copy/qa-20261019T074050Z/cleanup-evidence.json)。回退用原 9d 源码继续 **CURRENT DB／identity**，不回灌旧备份。

## WS02 HUD 作者定点验证 · 3de1234（2026-10-19）

本轮桌面增量为演示背包网格、信箱附加详情与本人本地读／隐藏／撤销状态；按实例、主人／访客、Agent 和来源隔离并持久化。世界按钮关闭内容回持续动态画布，不新增静态世界面板或真实 M2 后端。以下仅为测试作者证据，不代替独立代码审查、设计或普通用户验收；本地交付另记于下。

- 纯状态基准：测试 `9c06222651c9d41bcb7579312ad06d3d39dc0f6b` 在生产 `373ee447b68c800a3595b0f9f96fe2235f1084aa` 上执行 `node --test tests/site/hud-local-state.test.ts`，**7/7**；覆盖持久化、真实撤销截止、正文／列表位置、上下文与旧 lease、访客及坏存储退路。[原证据](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-hud/local-state-373ee44.tap) 不是最终 UI 组合重跑。
- 最终四故事：生产 public 精确 `3de1234430fd60e76fa74e40ccdee237663b4b0f`＋测试 `b1611651a4c23a0b73323abee4bb2d0dd457a769`，Node 24.16.0／既定 Chromium 1243 执行 `node --test --test-reporter=tap tests/e2e/ws02-hud.node.ts`，同次 **4/4**、19.341 秒，无 skip；1440×900／1280×800 覆盖背包独立滚动、信箱读／撤销与刷新、访客／A／两 Agent／B 隔离、M1 脏资料／未知原键续接、动态画布／工具／暂停／reduced／可见遮挡。[最终输出](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-hud/browser-3de1234-four-stories-final.tap)；该组合 `tsc --noEmit` exit 0，未合并旧批次局部结果充当四例通过。
- 问题范围：保留原几何失败及测试驱动／通知夹具纠正记录；M2-CR01 未读补行／空态与末项返回、M2-CR02 末 100ms 滚动刷新／旧 scope 隔离已在四例覆盖。末项 1629→临时合法 clamp 1564→未读／关闭恢复 1629；WS07-VR02 用可见鼠标与真实滚轮得到说明页 737→617→世界 0，再开背包标题／关闭可达，镜头、缩放、当前 Agent 与暂停保持；没有测试 scrollTo／reset 掩盖缺陷。

每例独占随机 loopback、全新合成库／identity／浏览器 context，结束正常关闭并清理自身临时材料；未操作共享 QA、真实用户服务或账号。未重跑旧 spec、全量、手机、真实邮件、真实 M2／调度或模型回复验收；旧受影响 spec 仅保留意图地适配，不能按本次四例宣称全部通过。

### 本地交付 · 3664297

[原代码独审](../../ws02-perception/validation/m2-hud-static-code-review-2026-10-19.md)已接受 cdd2c30／0028b26；WS07 与[独立模拟](../../ws02-perception/validation/user-simulation/m2-hud-desktop-round-01.md)在 6948788 完成最终必要定点，保留各版实际范围、4px 非阻断与未测组合，不合称新版全量验收。三份最终报告及 15 份规划原件已精确整合。

- main／运行源码为 `36642976757c97863e8e59b9a97b71515ca6fe62`；旧 PID39183 正常停止，新 PID7137 运行于 [8789](http://127.0.0.1:8789/)，固定快照 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-hud/user-delivery-3664297`。合入 44 路径，原有其他 685 项状态、837 个非本轮路径及其索引保持；本交接是文档后继，不另换运行源码。
- 原 DB／identity／实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`、schema4／14 表保持，stopped→after-start 全行指纹相同，无迁移或旧库回灌；原七键显式环境 experience／1234 与真实时钟沿用。全新备份目录 `outputs/ws02-hud/user-8789-backup-before-ws02-hud-20261019T102528Z`（integration 下）保留三份 integrity ok 的 live／stopped／after-start consistent.sqlite 及 live／stopped 配对 identity，详见 [switch-evidence.json](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-hud/user-8789-backup-before-ws02-hud-20261019T102528Z/switch-evidence.json)。回退仍用兼容源码继续 **当前 DB／identity**，不覆盖后来写入。
- 技术总监核对 19 项 HTTP：health、两个入口及 16 个变更资源；16 资源与固定源码字节一致、no-store。合 main 后 typecheck、状态单文件 **7/7**、14 个变更 JS 语法与 diffcheck 通过，见 [postmerge 检查](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-hud/postmerge-3664297-checks.txt)；未重跑四故事，沿精确生产 3de1234＋测试 b161165 的等价执行证据，不把只读就绪写成新浏览器验收。
- 技术总监核对 QA PID1627 的固定 source-6948788 工作目录及无子进程后正常 SIGTERM，确认 18892 无监听；合成库、identity、fixture、快照、证据及 worktree 全保留，其他端口未动。随后确认 8789／PID7137 health ok、原实例不变，见 [QA 收尾](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/ws02-hud/qa-20261019T090855Z/stopped-final-6948788.json)。本作者仅读取既有回执整理，未重新运行测试、服务或账号操作。
