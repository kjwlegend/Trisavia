# PostgreSQL 本地实施与交付记录

2026-10-20，技术总监维护。本文件是本批执行合同和交付证据的唯一入口，承接已获用户批准的[主案](../architecture/postgresql-jsonb-proposal.md)与[技术附录](../architecture/postgresql-jsonb-technical-appendix.md)。原方案的待审核字样不覆盖本轮明确实施授权。本轮允许本地自管容器、完整隔离迁移验证与成功后的8789切换；公网未授权更新。

## 1. 前置基线与实施范围

- 本轮钱包／信箱前置基线源码 `7b748ab94ff944e3c54f98b8a112d0a3a7727791`，包含钱包与直接消息schema6。原专职reviewer已接受b94febb→7b748ab固定全批，WM-CR01—08全部关闭，无未结实质发现。纯Git归档typecheck与87项核心检查全部通过、无skip；fresh schema6副本保全已核对。该接受仅属钱包／信箱基线，PG另审。
- 实施前8789为adae355／PID9859、原SQLite schema5／20表。最终停服后一致快照先经受审流程离线迁至schema6／catalog4，再转换PG；最终结果见第6节，未中途发布两个竞争版本。
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

## 5. 实施过程与分阶段证据

本节按实施顺序保留各时点状态；最终运行／接受／交付结果以第6节为准。

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


### 后继固定与仍待交付项

- 原reviewer R13接受A e74f0cc＋B f1281a2关闭PG-CR06；原503反例与修后真实应用1/1均保留。R14接受B8219437事务内按需点读缓存及B2d7742e pending recovery SQL，当前真实最小app存储27/27无skip。缓存不跨请求或重试，仍用原250ms业务读取预算。
- R15接受C4d561cd关闭PG-CR08。最终fresh流程明确为停止一致schema5副本→新schema6副本→由冻结7b精确manifest验证后产生另一catalog4／guide4副本→闭门PG转换。合成同shape输入闭门ready／health200已实际1/1。最终保全须核原20表中除schema_migrations／perception_catalog外18表（含instance_state）、原迁移1—5原样追加6、旧catalog除current保持，不把三个集合混称全部旧表不变。
- A47863e42／f0c7d83将邮件、恢复和关联配额接具名SQL计数／存在性，CR07原作者旧email文件反例2/2失败、修后2/2通过，待原reviewer最终复核；旧反例是loader仅替换d06 email-onboarding，其余新fixture／端口保持，不能写成整套旧d06源码运行。CLI显式PG目标3026f151及测试b136f3b已固定并整合；最新核心39/39、无skip（config／proxy16、m1-service12、AgentManager8、quota2、unknown_commit1），普通证据为API outputs/pg-async/verified-core-final.log。
- C777d4ab固定必要E2E异步fixture／端口接线；tests/site由B独占改造。桌面钱包4故事首轮1过3失败，涉及背包、缺失钱包和正文返回控件，作者正在按真实HTTP定位，原断言／预算未放宽；尚不构成交付通过。原owner-read矩阵中被新钱包默认分类替代的旧项目与本次选择项目分开记录，未跑不记通过。
- 原7b同Node的CLI＋integration29项15过14失败已实际对照，其中旧CLI协议失败1、integration旧setup载荷400共13项；候选相同14失败逐项对应。扩展API四文件40项1过39失败与同7b逐项相同（其中原三文件30项1过29失败）。INT02本次四并发曾出现3成功／1 retry_same_operation；原payload及operationId顺序恢复后仍唯一Agent，内部最多3次保持。该测试语义调整仍单独交原reviewer判断，不因改后PASS自动接受。
- C原basebackup／pg_verifybackup＋后续WAL实际测试证明两条sentinel恢复；全量迁入业务行／metadata／历史canonical字节和digest的恢复对账尚待补齐，已派原C以最新固定B2d和C4d的新隔离目标完成。正式connet仍未导入，原8789／SQLite／identity未切换；PG最终固定整合、原审及必要桌面和恢复证据完成后才执行fresh cutoff。


## 6. 最终本地交付回执（2026-10-20）

