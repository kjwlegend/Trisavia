# PostgreSQL 本地实施与交付记录

2026-10-20，技术总监维护。本文件是本批执行合同和交付证据的唯一入口，承接已获用户批准的[主案](../architecture/postgresql-jsonb-proposal.md)与[技术附录](../architecture/postgresql-jsonb-technical-appendix.md)。原方案的待审核字样不覆盖本轮明确实施授权。本轮允许本地自管容器、完整隔离迁移验证与成功后的8789切换；公网未授权更新。

## 1. 基线与当前状态

- 当前固定候选源码 `7b748ab94ff944e3c54f98b8a112d0a3a7727791`，包含钱包与直接消息schema6。原专职reviewer已接受b94febb→7b748ab固定全批，WM-CR01—08全部关闭，无未结实质发现。纯Git归档typecheck与87项核心检查全部通过、无skip；fresh schema6副本保全已核对。该接受仅属钱包／信箱基线，PG另审。
- 用户8789仍为adae355／PID9859、原SQLite schema5／20表，尚未执行本批写入。最终停服后一致快照先经审过的钱包源码离线迁至schema6，再转换PG；提前演练只用一致副本。不中途发布两个竞争版本。
- schema6准确源清单为下列23表；不得按旧20表清单遗漏钱包及直接消息。原实例、recoveryEpoch、配对identity、旧凭据及所有后来用户写入保留。
- 原额外三个API文件有29项同基线失败，单列历史证据；不得宣称旧全套全绿。独审、工程测试、独立UI与Agent实际验收分开记录。

## 2. 独占分工与接口冻结

| 作者 | 工作树／分支 | 唯一可写责任 |
| --- | --- | --- |
| 原API作者 owner_read_api | m1-api；钱包修订完后codex/pg-async-application | contracts/store.ts异步端口、application、domains具名仓储、app/server/configuration/HTTP、现有业务CLI与API/WS02/config/integration/agent测试的异步适配 |
| 原存储作者 m1_storage | m1-storage；codex/pg-domain-storage | infrastructure/postgresql全部、正式分域DDL/codec/查询下推、pool与事务、package及lock、PG存储测试及tests/site（C确认尚未修改后转交）；旧SQLite仅离线工具兼容维护 |
| 原acceptance作者 m1_acceptance | m1-acceptance；codex/pg-migration-ops | ops/postgresql、scripts/postgresql、PG导入/对账/备份恢复及相应测试、docs/operations/postgresql.md；tests/e2e与scripts/e2e-server.ts/run-e2e.ts、playwright.config.ts的必要PG fixture适配；tests/site已转B |
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
4. 原专职reviewer接受最终固定diff后，核对并保全main所有非目标脏路径/index；短维护窗口停止并排空8789，fresh live/stopped一致SQLite及identity，离线schema6升级、最终PG转换及比对，业务写门关闭只读ready核验，再唯一切PG。维护窗口按15分钟设计，以实测证据为准。最终固定候选的本地容量仅按当前小数据验证：冷启动就绪≤30秒，10次health的p95≤1秒，典型列表／详情p95≤2秒，4并发读取p95≤5秒且无超时；这些是本地验收阈值，非生产SLA，必须先实测再记达到。
5. PG接收任何新持久写（包括读取会话/访问事实）后只能在PG侧保全修复，不切陈旧SQLite。原SQLite/identity/所有快照保留封存。最终稳定SHA、实例、真实余额/消息数、URL先回总指挥，再补文档；独立UI/Agent窄验收由总指挥调度。无定时Agent触发、公网更新或push。

## 5. 实际进度与证据

