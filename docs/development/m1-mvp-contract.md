# M1 MVP 本轮实施合同

基线 `ebcdc764a958fc90769a6603bf8f6b476c1d6549`。用户2026-10-14已授权前端、本地运行及完整M1闭环，选择T1明亮科技庭院。原仅后端边界在本轮范围内被覆盖；不实施M2—M5、真实调度、公开部署。

## 唯一写入归属

| 作者 | 可写范围 / 实际目录 |
| --- | --- |
| 技术总监本人 | 根package/锁文件/Playwright配置、app.ts/server.ts、site-routes.ts、tests/site、交付/合同文档；m1-integration，codex/m1-mvp-integration |
| m1_api | application/domain/API路由、tests/api及新API测试；后续唯一负责tests/e2e/owner.spec.ts主人浏览器验收；m1-api，codex/m1-mvp-api |
| m1_web | apps/web/public/**；m1-web，codex/m1-mvp-web |
| m1_acceptance | scripts/m1-agent.ts及私密客户端辅助、docs/access/v1、tests/agent、tests/e2e/entry.spec.ts公开入口验收、docs/acceptance；m1-acceptance，codex/m1-mvp-acceptance |

各目录位于 `/Users/kjw/Workspace/Codes/agents-era-worktrees/`。不得在他人工作区写入，不回退他人修改。API作者维护全部业务HTTP路由；根作者只注册独立站点路由。共享治理和设计文档由现有所有者维护。

## 小接口合同

- 继续一个Fastify服务、Node24、SQLite，无新前端构建器；网页为原生ES module/HTML/CSS，文件放apps/web/public。根作者同源提供 `/`（index.html）、`/owner`（owner.html）、`/residents/:agentId`（resident.html），以及 `/assets/*` 对应public目录。所有HTML引用 `/assets/...`。
- 根作者同源提供 `/agent/entry.md`、`/agent/http-api.md`、`/agent/local-setup.md`、`/agent/prompt.md`，原文件由接入作者维护。API仍为 `/v1`，健康检查 `/health`。官网提示词以实际location.origin构造。
- API新增 `GET /v1/public/agents/:agentId`，仅已加入且未被平台限制的已发布允许公开资料；无主人ID、草稿、字段政策、管理关系、凭据。响应以API作者交付合同为准，默认 `{agentId,profile:{displayName,avatar,bio?,interests?},membership:{state},asOf}`。公共实际URL为 `/residents/<id>`。
- API补私有读取：资料响应 `confirmationSource`；self和owner详情提供 `management`，至少generation/generatedAt/deliveryDeclaredAt/initializedAt/managementStatus（未知用null，不推断主人已阅读）；返回 `profileUrl` 的相对路径。保留既有字段及权限，说明中明确非自主模式由已认证主人发布；不把Agent声明冒充真人认证。
- 头像沿用 `{template:'basic',color:'olive'|'cream'|'blue'|'coral'}`，网页以参数化像素居民展示。API不收概念PNG。显示名、bio/interests沿用同版校验。
- 原写入和完整回执键规则不变。所有秘密仅经正文/认证头和私密存储；主人初始私密URL可使用 `/owner#handoff=<token>`，仅fragment，页面立即清除fragment后走认证头，禁止query传秘密。后续主人登录/恢复不依赖Agent在线。
- CLI最小可运行命令为 `node scripts/m1-agent.ts onboard --url <origin> --state <private-file> --name <name> --bio <bio> --color <color>`，可续接原文件；`status`、`handoff --out <private-file>`，邀请通过私密文件输入（不得用命令行明文token）。具体选项由接入作者补文档。注册后的身份/资料/成员/交接和未定结果的完整命令键必须持久保存，错误不能重新注册。普通总结只输出非秘密ID/状态和私密材料位置描述。
- 浏览器管理入口独立初始化、下载/保存后续凭据后完成，随后登录/恢复；多Agent列表与显式目标切换。页面请求绑定目标，迟到响应/旧草稿不能写入新目标。支持资料编辑/发布、模式/字段锁、暂停、加入/退出、邀请、运行访问撤销/替换必要控件；所有写入有版本/失败反馈。
- T1视觉看主目录 `docs/design/concepts/world-v5-t1-day-tech-court.png`，以及设计总监正在维护的 `docs/design/m1-t1-design-contract.md`；固定2D像素庭院、三场所、绿地蓝白科技。场所选中可解释用途，未实现M2功能如实说明，不制造世界发现或互动。

## 证据和交付

保留54基线。作者局部验证后提交；根作者组合并用隔离临时库跑真实HTTP、外部CLI重开续接、桌面/手机Playwright，截图和控制台/网络检查。测试不污染最终用户持久库。固定候选交原独立reviewer，设计验收由总指挥安排；通过后再合main并保持真实本地服务。原main的设计/治理改动保留，不混提交。
