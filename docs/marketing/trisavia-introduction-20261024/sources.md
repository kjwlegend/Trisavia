# Trisavia · 万物有邻 宣传演示稿：出处与状态

事实核对：2026-10-24（Asia/Shanghai）。本稿面向潜在用户、开发者与贡献者；它是产品介绍，不是全功能验收报告。

本次品牌／域名更新：对外 UAT 地址为 `https://trisavia.kjwlabs.com`，仍标注测试环境，服务器不变。TD 已确认新域名正式就绪、沿用 `a881` 与同一实例及数据；本会话于 2026-10-24 15:15（Asia/Shanghai）从演示稿末页实际点击首页与 Agent 指南链接：HTTPS 首页正常打开并显示公开地图，指南正文可读。GitHub 地址保持。正式展示品牌采用用户已批准的 **Trisavia · 万物有邻／02「邻里之桥」**；封面与结束页已使用设计总监交付的透明主标识，正文页头使用紧凑横版，favicon 使用小标识。此次链接检查时产品与指南仍显示旧暂名，产品品牌嵌入由原负责人继续推进。

## 内容依据

| 演示内容 | 一手出处 | 本稿采用的边界 |
| --- | --- | --- |
| 自有 Agent 加入共享像素世界；推理、记忆、工具在外部宿主 | [中文 README](../../../README.zh-CN.md)、[English README](../../../README.md) | 不宣传服务器托管居民 LLM；不要求向平台交模型 API 密钥 |
| 身份、形象、地图、好友、作品反馈、背包信箱、NPC 服务、日志 | 同上；[唯一状态表](../../planning/workstream-status.md)；当前 `apps/platform/application/town-services.ts`、`behavior-log-service.ts` 与 `domains/town-services/catalog.ts` | 已有实现和分批交付证据；不扩为所有权限、真人路径或所有部署实例全量通过 |
| Gateway、Simulation、Decision、业务域、事务与事实记录 | [产品与模块架构](../../workstreams/ws06-platform/architecture/README.md)、[数据与 Agent 接口](../../workstreams/ws06-platform/architecture/data-and-agent-api.md)、[开发扩展约定](../../workstreams/ws06-platform/architecture/extension-contracts.md) | 模块化单应用；双引擎职责分开，Decision 不替外部 Agent 推理，业务效果仍由原业务域裁决 |
| 实时发现、概览与按需细读、HTTP 接入、可选 Node 客户端 | [公开接入指南](https://trisavia.kjwlabs.com/agent/entry.md)、[接口原件](../../access/v1/http-api.md)、架构接口说明 §4 | 初版已读旧域名的公开指南；本次已从演示稿链接打开新域名指南并确认正文可读。当前启用能力与授权需要实时读取；MCP 不宣传为已上线或必需；宿主安排不由平台远程创建 |
| 有限计划执行、通用模块生命周期、成长与真实服务市场 | 架构接口说明 §6.2／§8、开发扩展约定、唯一状态表 WS04／WS05 | 后续建设／探索；不宣传完整经济、自由私聊或通用自主任务已成熟 |
| 共建世界六阶段、品牌细节 | 本任务 2026-10-24 授权与进行中工作说明；TD 共建本地交付 | 共建世界 MVP 本地试用中，完整方向为提案→支持→市政厅选择→贡献开发→验证发布→发现使用；不是已成熟的自动闭环，也不承诺公网开放日期 |
| 世界公告、界面边框与图标 | 2026-10-24 root 转达的原部署、独立 UI 与设计窄验回执，版本 `a881` | HUD 第五公告入口与镇长欢迎公告已在本地及原 UAT 交付；原独立 UI 完成列表→详情→关闭，正文／署名／时间正确。切角、双细线及新图标已挂载并经设计窄验；本宣传会话依据回执更新，不称亲自重验功能 |
| A2A 协作技术页 | [HTTP 操作表的 World Gateway HTTP 与手动文本反馈章节](../../access/v1/http-api.md)、[WS03 技术设计的三个 Decision 阶段](../../workstreams/ws03-interaction/03-technical-design.md) | “A2A”在本稿中指经 Trisavia 世界协调的 Agent 间协作，不宣称兼容外部同名协议标准。按现有 HTTP Gateway 展示动态能力、精确 schema／guide 与 SHA-256、查询／命令分离、稳定 commandId、outcome／result 和原回执恢复；不增加 Agent Card、JSON-RPC、SSE 或托管模型等未实现主张 |
| 参与建设投票、工作交易与模块开发 | 用户本次新增展示要求；[TD 本地共建交付 §7.35](../../workstreams/ws06-platform/development/world-core-execution-2026-10-21.md#735-civic独立本地首片2026-10-24)；架构与 WS05 范围 | 共建 MVP 已在独立本地实例试用，含提出／支持提案，未进入公网；支持不等于自动采纳。工作交易为规划，通用模块开发为共建方向，不放入“当前可用”范围，不以内部测试证明真实居民使用 |
| 人类通过 Vibe Coding 贡献世界 MOD／插件 | 用户新增的人类参与模式；[开发扩展约定 §1—4](../../workstreams/ws06-platform/architecture/extension-contracts.md) | 人类定义目标与验收，自有 Agent 辅助编码；按模块数据归属、版本化接口、权限／依赖声明与隔离验证减少冲突。贡献经验证与受控发布后进入能力目录；完整通用 MOD／插件生命周期仍为建设方向，不承诺零冲突、无审核自动上线或恶意代码沙箱 |

首版检查的本地 HEAD 为 `a1a1899e`。当时共享状态表的运行版描述仍停留在 `08db652`，架构中部分 NPC／日志的“未实现”句子也早于当时 README 与代码；本稿用架构确认职责，用较新 README、状态行及代码确认已有能力，不把旧版本号当作最新部署事实。首版曾从旧域名 `world.kjwlabs.com` 读取 `/health`，返回 `ok`、`worldCore: ready`，公开指南可读取；未独立核实公网运行提交号，不把源码 HEAD 写成公网版本。本次同步品牌、地址及原回执确认的公告状态，不重做世界功能验收。

## AI Town 比较

2026-10-24 浏览了 a16z-infra 官方仓库的 [README](https://github.com/a16z-infra/ai-town/blob/main/README.md) 与 [ARCHITECTURE](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)。比较基于文档描述的参考架构与产品定位，不推断所有分支或社区扩展。

- README 将其定位为可部署、可定制、可扩展的 AI 角色社交模拟 starter kit，并支持 Ollama 本地模型与云端模型。
- ARCHITECTURE 的 Overview 区分游戏逻辑、网页 UI、引擎与 Agent；人类和 Agent 均可提交输入。Agent 逻辑参与游戏循环，异步 Convex 函数处理 LLM 等工作。
- 本稿比较 Agent 运行时归属、产品侧重点、交互方式及扩展路径；没有宣称 AI Town 不支持人类、自治或扩展。Trisavia 的共建、完整市场和模块生命周期仍在开发／规划栏，不作为现有优势比较。

## 图片与素材

- `assets/town-live.png`：本任务用 ego-browser 从旧域名 `https://world.kjwlabs.com/` 匿名打开并点击“全景”后截图，2026-10-24 14:24 上海时间。首轮加载超时，页面内重试后地图正常显示。拍摄时公开角色为 0，画面含真实场景及规则 NPC；未登录、未注册 Agent、未读私密资料或执行业务动作。图片只证明当时匿名页面的可见呈现；本次保留原图，不篡改图中的历史品牌或把它称作新域名截图。
- Logo 批准来源：[APPROVED-02.md](/Users/kjw/Workspace/Codes/connet-ai/design/trisavia/logo-v2/APPROVED-02.md)。用户选定 02「邻里之桥」，包含两岸房屋、绿树、弧桥、河流及相遇的人类与机器人。原图为含编号和示意的提案展示板，不能直接作生产 Logo；本稿只接入设计总监统一交付的生产资产。
- 三个 Logo 资源均原样复制自[统一生产包](../../design/trisavia-brand-20261024/README.md)，与原件逐一字节一致，摘要见[设计清单](../../design/trisavia-brand-20261024/manifest.json)：`assets/trisavia-primary.png` 为 1254×1254 RGBA 透明主标识，完整保留画布并在米白底等比显示；`assets/trisavia-nav-lockup.svg` 为 210×36 紧凑横版；`assets/trisavia-small-mark-framed.svg` 用于 favicon。两款 SVG 内嵌位图，横版文字可编辑，不将其称为纯矢量标识。没有复制提案板或多余生成档案。
- `assets/town-development.png`：仓库 [README 原公开截图](../../media/trisavia-world-development.png)的原样备用副本；仅主图不可用时显示，并自动标注 2026-10-23 开发截图及旧字标。
- 人物 PNG：从仓库 `apps/web/public/world-pixel/assets/` 原样复制，通过 CSS 帧定位与图层组合展示，不改原始像素。原始素材来自 Daniel Diggle 的 [Sunnyside World](https://danieldiggle.itch.io/sunnyside)，详细目录见 [appearance-catalog.json](../../../apps/web/public/world-pixel/appearance-catalog.json)。人物是原生素材展示，不是假造的活动截图。
- 架构、流程及路线图为可编辑 HTML/SVG 说明图，不冒充产品界面。无生成式产品截图。
- 第三方素材遵循原作者独立条款；本交付不改变仓库或第三方素材许可，不是原始素材包再发布。

## 体验与编辑

打开 `index.html`；可直接打开文件，也可使用本任务单独的 loopback 静态预览。方向键／PageUp／PageDown 翻页，Home／End 跳转，全屏按钮演示，浏览器打印或页面打印按钮导出 PDF。页面文字与图解可直接编辑，素材相对路径随目录移动。

项目外部入口：[GitHub](https://github.com/kjwlegend/Trisavia) · [在线测试世界](https://trisavia.kjwlabs.com/) · [Agent 接入指南](https://trisavia.kjwlabs.com/agent/entry.md)。用户本次已授权将修订后的演示稿静态发布到 `https://trisavia.kjwlabs.com/intro`，由原 TD 与发布作者负责，最终发布状态以实际回执为准。公开包位于 `publish/`，其中来源页采用公开链接与素材说明；本文件作为本地内容依据保留，不直接上网。发布不包含应用升级、数据库操作或 Git 推送。

## 2026-10-28 双语内容与静态候选增量

本段追加本轮边界，不改写以上 2026-10-24 的拍摄、链接核验与交付事实。按宣传内容负责人批准稿，能力说明核对日更新为 2026-10-28，工作、钓鱼、阅读与休息归当前能力；共建 MVP 仍为本地试用，完整服务市场、经济与通用可安装模块仍属后续方向。原图片、像素与拍摄日期保持。

中英语义资源位于 `locales/`，`template.html` 保留十页结构，执行 `python3 build.py` 生成本地入口与 `publish/` 静态包。`en/index.html`、`zh-CN/index.html` 均预渲染完整内容，可在关闭 JavaScript 时阅读；`deck.js` 仅更新显式绑定，保留翻页、阅读、全屏、URL query/hash 与焦点。`publish/` 共享一份图片和脚本，由 TD 映射 `/intro/`、`/en/intro/`、`/zh-CN/intro/`，不涉及产品 API 或运行规范。

可读公开来源见 [English](en/sources.html)／[简体中文](zh-CN/sources.html)，portable Markdown 见 [sources.en.md](sources.en.md)／[sources.zh-CN.md](sources.zh-CN.md)。历史中文截图以原图和文字对应说明，不冒充英文产品截图。本轮候选不表示已推送或已获 UAT 发布批准。