- 钱包基线已独审接受7b748ab，纯Git归档位于integration的 `outputs/postgresql/wallet-sqlite-baseline-7b748ab`；87项检查及完整tracked文件hash见同目录上级的baseline验证／manifest。新鲜schema6一致副本指针为 `outputs/postgresql/schema6-baseline-pointer.json`，仅供复制到隔离演练空间，原SQLite未写。
- `schema6-source-inventory.json`记录全部23表字段类型／shape／最大字节及数量，不含秘密值。该盘点副本含原Agent1、wallet1（真实0）、direct messages0／receipts0、objects68、grants45、catalog151、access462、sessions12；只是该时点副本事实，最终cutoff仍须重取当前数据。
- API真实异步端口eef4d46、核心应用d06dd6d已在隔离integration组合至8bf6e26，生产调用链使用具名域仓储及PG-only配置，启动只读检查已有目录。作者apps-only typecheck与隔离PG注册smoke通过；CLI及既有测试异步适配仍在途，未宣称全项目通过。
- 存储38d0de3及后继d810498已固定并送原reviewer：正式类型列／关系和无损codec、真实pool事务、同实例守卫、默认关闭业务写门；d810补齐旧数字及新哈希授权版本。ops b408e41与自有fixture生命周期10295aa6亦已送审。以上仅隔离候选组合，尚未合main或取得PG最终接受。
- 容器作者实测独立Colima `agents-era-pg` 健康（aarch64／2CPU／4GiB／30GiB，Docker Server29.5.2），显式context `colima-agents-era-pg`；用户当前context仍colima、default仍停止。专用容器 `agents-era-pg-server` 仅监听127.0.0.1:15432，卷 `agents-era-pg-data` 挂/var/lib/postgresql，PGDATA为/var/lib/postgresql/18/docker。
- 实际PG版本18.6 (Debian18.6-1.pgdg13+2)，UTC、max_connections40、archive_mode=on、wal_level=replica。配置固定官方镜像 `postgres:18.6-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336`。角色postgres/connet_migrator/connet_app/connet_backup分开，秘密仅在acceptance ignored私有目录0700／文件0600；不在本文保存值。首次VM DNS缺失只在自有profile修复，未更改用户默认环境。
- 原reviewer在首个ops固定增量提出PG-CR01／P2：Compose继承CONNET_PG_*环境可能覆盖校验配置，status.image原实现取期望值而非实际inspect。已派回C补显式环境绑定、四变量冲突负例及实际资源核验；问题未关闭前不把旧healthy记录中的image字段当实际镜像证据。不据该静态问题断言当前容器已偏离。
- PG-CR01作者最小修复596edb4已送原reviewer，真实四继承环境冲突Compose模型／实际inspect对比及原runtime共4/4、无skip；脱敏证据acceptance outputs/postgresql/environment/pg-cr01-tests.log与runtime-status-cr01.json已读，后者实际observed image/id/port/project/volume与expected一致。PG-CR05运行角色授权缺口由C固定3373dbe修复，显式部署权限步骤；真实app闭门open/read及开门parent/child DML、拒绝DDL／migration／gate／identity写综合用例1/1，原reviewer待复核。A最初注册smoke使用app但fixture授予过宽，不能继承为最小权限通过，正式fixture将改用该步骤并重验。
- C首轮真实转换回执：复制7b schema6一致源至自己0700目录，d810 codec导入全新connet_rehearsal_7b_001，23源表／820业务源行逐行id/version/全部字段及两metadata回构差异0，140历史guide/schema摘要一致，写门仍false。源SQLite／identity读前后hash不变。私有manifest位于acceptance outputs/postgresql/rehearsal-7b-001；重复转换、故障回滚、basebackup/WAL恢复仍在执行，待固定实现及普通脱敏证据后另列。
- 正式connet业务库仍未导入／接应用；隔离测试库与正式库分开。PG候选依赖另装在integration outputs/postgresql/dependencies-38d0de3/node_modules，旧8789快照引用的integration/node_modules未替换。容器健康不等于PG最终接受或本地切换通过。建议24小时观察不阻止本轮已验证本地交付，不创建定时任务。8789仍原adae355／PID9859。

- 原reviewer已静态关闭PG-CR02／03／04原触发，并接受C修复关闭PG-CR01／05；必要实际业务证据及最终组合仍待。B后继0a50021追加IAM v2 emailVerified、7b4608a追加platform v2不可变内容trigger、85427b4修close排空并补有界重试。21/21真实最小app检查、定向tsc/diff0，普通日志与环境在storage outputs/postgresql/storage-verification-85427b4，TD已读。
- A测试候选c5d9050最小权限fixture已固定，config/proxy16项在B7b4608通过，4个关键WS02文件13项在B0a50021通过；不同存储版证据不合称同一最终运行。完整应用测试／CLI适配仍在途。
- 应用核心独审新增PG-CR06（固定首200清理漏后部expired）与PG-CR07（邮件及其他配额无界扫描／N+1）；原A改端口、域仓储与用例，B支持受控SQL过滤／计数与索引。保留原限额／幂等语义，不引入后台触发，固定修订待送原reviewer。
- C回执真实basebackup／pg_verifybackup＋连续WAL隔离恢复成功、源PG未停；并从冻结7b全新合成Agent生成真实limit1 discovery令牌，迁至B7b4608后以原token续完47项顺序且无重漏，PG新建页亦一致。上述转换／恢复／分页测试代码仍待同批固定，暂不据回执记最终接受。
