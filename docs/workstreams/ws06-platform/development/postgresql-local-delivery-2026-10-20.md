# PostgreSQL 本地实施与交付记录

2026-10-20，技术总监维护。本文件是本批执行合同和交付证据的唯一入口，承接已获用户批准的[主案](../architecture/postgresql-jsonb-proposal.md)与[技术附录](../architecture/postgresql-jsonb-technical-appendix.md)。原方案的待审核字样不覆盖本轮明确实施授权。本轮允许本地自管容器、完整隔离迁移验证与成功后的8789切换；公网未授权更新。

## 1. 基线与当前状态

- 当前固定候选源码 `7b748ab94ff944e3c54f98b8a112d0a3a7727791`，包含钱包与直接消息schema6。WM-CR01—07已由原专职reviewer关闭；WM-CR08已由原作者以aa79修订，正在原reviewer固定复核；未据作者自查预记通过，正式导入须等待接受。
- 用户8789仍为adae355／PID9859、原SQLite schema5／20表，尚未执行本批写入。最终停服后一致快照先经审过的钱包源码离线迁至schema6，再转换PG；提前演练只用一致副本。不中途发布两个竞争版本。
- schema6准确源清单为下列23表；不得按旧20表清单遗漏钱包及直接消息。原实例、recoveryEpoch、配对identity、旧凭据及所有后来用户写入保留。
- 原额外三个API文件有29项同基线失败，单列历史证据；不得宣称旧全套全绿。独审、工程测试、独立UI与Agent实际验收分开记录。

## 2. 独占分工与接口冻结

| 作者 | 工作树／分支 | 唯一可写责任 |
| --- | --- | --- |
| 原API作者 owner_read_api | m1-api；钱包修订完后codex/pg-async-application | contracts/store.ts异步端口、application、domains具名仓储、app/server/configuration/HTTP、现有业务CLI与API/WS02测试的异步适配 |
| 原存储作者 m1_storage | m1-storage；codex/pg-domain-storage | infrastructure/postgresql全部、正式分域DDL/codec/查询下推、pool与事务、package及lock、PG存储测试；旧SQLite仅离线工具兼容维护 |
| 原acceptance作者 m1_acceptance | m1-acceptance；codex/pg-migration-ops | ops/postgresql、scripts/postgresql、PG导入/对账/备份恢复及相应测试、docs/operations/postgresql.md；原浏览器fixture异步适配须与A另行明确路径 |
| 技术总监 | m1-integration独占 | 本执行记录、整合固定差异、原数据保护、最终备份／转换／切换与实际回执 |

代码作者均沿用gpt-6.1-sol／xhigh；不得并发共享写区或回退他人修改。产品源码不由TD代写。原专职reviewer覆盖各固定增量与最终整合新增差异。

异步持久化端口约定：`read<T>(work:(tx:M1ReadSession)=>Promise<T>):Promise<T>`、`transaction<T>(work:(tx:M1Transaction)=>Promise<T>):Promise<T>`、`close():Promise<void>`；get/find/scan/count/insert/update/remove全部返回Promise，参数和StoredRow形状在过渡接缝保持现有语义。`openPostgresStore(options):Promise<M1Store>`由存储作者提供；options包含connectionString、instanceId、recoveryEpoch和有界pool/timeout。迁移独立显式执行，open只验证schema与identity，不能创建/升级/seed。

上述通用行端口仅作为内部存储、转换器与具名域仓储的接缝；应用用例通过具名领域查询/命令，不保留公开任意table/filter的长期应用接口。不以Promise.resolve包裹同步全库缓存冒充异步。PG正式表以类型列及关系为真源，codec无损组合现行DTO；不得每表复制id/version/data或永久万能对象表。JSONB仅保留具名有版本内容、受校验扩展及精确原文旁的结构副本。

最小一致性策略采用同实例具名授权守卫，先守卫后业务锁，所有权限修改和业务写入遵守同一顺序。read使用短RR事务、守卫共享行锁；transaction使用短RR事务、守卫排他行锁并推进独立write_generation。读者等待过程中若守卫发生变化则40001整事务有界重试，不能继续旧快照授权。此保守粒度先保障当前小规模本地行为，实际吞吐以演练为准，不宣称精细并发优化。write_generation不是业务recoveryEpoch；不得旋转原凭据代次。wallet纯read不得持久化守卫或访问事实。

