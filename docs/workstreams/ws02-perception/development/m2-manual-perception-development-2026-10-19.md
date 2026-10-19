# M2 手动感知开发交接

批次约定日期为 2026-10-19，以下作者执行发生于 2026-10-20（Asia/Shanghai）。基线 `878a0cab60a28027f3b30facaa0860dc56dd2ca3`；API 与验收作者均按本轮已核配置 `gpt-6.1-sol/xhigh` 分工。作者阶段与后续工程复核／本地交付分节记录。

## 实现与边界

- HTTP 主路径为 capabilities → discovery → 精确版本 guide/schema → overview 类别指标 → 按需 list/detail → Agent 显式确认当前消息版本；已有身份沿用原 runtime。snapshot/changes、周期任务、推送、宿主调度及 Skill 自动安装／执行未实现。新前端不在本轮。
- 固定 API 链为 `696670a` → `9e3e947` → `e1fed24` → `05d6882` → **`bc95f7d5c9afa1a1245de11b065e3cd9c095de83`**；迁移 5 增加感知表。显式种子生成演示内容、持有和投递，后续注册仅幂等补缺；不覆盖编辑或重开撤权。manifest 区分 68 个种子对象与动态公开角色，31 条投递中 30 条正文可读可确认、1 条仅获准元数据；全 inbox 省略 metricId/selection 才能含已确认项。演示计划、虚构发生记录和真实管理员内容发布分别标识，不把计划／发生或公开目录／私有持有混成总数。
- `perception-admin.ts` 的版本编辑／指南发布是本机受控服务函数，不存在 runtime／owner 发布 HTTP 权限；外部 Agent 只从公开目录发现获准读取／确认。真实管理侧变更与 Agent 下一次主动版本检查分开执行。
- 可选 Node `check-updates --state` 仅读原身份与版本化目录／说明，独立 0600 cache 在完整同版本及 digest 核对后原子替换，不初始化角色、换发交接或续交未决业务。首次正常接入继续发现，失败保身份、主人入口及上次完整基准；旧身份下次手动世界任务先检查，非后台或所有无关任务联网。
- 新公开操作及类型 schema 为版本 2，实际已有旧版本文档保留；新库不凭空生成历史 schema1。HTTP 文档返回 `canonicalDocument` 与 `digestAlgorithm:sha256-utf8-hex`，先验证 JSON 结构与 `document` 相等，再对原字符串 UTF-8 字节求摘要。历史目录 revision 不可换声明复用，原 operationId 的精确回执仍可重放。

## 作者验证

- 测试链 `b064ca6` → `bc923cc` → `4b23aae` → `0c06e36` → **`17e02f452f1d40d9a167d6ab4ae90f9de7ac55d2`**。固定生产 bc95＋17e 同字节新 WS02 **20/20**；在提交 17e 上必要 storage/config/M1 API **34/34**、下载版 CLI **12/12**，typecheck／diffcheck 均退出 0，无 skip。新 20 项执行时 HEAD 为 `3a09678`、两份测试随后原样提交为 17e；没有伪称三批同次或整轮回归。
- 覆盖合成 schema4→5 原身份／绑定／M1 全行保全、30→5 摘要→读 3→确认 3→27、完整同版本分段、权限／回执／失败键、seed 幂等、新注册投递、来源与指标隔离、准备事实、保留期与稳定续页、真实 SQL 失败回滚及管理发布 CAS／旧版 source history。HTTP 文档独立摘要校验 35 份，实际成功／错误信封与 9 类正文共 **186 次 Ajv 2020 校验**；旧 guide1 在新版本发布后原样可取。
- CLI 用真实下载文件／新进程及自有随机 loopback，验证注册发现失败不阻交接、分页／guide 中断保完整基准、7 类损坏 cache 保原拒绝、6 类收尾身份／协议变化、未决业务不续交。收尾探针为保护真实 240/min 限流，每条正常重开同一私有 DB／identity 的自有后端，日志记录每次重启与脱敏请求数；不是单个持续服务链。
- 原失败日志均保留：早期两处测试计数／故障假设、T01/T02、旧 CLI 初始公开假设、R1 形状状态码／稳定 ID 排序、R2 累积限流、最终新库误要 schema1。`9e3e947` 的 0/2 预算反例实际是**续页扫描预算**，不是 detail 一字节预算；此前误归因已更正。各问题修订与作者复测不替代原 reviewer 的最终固定组合接受；最终独审／独立 Agent 结果由统筹另附。