本批已完成本地PostgreSQL交付。原专职reviewer在[独审第30节](../validation/postgresql-local-code-review-2026-10-20.md#30-r28-最终固定接受7b748ab--6947c4d)接受 `7b748ab94ff944e3c54f98b8a112d0a3a7727791 → 6947c4d7988396239cec9d37987e21b530a3a09e` 固定整合，PG-CR01—09全部关闭、无剩余实质发现。该接受与后续独立普通UI／原Agent验收分别成立，不表示整个WS02完成。

### 6.1 正式运行与维护窗口

- 运行源码 `6947c4d7988396239cec9d37987e21b530a3a09e`，PID `78821`，Node24.16.0；固定372 tracked文件的交付归档位于 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/postgresql/user-8789-pg-delivery-20261020T063818Z/source`。新依赖使用独立 `outputs/postgresql/dependencies-38d0de3/node_modules`；旧运行快照引用的integration/node_modules未替换。
- 本地入口 [世界](http://127.0.0.1:8789/) 与 [主人](http://127.0.0.1:8789/owner)。正式 `connet` 在专用PG18.6／`127.0.0.1:15432`，运行角色connet_app，schema signature `59dc5807e115be48fc4e36e3c74d1a3a96c84051d207805cf9724f6345a4eb71`。不是另换QA库／identity；容器／卷／镜像沿本轮隔离实证的固定配置。
- 原8789／PID9859先核对cwd与唯一数据库持有者，再正常SIGTERM，监听及原SQLite所有句柄归零。维护从北京时间 `15:04:14.488` 至 `15:08:43.315`，共 `268.83秒`（4分29秒）；新进程先闭门启动，完成只读health与静态字节后才明确开门。
- 开门初始write_generation=1；不是recoveryEpoch变化。原实例仍 `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`，identity仍原data路径且hash不变。health返回200及原实例；首页／owner／本批变更资产共10个public响应与固定源码字节完全相同、no-store。TD未提交真实账户／邮件，未借原owner或Agent凭据发认证请求，未做浏览器用户动作。

### 6.2 fresh cutoff、完整保全与实际内容

正式数据取自本次停服前live、停服排空后stopped两份一致SQLite backup及配对identity。未复用早期820行演练副本；本次fresh数据碰巧仍为同数量，不以数量相同替代来源证据。live→stopped表指纹无变化，integrity_check=ok。

原schema5／20表的stopped副本经新schema6副本、冻结7b manifest核验后的新catalog4副本，再导入正式空connet；23源表、820行完整id／version／字段回构差异0，140历史文档canonical／digest保持，写门始终false。闭门真实app build／ready／health200前后全部21逻辑表和守卫均未改变。

- 原18表（含instance_state，明确不含schema_migrations／perception_catalog）逐行不变；原迁移1—5完整保留并追加6。
- 原catalog共102行，除current外101行保持原字节／版本，追加精确版本后151行；当前schema4／guide4，revision `catalog-r03-20261020-e29b7a68-schema-3-schema-4`。
- 原identity原件与各阶段配对副本完全相同，SHA-256 `f950f2a9d4df36be1b982160bc9ca76ff607d9c124fdc0cef4ad9d8a8729170d`；原Agent、主人、绑定、凭据及recoveryEpoch保持，没有重发身份或旋转凭据。

切换时实际内容：原小序Agent `93d85e90-1f5d-4699-8331-4a763d0f94d2`；Agent／主人／绑定各1、credentials14、operations29、facts29；星币账户1且真实余额0；直接消息0、直接receipt0；对象68、grant45（holding14、旧delivery31）、原确认state3、read sessions12、access462。对象来源包含物品14、旧通知内容31、公告2、地点16、事件计划2、发生项2、规则1；旧对象的历史 `mailbox.message@1` 类型不等于新的直接消息表。演示内容仍只是持久化演示，不推为真实经济／真实Agent行动。

### 6.3 备份与恢复边界

正式转换后、开门前完成新的physical basebackup及pg_verifybackup、WAL归档411文件、connet logical dump、role globals、原identity及私有运行／应用配置保全。实际备份用时72.14秒，完整私有备份在下述交付目录的 `physical-backup/`，不是离机灾备／HA或生产RPO／RTO达标。

恢复能力另由C固定ab76f60在最新59dc schema的独立目标真实验证：basebackup＋WAL恢复至新network-none／无host port容器后，14 schema内57张typed／child／metadata表、2128物理行全列稳定hash、140历史canonical文档／digest及配对identity均匹配，1/1无skip；源是已审7b预升catalog4旧副本，明确不冒称本次fresh正式备份又恢复了一次。CR08的schema5／catalog3→闭门PG链、正式fresh逐行对账、正式basebackup verify分别补齐不同边界。

现在已开门，任何新增持久写（含session／access）都必须保全当前PG全部提交并在PG侧修复；不能切陈旧SQLite或回灌旧副本。原 `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite`、配对identity、旧快照／storage／ignored outputs均保留；无reset／清缓存／清库。

### 6.4 工程结果及证据归属

- 纯Git9acc8cd归档的235项组合实际为182过／53失败、skip0／cancel0，exit1如实保留；53个用例与同Node原7b的39个旧API＋14个旧CLI/integration失败逐项名称及code／actual／expected／operator完全一致，新增失败0。唯一标题alias SQLite connections→PostgreSQL pools明确记录；不称全套全绿。
- 6947相对9acc唯一变化是已审的滚动.node.ts测试等待；全部372文件hash核对、生产与235组输入逐字节不变，两归档完整typecheck均0。末版滚动测试保留2px／5000ms，准确3dd来源同次四桌面故事4/4无skip；先前c415的3/4及更早503均原样保留。
- B准确c415：PG存储28/28、site/provider/HTTP48/48；C转换等12/12、旧实际分页1/1、WAL探针1/1、catalog准备1/1、选定原owner-read1＋2、服务SIGTERM生命周期1/1、全业务恢复1/1，各按其固定来源，未合称原全部矩阵／手机通过。
- TD独立真实loopback HTTP容量：冷ready/listen24.51ms，10次health p9516.93ms、list38.78ms、detail16.89ms；5波×4并发20次全部200，无客户端补重试，p95736.39ms／max797.22ms。原250ms内容准备预算未改；只属当前小数据本地指标，非生产SLA。

运行交付目录（0700，私密文件0600）为 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/postgresql/user-8789-pg-delivery-20261020T063818Z/`。关键安全证据：`source-manifest.json`、`maintenance.json`、`server-process.json`、`cutoff/live-evidence.json`、`cutoff/stopped-evidence.json`、`fresh-cutoff-preservation.json`、`closed-readiness.json`、`delivery-aggregate-counts.json`、`physical-backup-result.json`、`public-byte-verification.json`、`write-gate-open.json`；conversion／backup private manifest与秘密不复制到公开文档。归档测试／容量／hash证据在其上级 `candidate-9acc8cd-*`／`candidate-6947c4d-*`。

main已从b94febb fast-forward至6947后交付。main-protection-20261020T070019Z保全710个非目标脏路径及index：709未变，reviewer并行更新的1份报告保留前后版本，staged patch不变、revert0；备份在integration `outputs/ws02-wallet-mail/`。后续仅本执行记录／原独审报告的归档提交不改变运行源码。公网、8799／8801／8787／8846、真实邮件／移动端和后台触发未扩大；原UI与原Agent独立窄验收已交回总指挥调度。