事务始终同一pool client，finally释放；40001/40P01完整回调至多3次且不夹带网络外发。乐观更新严格expectedVersion+1。COMMIT已发送后的连接不明返回明确unknown_commit，不自动重放新操作；沿原operationId查回执恢复。先到的撤权完成后，后到读取必须拒绝；先取得守卫的读取可按该次合法顺序完成。连接池关闭排空；scope结束后不可再使用tx。启动/health应可在业务写门关闭时完成只读校验。

## 3. 源表逐项映射与转换门禁

| schema6源表 | PG权威去向 |
| --- | --- |
| instance_state | platform.instance_state，原instance/recoveryEpoch及独立部署守卫 |
| schema_migrations | platform.legacy_schema_migrations原1—6原样；PG module_migrations另记 |
| agents | iam.agents |
| owners | iam.human_accounts |
| credentials | iam.credentials，原hash/指纹/用途/epoch不改 |
| bindings | iam.management_bindings，active唯一及历史保持 |
| registrations | iam.registrations |
| profiles | profiles的草稿/公开内容/控制/提议/形象具名实体 |
| memberships | iam.world_memberships及现有参与策略 |
| operations | platform.operation_receipts，原幂等组合键与结果 |
| facts | platform.facts |
| recovery_requests | iam.recovery_requests |
| email_attempts | iam.email_attempts |
| mail_jobs | email.mail_jobs，不触发真实发送 |
| wallet_accounts | wallet.accounts，Agent+star_coin唯一，scale0，安全整数真实余额 |
| mailbox_messages | mailbox.messages/message_versions及受信sender，原不可变版本与来源去重 |
| mailbox_receipts | mailbox的recipient/delivery与Agent精确版本确认，真实首次receivedAt；授权版本不等同行并发版本 |
| perception_objects | 按原type拆spaces/items/inventory/notifications/announcements/events/rules；旧平台消息仍notifications |
| perception_grants | 原holding与inventory同一关系合并对账；delivery归所属域；其他为来源读取授权 |
| perception_states | 相应通知等域Agent版本确认，旧ref与确认版本不变 |
| perception_sessions | perception.read_sessions及有序read_session_items |
| perception_access | perception.access_facts及access_targets |
| perception_catalog | 按已有kind拆documents/catalog_releases/sources/source_states/observation_policies及对象关系/administrative_receipts；历史正文归所属版本表 |

每个源表/rowId/rowVersion/字段必须有落点及转换manifest；未知表/kind/字段不静默丢弃，不放永久other表。holding双面不得重复计数；原ref别名只存寻址关系。SQL筛选下推、稳定ID排序采用明确C字节序，数额严格范围转换；null/缺失/false/0区分。canonical字节与digest、Node24.16/ICU及两套原算法固定，JSONB打印不替代原文。源数据库与配对identity只在私有目录中读写，不输出凭据/正文。

## 4. 环境、演练与切换次序

1. 当前arm64，Docker CLI29.5.3与Colima已安装，默认daemon未运行。ops作者使用独立profile/context，不改变用户default context；端口候选127.0.0.1:15432须实际再核验。官方PG18.6，拉取固定补丁镜像后记录RepoDigest，PG18数据卷挂/var/lib/postgresql。秘密置0700目录/0600文件，模板不含值。
2. 在每次新建的隔离目标中转换schema6一致副本，核对全部行及精确内容/目录/身份/确认/钱包/消息；失败不发布半库。DDL与DML角色分开，运行角色无DDL，不自动扩展未来模块。
3. 真实PG验证幂等、并发初始化、唯一与FK/范围、版本冲突、授权竞争、旧页/正文、COMMIT响应未知与原回执恢复；源SQLite对照和旧29失败分别记载。实际备份、WAL/basebackup与恢复演练须完成；生产RPO/RTO尚未定不阻塞本地。
4. 原专职reviewer接受最终固定diff后，核对并保全main所有非目标脏路径/index；短维护窗口停止并排空8789，fresh live/stopped一致SQLite及identity，离线schema6升级、最终PG转换及比对，业务写门关闭只读ready核验，再唯一切PG。维护窗口按15分钟设计，以实测证据为准。
5. PG接收任何新持久写（包括读取会话/访问事实）后只能在PG侧保全修复，不切陈旧SQLite。原SQLite/identity/所有快照保留封存。最终稳定SHA、实例、真实余额/消息数、URL先回总指挥，再补文档；独立UI/Agent窄验收由总指挥调度。无定时Agent触发、公网更新或push。

状态：实施进行中；容器、PG代码、转换、演练与最终切换均须以实际后续回执更新，不预写通过。