可复现入口（Node `/Users/kjw/.nvm/versions/node/v24.16.0/bin/node`）：

```sh
node --test --test-concurrency=1 --test-reporter=tap tests/ws02/*.test.ts
node --test --test-concurrency=1 --test-reporter=tap tests/storage/sqlite-store.test.ts tests/storage/recovery-migration.test.ts tests/config/app.test.ts tests/api/m1-service.test.ts
node --test --test-concurrency=1 --test-reporter=tap tests/agent/cli.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

精确命令、实际执行 HEAD、Node 版本、退出码、测试计数和日志摘要见 acceptance `outputs/ws02-real-perception/final-17e02f4/checks.json`；原日志同域保留。隔离 fixture 由 `scripts/ws02-qa-fixture.ts --out <全新绝对目录>` 使用正常 API 离线生成 A(2 Agent)／B(1)／空账号及 manifest，秘密仅私有 0700/0600 文件，stdout 仅路径／非密计数；未复制用户库。核心来源的 fixture 预检不冒充最终种子／生产交付。

## 后续 GitHub 开发基础

- 运行需要 Node `>=24 <25`，依已提交 `package.json`／`package-lock.json` 执行 `npm ci`，直接 `npm start`，无构建前置。文中本机 Node 绝对路径仅是作者执行环境，不是应用依赖；后续 TD 的独立 `git archive` 初始化结果见下节。
- 运行网页／公开接入文件随候选提交；seed 的输入来自已提交 `apps/web/public/hud/demo-fixtures.json` 与 `apps/platform/domains/perception/demo-data.ts`，入口为 `scripts/ws02-demo-data.ts`，不读个人 `docs/design`、ignored 测试输出或真实 Agent 凭据。管理员须显式给 database、配对 identity、operator 及新 manifest 路径；发布函数仅本机管理调用。
- DB、配对 identity 和秘密材料留在私有运行目录，不进 Git；现有实例必须沿用配对文件，不能拿 QA 库／身份替换。体验环境显式配置 `M1_EMAIL_MODE=experience`（1234、无真实发信）及自身 host/port/DB/identity；真实时钟为默认，作者测试固定时钟不得带入用户运行。用户库迁移、备份及服务切换均由 TD 另行记录。

以上为作者阶段证据；本作者未读取真实 Agent 凭据、操作用户 8789／原库、执行浏览器／真实邮件／手机或旧全量回归。当前 UI 人类演示已读不推进 Agent 确认；本轮没有新增人类业务写入接口。

## 工程复核与本地交付（原 reviewer／TD 回执）

- 原 reviewer R5 正式接受 `878a0cab → d12553a0d962751e8551926341441917b5ced7e7`，CR01–09／T01／T02 按指定范围关闭，见[原报告 §9](../validation/m2-manual-perception-code-review-2026-10-20.md#9-r5-固定增量独审0bf33df--d12553a)。TD 从 d125 纯 `git archive` 导出并核对 286 文件，独立 `npm ci --ignore-scripts` 后 typecheck 退出 0、新 WS02 20/20、affected＋CLI 46/46 无 skip；空库 schema5／20 表、seed68／幂等及自有 port0 公开 HTTP 通过。证据：integration `outputs/ws02-real-perception/archive-validation-d12553a-20261019T170546Z/verification.json`。
- main 已 FF 至 `0abe18dac8d0e888bf4f290b0b82c50b0832b4e4`，d125 后仅交接／reviewer 报告；32 路径合入并保留既有非目标内容、状态和索引，见同域 `main-merge.json`。实际 8789 运行源码仍 **d12553a**、PID **16555**，快照 `outputs/ws02-real-perception/user-delivery-d12553a`，不是后继文档提交。
- TD 新一致备份目录为 `outputs/ws02-real-perception/user-8789-backup-before-ws02-real-20261019T170735Z`；live／stopped／after-start 均 integrity ok、identity 配对。原 DB／identity／实例 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f` 保留，experience1234／真实时钟沿用；副本迁移／seed 先验证，实际升为 schema5／20 表。stopped→after-start 原 14 表按保全口径核对，`schema_migrations` 原 1–4 不变、仅追加 5，无旧库回灌。
- 实际 seed68＋原公开角色 1＝69 去重对象，14 holdings／31 deliveries／30 可读未确认／1 不可读，真实管理发布 1 条；私有 manifest 留在上述备份目录。健康／能力、首页／owner、四份 MD、CLI／公开 fixture 共 10 项只读 HTTP 核对通过，未新开浏览器。交付证据为同域 `user-8789-delivery.json`、备份目录 `switch-progress.json`。
- 交付时目录冻结为 `catalog-demo-1-schema-2`／`skills-catalog-demo-1-schema-2`，主库未提前做内容／guide 管理更新；后续独立 HTTP 及受控更新结果见下节。三份 WS01 已审接入文案在 4fe 后未改。schema5 回退只用兼容源码＋**CURRENT DB／identity**，禁止退回 schema4 源码或用旧库覆盖后续写入。

