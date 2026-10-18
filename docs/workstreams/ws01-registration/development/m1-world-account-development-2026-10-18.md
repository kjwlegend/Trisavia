# 世界内账户与管理 · 开发交接

日期：2026-10-18。共同基线：`22e0d82c862a8dce019dc466d26eb5aa5236d66a`。网页源码已固定为 `05fc5d1f4e84baf9b1d3a8896a84d156aab079b4`。开发完成，测试待安排；独立静态审查与设计对照待原负责人安排，运行验证因用户要求未执行。

设计唯一依据为[世界内账户合同](../design/world-account-entry-contract.md)与[桌面效果稿](../../../design/world-account-entry-desktop.html)。效果稿是虚构示例，不是产品截图或运行证据。

## 范围与模块

本轮把原账户与管理呈现迁入同一世界壳、单一面板宿主，不改 M1 业务权限、HTTP、邮件流程或迁移。API 作者的 `cbf3b9cb5af984b0903d63a643069e17b3a85fc4` 仅修改 `apps/platform/transport/http/site-routes.ts`，使 `/owner` 直接返回 `index.html`；integration 对应 `4458418`。公开接入说明来源 `5ab8292069b1dec73b081c67e00f008b6eb09e50`，integration 对应 `6301848`。

以下网页模块均位于 `apps/web/public/`，按原作者固定交接与源码文件清单记录：

| 模块 | 本轮职责 |
| --- | --- |
| `world-bootstrap.js`、`owner-entry.js` | 导入世界前可靠暂存并清除私密 fragment；独立私密入口队列，不把证明交给普通 HUD 状态 |
| `owner-markup.js` | 唯一账户模板，删除旧 `owner.html`，不挂第二套后台或 iframe |
| `index.html`、`owner.css` | 共用启动入口与账户面板样式 |
| `owner-panel.js`、`hud/shell.js` | 440px 账户呈现、内联确认与唯一 PanelHost；账户／M2／场所面板互斥，关闭只收起 |
| `owner.js` | 单实例、限定账户根的控制器，保留原命令／回执与未决流程 |
| `owner-email-flow.js`、`owner-recovery-assistance.js` | 注入账户 root 范围，沿用邮箱及备份协助协议 |
| `hud/session-api.js` | 仅真实账号／授权 Agent 安全摘要适配，不复制主人秘密或控制器状态 |
| `home.js`、`hud/scene-renderer.js` | 世界只启动一次，账户表单与场景输入／焦点分离 |

可见入口为 `#hud-account`（访客「登录／注册」、未完「继续上次操作」、已登录真实用户名）、`#hud-agent`（当前 Agent →「我的 Agent」）和 `#hud-agent-entry`（「接入 Agent」）。共用 `#hud-window`、`#hud-title`、`#hud-close`；账户根为 `#account-root`，子页覆盖 agents／profile／appearance／participation／policy／runtime／records／invite／security／entry／success。原认证、邮件、恢复与关联表单入口保留；新增恢复密码确认与形象表单只改变呈现，不新增业务权限。

「忘记密码？」下保留「通过原邮箱找回」与「使用备用恢复文件」；没有有效私密请求时，邮箱路径只说明请原 Agent 发起，不直接重设。有效请求内为「通过邮箱验证码找回」。未配置邮件不被写成已发送、已验证或恢复成功。

`/owner#handoff=…`、`/owner#assistance=…` 和获准目标入口保留；origin、instanceId、Agent 身份与凭据不因换壳改变。普通账号名、Agent 公开名字与内部 ID 分别表达；关闭面板不等于取消、退出或完成。未确认操作先于新入口，原操作号、目标与私有续接材料继续由现有控制器管理。标准 HTTP 是接入主路径，Node 参考客户端可选，本轮无需 CLI 差异。

## 用户任务覆盖交接

| 任务 | 迁入世界内的范围 |
| --- | --- |
| 访客注册／登录 | 首页账户入口，注册邮箱验码后才建账号；真实空态，不强制 JSON |
| Agent 私密入口新注册 | 捕获并清除 fragment，固定目标，验码后一次注册并绑定，不增加二次认领 |
| 已有账号关联 | 登录后显示当前账号与目标，由人明确确认；原有 Agent 与恢复材料保留 |
| 第二位 Agent | 真实单次邀请、独立注册凭据、授权列表与显式切换；不把 A 的待确认操作改给 B |
| 找回与账户安全 | 原邮箱恢复、有效独立备份、可选备用恢复启用、当前文件导出与私密进度续接；验证码／主人证明不交 Agent |
| 现有管理 | 资料草稿、发布／撤回、形象、参与各轴、模式／字段锁、运行撤销／替换、邀请与必要记录，不借布局改变权限 |
| 原世界与 M2 | 世界场所与面板互斥；背包／信箱等仍是明确进入的演示，不伪造资产、消息、在线或互动 |

## 待安排

- 独立静态审查：统一壳入口、私密上下文优先级、原授权与回执保护、所有管理功能迁入后的可达性。
- 后续获准运行时：上述用户任务、关闭／返回／焦点、长内容滚动、刷新与未知结果、A/B 隔离及退出清理；本轮不扩写或执行测试套件。
- 邮件通道配置、真实投递／收信及完整闭环仍未验证；能力布尔或历史 PASS 不替代本轮证据。

本轮未执行测试、typecheck、build、Node 语法检查、浏览器验收、端口探测、应用启动、服务切换、发信、迁移或部署；未改 8789／8799 用户服务和数据。源码开发、独立静态审查与运行验证分别记录，不沿用旧 PASS。