## 独立 Agent HTTP（原小序 R02／R03）

- [R02 正式报告](../validation/user-simulation/xiaoxu-http-r02-20261020T012437.md)记录从公开入口、沿原身份完成发现与读取：83 refs＝69 内容＋14 holding，82 项完整正文＋1 项获准但不可读元数据，40 份精确文档 digest 通过；未确认 30 → 读摘要／正文仍 30 → 显式确认 3 条为 27 → 原操作重放仍 27。TD 事后对类别、可读性、版本逐项匹配 manifest，见 integration `outputs/ws02-real-perception/r02-independent-coverage-reconciliation.json`，没有把管理员清单预先当作 Agent 的发现入口。
- R03 前 TD 经已审本机管理函数／CAS 将 `test-message-09` 正文 v1→v2，旧确认保持 v1；guide1→2，目录更新为 `catalog-r03-20261020-e29b7a68`／`skills-catalog-r03-20261020-e29b7a68`，schema2／APIv1／protocol1 不变、旧文档保全。回执在同域 `r03-controlled-update-20261019T173331Z/change-receipt.json`，同目录保留 before-consistent.sqlite＋配对 identity；未重新 seed、重启或读取 runtime 凭据。
- [R03 正式报告](../validation/user-simulation/xiaoxu-http-r03-20261020T013603.md)记录 101 次结构化 HTTP 全 200、127 项 schema 输入／输出校验零错；实际取得 5 新 guide／5 旧 guide／35 schema。唯一消息新版完整重读后未确认仍 28 → 显式新版确认 27 → 同操作重放 27。83 refs 无增减：81 项详情沿用 R02 同 ref／版本证据，1 项新版正文重读、1 项仅元数据，不能写成新版 82 项全部重读。收尾压缩后另有 6 次只读 GET，报告单列、合计 107，不计入 101／127；无注册、删除或额外业务写入，正式报告整理后未新发 HTTP。
- 本次回执时 main 为纯文档后继 `15544be2efb3e104013220ae7c9eb1aaf2e3c9ce`，实际运行仍 `d12553a0d962751e8551926341441917b5ced7e7`／PID16555；后续文档整合不换 runtime。独立 owner-only activity 仍未测；上述结果不扩大为全平台、定时／Skill 执行、真实邮件、浏览器或手机验收。
