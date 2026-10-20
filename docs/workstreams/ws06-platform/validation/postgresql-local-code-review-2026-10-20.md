# PostgreSQL 本地实施独立代码审查

2026-10-20。稳定 reviewer：「M1 后端独立代码审查」`01a13916-02fe-7e90-8881-972aba227d8d`。PG 本批另立报告，不改写已接受的钱包／信箱 `b94febb → 7b748ab` 及 WM-CR01—08 全闭结论。

**最终结论：接受钱包基线7b748ab94ff944e3c54f98b8a112d0a3a7727791 → 冻结integration 6947c4d7988396239cec9d37987e21b530a3a09e的本地PG固定全批。PG-CR01—09全部关闭，无未结实质发现。114文件组合静态覆盖、372文件manifest及最后仅测试后继均已核对；9acc纯Git归档235项为182通过＋53项与7b精确对应的已知失败（exit1、无skip/cancel），不称全套绿。PG存储28／site-provider-HTTP48、独立HTTP容量及最终同版四桌面4/4、旧token／完整typed恢复分别按实际来源通过。此接受允许TD依既有授权推进fresh cutoff与本地8789交付；不表示原库已迁、正式connet已导入、8789已切、全部WS02完成或公网发布通过。最终证据及数据保全边界见第30节。**

## 1. 已批准依据与 reviewer 边界

已读 [PG 主案 v0.2](../architecture/postgresql-jsonb-proposal.md)、[唯一技术附录 v0.2](../architecture/postgresql-jsonb-technical-appendix.md)及 TD integration 的唯一执行合同 `docs/workstreams/ws06-platform/development/postgresql-local-delivery-2026-10-20.md`。用户已批准本地自管容器、完整隔离验证及成功后的 8789 统一切换，不沿用旧待审核门禁、不新增重复人类批准；本次不直接修改公网。

审查范围为已冻结 M1／M2＋wallet／mail schema6 的 23 表，不前置未来交易、完整人类档案／reader-state 或插件模块。重点为真实 async／await、正式分域列与具名仓储、SQL 下推、同 client 短事务和当前权限守卫、有界整事务重试、unknown COMMIT 原操作恢复，以及逐字段无损转换和新写后恢复边界。按合同允许初期保守实例守卫，不以细粒度锁优化另设门槛。

本 reviewer 仅静态读固定 Git 对象、批准文档和明确提供的脱敏普通证据；不读浮动 WIP／private-local 秘密文件值，不执行项目代码、测试、Docker、SQL、DB、HTTP、服务或原库操作。不访问真实 credentials／identity／8789；作者修、原 reviewer 固定复核。工程实际 PG、普通用户 UI 与独立 Agent 手动 HTTP 的证据分别成立，历史 29 个同基线失败不得改写为全套通过。

## 2. R1 运维固定范围：7b748ab → b408e41

- base：`7b748ab94ff944e3c54f98b8a112d0a3a7727791`。
- target：`b408e41b8f9e68eb4e9dd3f003dd3607197b4bde`，直接 parent 为上述 base，标题 `feat(ops): provision isolated pinned PostgreSQL runtime`。
- 九文件、280 行新增：ops/postgresql 下 compose、config、角色初始化与 env 样例；scripts/postgresql 下 runtime、local、database；两项 operations-runtime 测试及 docs/operations/postgresql.md。
- 固定 `git diff --check` 退出 0。完整九文件已静态读，不把后续 create/drop fixture、转换器或备份恢复 WIP 纳入 target。

### 2.1 PG-CR01 · P2 · Compose 继承环境可绕过已校验的 runtime 配置

位置：`scripts/postgresql/runtime.ts:35–40`、`:53–54`；调用前校验在 `local.ts:17–18`；实际插值见 `ops/postgresql/compose.yaml:4–5`、`:13`、`:33–42`。`local.ts:22` 另把配置 image 当状态 image 返回。

触发：runtime.json 及其 compose.env 合法且已固定 digest／端口／project／privateDir，但启动进程继承另一次操作留下的 `CONNET_PG_IMAGE`、`CONNET_PG_PORT`、`CONNET_PG_PROJECT` 或 `CONNET_PG_PRIVATE_DIR`。readRuntime 只校验 JSON，up 只探测 config.port；compose 通过 --env-file 读取生成文件，却未向 spawn 显式绑定这些经过校验的值，run 默认继承整个 process.env。

Docker 的 [Compose 插值优先级](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)明确 shell 环境高于 --env-file。因此例如环境中的 `CONNET_PG_IMAGE=postgres:18.6-trixie` 可把已校验 pinned digest 改回浮动 tag，或令实际监听端口与预检端口不同；project 与 privateDir 也可把实际容器／卷名或 secret 挂载改为另一组值。显式 --project-name 只固定 Compose 项目名，不覆盖 YAML 内这几项插值。该结论为固定源码＋官方规则推导，reviewer 未运行此反例，也未读取当前宿主环境值。

影响：固定资源／版本及保护端口的检查与实际动作不是同一个配置。即使没有恶意输入，环境残留也能使编排偏离选定 runtime；返回状态的 image 又来自 config.image 而非 inspect 的实际 image，无法据此发现偏离。当前脱敏 healthy 记录不覆盖这一负例，不据该问题断言实际容器已经用了错误镜像或资源。

最小修订：把已校验 RuntimeConfig 的编排变量作为显式子进程环境传入，或采用不会再被继承 shell 改写的受控模型；同步验证实际 image／端口／资源身份与该配置一致，状态应区分观测值与期望值。不要改用户全局环境／当前 Docker context，不通过打印 secrets 调试。

必要定点：在隔离测试中设置冲突的四个环境变量，验证编排解析仍精确使用已校验 digest、端口、project／volume 及 privateDir；不能变成保护端口或另一秘密目录。可先用受控 spawn seam／只读 Compose model 检查，不需操作原服务。另验证 status 对实际 image 不匹配明确失败或准确报告，测试不得只断言 runtime.json 的期望值。原作者给固定后继，由本 reviewer 复核。

### 2.2 本轮静态成立的边界

- Docker helper 显式 --context colima-agents-era-pg，未调用 context use；project 前缀、digest 格式及新建时端口有约束。compose 的宿主发布地址固定 127.0.0.1，卷挂 /var/lib/postgresql，stop 只正常停止，不含 down -v／prune；PG-CR01 单列其插值绕过。
- init 新建 0700 目录，secret／连接文件以 0600、wx 生成，四角色密码独立随机且不放 compose.env；CLI 错误不输出秘密配置。psql 的密码由私有文件经环境读取、作为安全引用参数使用，没有放入命令参数或开启 xtrace。本 reviewer 未读任何实际秘密文件。
- PostgreSQL 管理、DDL、运行 DML、只读备份／复制角色分开，app 非 superuser／createdb／createrole／库 owner；search_path 受限，PUBLIC 的数据库访问／public schema 创建权限收紧。正式业务 schema／DML grant 尚待存储固定实现，此处不称权限矩阵已验收。
- database.ts 仅允许具名隔离库前缀，名称无 SQL 插值逃逸字符；只 CREATE 新库，既有库报错，不 DROP／重用。不把新库／连接文件准备当作事务式业务导入完成，也不纳入未固定的 fixture 回收 seam。
- 配置含本地连接上限、UTC、SCRAM 和 WAL 归档初值；同卷 WAL 不是离机灾备。操作文档明确生产 TLS／容量／保留、basebackup／WAL 和实际恢复后补，不宣称已经恢复演练或支持新写后直接切旧 SQLite。无应用／邮件／Agent 启动或公网部署入口。

### 2.3 脱敏证据与未验证范围

只读 `m1-acceptance/outputs/postgresql/environment/runtime-status.json`（SHA256 `28388582a245abbd922ed8c5ea89028cd87be16a454f52e26a793d6337a9e346`）：其记录 context／project 为 colima-agents-era-pg／agents-era-pg，running=true、health=healthy、宿主端口 127.0.0.1:15432，命名卷 agents-era-pg-data 挂 /var/lib/postgresql，四个只读 secret bind 和配置／初始化脚本 bind。image 字段记录固定 postgres:18.6-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336，但按 local.ts 源码这是配置值，不能单靠本 JSON 证明实际容器 image。TD 另回执实际 PG18.6、角色分离和原服务未动；reviewer 没有主动查 DB／容器。

作者回执 runtime 2/2、typecheck／diff-check 0。已读测试源码：它们验证文件权限／不覆盖同一目录、独立随机秘密、project／image 格式、保护／占用端口，未测试 Compose 环境覆盖或观测 image。没有提供本轮测试日志路径，故只记作者回执，不改称 reviewer 实测或实际角色授权验证。

**R1 暂不接受，PG-CR01／P2 未关闭。** 容器健康与本机编排仅为当前窄范围，应用真实异步链、分域 schema／codec、23 表转换、事务／未知提交、备份恢复及最终整合随后按各固定差异审查；普通用户 UI／Agent 验收及最终 cutoff／写门／运行回执另记。

## 3. R2 初版分域存储固定范围：7b748ab → 38d0de3

**暂不接受初版存储，新增 PG-CR02—05；本节为静态审查，不把初始 DDL／0、null smoke 记为完整迁移通过。**

- 全差异 base：`7b748ab94ff944e3c54f98b8a112d0a3a7727791`；target：`38d0de3296c49a81139a3debec037a6079f360b6`，parent e6273eb6269a1864167660a6e6c1d8fe24b655f2，标题 `feat(storage): establish typed PostgreSQL schemas and async conversion seam`。
- 十文件、683 行新增／23 行删除：两个 contracts 文件、五个 infrastructure/postgresql 文件、SQLite 的 legacy 类型 import，以及 package／lock。两个 contracts 与原 A 固定 eef4d462bcb175373523e85f399def6e85607f7c 字节一致，独立比较退出 0；不误称 38d 的直接 parent 为 eef。
- 固定 diff-check 退出 0。十文件已静态读，含 pg／@types 8.23.1 锁定解析及完整 codec／迁移／事务接缝；本批没有存储测试源或应用 async 后继，不读取其他作者在写实现。

以下 38d 行号均指这个 target。冻结业务源的对照为已审 7b748ab，不把其同步 application 当成已完成 PG await 改造来审，也不因中间端口提交无法单独交付而把其余 WIP 判失败。

### 3.1 PG-CR02 · P2 · 新消息授权版本 hash 被整数列／codec 拒绝

位置：`apps/platform/infrastructure/postgresql/model.ts:49`，`codec.ts:7–9`、`:38–39`；冻结业务源 7b 的 `perception-service.ts:222–223`，hash 语义见其 mailbox/repository.ts:10–11。

7b 的 WM-CR08 已把新 direct-message 的 grantVersion 改为 string hash，旧通知仍使用 number，缺 grant 则 null。38d 把 read_sessions.grantVersion 与 offset／contentVersion 一起定义为 integer，DDL 为 bigint；encode 会经 safeInteger 拒绝非十进制 hash，decode 也只返回 number。

触发：对一封有效 direct-message 读取需要续段的正文，或取得最终 completionToken；业务必须持久化带 hash 的 detail／completion 会话。即使消息表／投递已正确转换，写这条会话也会失败，无法完整读取／确认。迁入仍有效的同类会话同样会被 validateSnapshot→encode 拒绝；不能靠原副本恰有 0 条新消息就认为兼容。

最小修订：以正式列／受限类型标记表达当前 number|string|null 合同，并确保原值类型无损往返；不把授权 hash 强转数字、不丢字段，也不退回 receipt 行版本重新引入 WM-CR08。list.grantVersions map 的值及正文／完成会话须使用一致语义。

必要验证：真实隔离 PG 完整读取／确认新消息，覆盖分段／完成 proof、冻结后纯确认继续及撤权拒绝；同时迁入／回导旧 numeric grantVersion、新 string hash 和 null／缺失四种形态，旧通知确认不变。TD 已提示这一类型风险，本节为 reviewer 从固定定义与冻结合同独立确认。

### 3.2 PG-CR03 · P1 · 新迁移目标默认开写门，未形成安全的切换前关闭状态

位置：`apps/platform/infrastructure/postgresql/migrations.ts:33`、`:86–89`；业务门使用见 `postgres-store.ts:116–118`，导入见 `legacy-codec.ts:36–44`。

新 instance_state 定义 writes_enabled DEFAULT true；migratePostgres 创建实例时省略该列，直接提交为 true。importLegacySnapshot 也没有把门保持／设置为 closed。当前固定接口没有要求显式开门的步骤或安全默认关闭保证。

触发：DDL／导入完成后，调用方按合同启动候选进行“业务写门关闭”的 ready 校验，但目标实际上已经允许 transaction。任何初始化事务或感知读取产生 session／access 等持久写，即可在最终 cutoff 对账／明确开门之前落入 PG。不能把 HTTP 名为读取当成零写入，也不能事后声称尚未进入 PG 新写后的恢复边界。

最小修订：默认闭门；迁移／导入／只读 ready 不开放业务写。由受控交付步骤在最终身份、cutoff、数据／恢复校验通过后显式开启并记录时点。若由 ops 负责闭门，必须在受审固定组合中证明从目标可接入到 ready 全程不存在开放窗口，不能依靠文档约定或未来 WIP。保持 wallet store.read 的零持久写，必要的私有离线导入不等同业务开门。

必要验证：新建／重复 migrate、导入前后及重启均 closed；应用身份的 transaction 被拒绝且业务表／write_generation 不变，纯只读 open／health／wallet 可按合同校验；只有显式开门后才产生业务写，并能记录首个持久写边界。验证故障恢复不能误切陈旧 SQLite。TD 已指出默认 true，此处按固定实现保留未结，未据此断言原库已写。

### 3.3 PG-CR04 · P2 · 合法 discovery 分页的 snapshot 没有模型落点

位置：`apps/platform/infrastructure/postgresql/model.ts:49`，`codec.ts:52–65`，`legacy-codec.ts:21–24`；冻结 7b `application/perception-service.ts:135–142`。

7b discovery 在分页时持久化 `{query,snapshot,offset}`，snapshot 是当前冻结目录；续页明确读取 saved.data.snapshot。38d 的 read_sessions 模型列出 query／context／records 等字段，但没有 snapshot，splitFields 也没有对应关系或引用转换。codec walk 对未声明字段抛 Unmapped field。

触发：合法请求使用 limit:1 等需要续页的 discovery，首次准备 token 就无法保存；或转换副本中含此类尚有效会话时，validateSnapshot 直接阻断。初始没有会话／只测默认大页不会覆盖该合同。这里没有证据证明任何源行已被丢弃；当前是安全拒绝造成既有能力／完整迁移无法完成。

最小修订：为冻结目录会话的 snapshot 明确设计正式关系／有版本内容或可无损恢复的引用，并纳入 encode／decode／转换 manifest；保持旧 token ID、目录切点、顺序、偏移、到期及权限检查。不能删除旧 snapshot 或改成当前目录、把它放入永久万能 other/shadow 表，也不能把发现目录分页称为未实现的业务 snapshot/changes 功能。

必要验证：从冻结 SQLite 基线创建 limit:1 的实际 discovery 会话，迁入 PG 后以原 token 取得全部同切点声明并无重复／遗漏；目录／权限变化仍拒绝旧会话，新 PG 本身能创建同类分页。完整逐字段转换盘点须包含该实际 shape，不能只比表名／总行数。

### 3.4 PG-CR05 · P1 · 独立 DML 身份未获 schema／表权限，无法打开迁移后的 store

位置：`apps/platform/infrastructure/postgresql/migrations.ts:18–31`、`:75–89`；`postgres-store.ts:91–103`；对照固定运维 b408 `ops/postgresql/init/10-roles.sh:13–24`、`scripts/postgresql/database.ts:12–13`。

按已冻结角色分工，connet_migrator 创建各 schema／表，connet_app 只获数据库 CONNECT，既不是 owner 也不是 migrator 成员。38d 的全部 migration 没有 GRANT USAGE、表 DML／守卫权限或 ALTER DEFAULT PRIVILEGES；固定 ops 也没有代授这些正式业务权限。于是按合同用 application 连接执行 openPostgresStore，最先 SELECT platform.module_migrations 就没有权限，不可能正常打开 store。若 smoke 以 owner／DDL 连接完成，不能证明独立运行身份可用。

[PG18 schema 权限](https://www.postgresql.org/docs/18/ddl-schemas.html#DDL-SCHEMAS-PRIV)区分数据库 CONNECT 与 schema USAGE；[对象权限](https://www.postgresql.org/docs/18/ddl-priv.html)也不会默认把自定义 schema／表权限授予其他普通角色，守卫的 SELECT FOR SHARE／UPDATE 还需相应锁定权限。此判断结合固定角色／DDL 源码，没有主动登录 DB。

最小修订：在固定受审的显式部署／迁移权限步骤中授予运行身份所需的 schema、业务表／子表及守卫最小 DML；迁移历史可读但不由应用改写，开门／身份配置等管理操作不因给业务 DML 而无差别放开。仍由独立 DDL 身份迁移，不能改用 postgres／migrator 运行应用、给 app owner／DDL 或开放 PUBLIC 来掩盖缺口。与 ops 作者按实际文件归属分别修订。

必要验证：新的隔离数据库以 migrator 执行迁移／导入，以真实 connet_app 连接 open／read／transaction，在闭门和开门状态分别验证；app 能执行受权业务而不能 CREATE／ALTER schema/table、改迁移历史或冒充管理身份。对 quote／search_path、默认新表权限和 child 表也覆盖；不借管理员连接充作运行测试。

## 4. R2 静态成立的结构与尚未验收的部分

- 原 A async 端口与离线同步 legacy 端口分离，read／transaction／CRUD／close 返回 Promise，不以全库缓存包装 Promise；SQLite 本批只改类型 import。真正应用入口、权限谓词及具名域仓储的 await 完整性待 A 的固定后继，不能从端口签名推为已完成。
- PG model 按现有类型拆到各域，普通源字段映射到具名列，profile 内容、冻结行集、targets、policy 对象等有子表，原文／结构化内容分离；codec 拒绝未知 model／field，presence／null 元数据保留缺失与 null，不建立永久通用原始 JSON shadow。已有 FK／唯一／safe integer 范围和新 PG migration 历史有明确定义。此处不是全部字段／约束映射通过；PG-CR02／04 已证明有缺口，其余仍需完整 23 表真实 shape 往返及负例。
- 查询的已识别 scalar 条件、id／afterId 和 bounded limit 在 SQL 中，按明确 C collation 排序，参数化值未拼成 SQL；没有在 store 打开时把全表载入缓存。当前内部 find 仍可无界，正式列／子表的具名查询、必要列选择、所有授权条件及配额／计数下推须在最终应用组合验证，不能把该过渡通用端口当长期公开业务 API。
- 正常 read／transaction 每次同一 pool client；先短 RR 的实例 guard SHARE／UPDATE，再回调，写者推进独立 write_generation，不改业务 recoveryEpoch。该保守粒度符合当前合同。40001／40P01 完整回调最多三次，scope 结束标记失效，finally release；COMMIT 发出后连接结果不明转 unknown_commit 而不自动重放。没有据静态代码记权限竞争／断连／原回执恢复实测通过，相关 SQLSTATE、pool 排空及外发不得夹在重试回调内仍待实际反例和 A 代码。
- migrate 与 open 分离，open 校验模块 checksum 和实例；migration 一事务追加各模块历史／关系约束，legacy import 一事务写入并要求空目标，源 migrations 原行独立保留。export 在同一 RR scope 取数据，不触发邮件／seed。当前源时间／Unicode／JSON、未知 kind、精确文档 bytes、hash／排序及附件顺序都须由完整转换与重放对账，不用 DDL 成功代替。

TD 转述作者已经在隔离 connet_storage_tests 完成 DDL 和 0／null async smoke，完整存储测试／副本转换仍在进行。本轮没有提供固定存储测试源／正式日志，因此只记该回执，不称 typecheck／完整迁移或角色矩阵通过；更没有读取 private 连接或主动查询实例。

PG-CR02／03 与 TD 已提前指出的风险重合，本报告仍给出独立源码依据、影响和必要验证，不将 TD 自查代替专职 review。其他 WIP 不在本轮固定范围，后续修订按原作者责任、固定增量及最终组合复核；当前 PG-CR01—05 全部未关闭，最终 PG／切换结论仍未成立。

## 5. R3 fixture create/drop 窄增量：b408e41 → 10295aa

固定 target `10295aa6a56af11f832e7a7c4547defa0a85ee64`，直接 parent b408e41；仅 scripts/postgresql/database.ts 新增 18 行，diff-check 退出 0。**该窄增量静态接受，无新增实质发现；不关闭 PG-CR01，也不表示 fixture 实际回收矩阵已通过。**

创建仍拒绝同名旧库，在成功新建后查询实际 pg_database OID／owner，确认 connet_migrator 后写 0600 created-database.json；manifest 带 format、database、OID、owner、project、context。drop 函数读取私有 manifest、检查受控 connet_storage/application/rehearsal/test 前缀（不允许业务库 connet）、固定格式／owner 及当前 config 的 project／context，再查询当前同名库 OID＋owner 完全匹配才 DROP。没有 FORCE、终止其他会话、清卷或 CLI 任意 drop 入口；活动连接尚在则 PostgreSQL 正常拒绝，要求调用方先关闭自有 pool。

此函数以受控 RuntimeConfig 和私有 manifest 为接缝，未把 manifest 当调用者提供的身份授权；后续 fixture 调用方仍须每次独占新目标、只回收本次拥有资源并验证 finally。未提供本增量实际测试日志／矩阵，reviewer 没有执行 CREATE/DROP、读取连接秘密或查询 pg_database。原同实例 role／Compose 环境风险仍按各自条目，不用该新增回收函数宣称运行环境全部通过。

## 6. R4 存储后继：38d0de3 → d810498

固定 target `d810498ba292190f9c0950036e58771a1354ed90`，直接 parent 38d0de3；四个 PostgreSQL 文件（codec／migrations／model／postgres-store），56 行新增／19 行删除。已静态读完整增量，没有测试源／新验证日志。**PG-CR02、PG-CR03、PG-CR04 的原触发静态关闭；PG-CR05 未关闭，完整存储／组合不接受。**

| 发现 | 固定修订判断与未扩大的范围 |
| --- | --- |
| PG-CR02：授权版本类型 | 模型增加 authorization 类型，codec 对受限正安全整数及64位小写hash分支，DDL 用 grant_version_number／grant_version_hash 两正式列且 num_nonnulls≤1，解码按实际列恢复原 number／string；null 与缺失继续由 presence/null 标记区分。冻结 grantVersions 明细也限制 number/hash/null。没有数字化 hash 或退回 receipt row.version。原类型拒绝／有损问题静态关闭；真实 PG 新／旧消息、旧会话往返与 WM08 反例仍待必要定点。 |
| PG-CR03：默认写门开放 | instance_state 默认改 false；migrate／import／open 不自动开启。新增独立 setPostgresWriteGate，用当前 schema／identity 校验、同一事务 guard FOR UPDATE 明确设置 enabled 并推进独立 write_generation。原默认开门触发静态关闭；不能据此记 P4 已开／关门实测。运行角色不能获得管理开门权限的数据库授权仍属 PG-CR05；后续 A 启动不得在闭门 ready 隐式 bootstrap，待其固定代码另审。 |
| PG-CR04：目录 snapshot 缺落点 | 模型声明 snapshot，作为 read_session_catalog_items 有序子表拆分；collection_index 的 -1 空数组标记、顺序行及非数组元数据分开，解码按 ordinal 还原数组／元数据。仅允许当前目录十二个字段，不回流永久 other/shadow，不把 frozen discovery 与未实现的全业务 snapshot 混为一谈。原未映射字段静态关闭；原 token、顺序、偏移、到期、目录变化及精确字段无损仍待真实旧会话转换／新分页定点。 |

该后继还把 facts／access 的 actor/ref、读取 ref／agentRef 拆具名字段，history 内容递归验证到已知内容 model，补直接消息 receivedAt／stateVersion／audience 约束，严格拒绝把源数字字符串当 number；profile 内容／来源状态的结构列与原文补一致性检查。事件两类 history 直接命名，移除原循环改表名；这些变更不表示全部源 shape 已对账。

错误处理补常见连接中断的 unavailable 映射，close 在活动 scope 内拒绝以避免等待自身；原同 client／RR guard／最多三次重试与未知 COMMIT 路径未被放开。migrations 中仍没有运行 DML grant，PG-CR05 保持，不能用 DDL owner smoke 关闭。PG-CR01 的运维文件也未在此 target 改动。

本轮只是固定静态复核：没有把数字/hash／snapshot／闭门的改动当成真实PG测试通过，也没有使用作者仍在进行的测试或副本转换结果。需要按 R2 各条必要反例提供固定证据，再纳入最终组合；专门存储范围、A async 应用、C 运维／转换各守实际归属。

## 7. R5 PG-CR01 固定修订：596edb4 单提交

**接受该窄修订，PG-CR01／P2 关闭，无新增实质发现；不等于最终 PG 组合或角色／转换／恢复通过。** target 为 `596edb4682d01c3f0de2c042a43b3b80232143a1`，parent ec7ff6dd0988553a45df7d807d17feead776c9b0；本次只审该 commit delta 的 runtime、local 和 operations-compose.test 三文件 73 行新增／8 行删除。parent 已含其他固定依赖，未把其余 converter／backup WIP 当成该提交范围。单提交 diff-check 退出 0；d810 的固定 diff-check 另核对退出 0，补第 6 节元数据。

composeEnvironment 复制 inherited，不改调用者／全局；清理子进程 COMPOSE_*、DOCKER_HOST／CONTEXT 干扰，再显式设置当前 context 及四个已校验 config 字段。compose 把此 env 交给 docker→spawn，不再让 shell 同名值覆盖 --env-file 的实际资源身份。原保护端口／配置校验保留。

local 实际 inspect 容器，并 inspect pinned image 的实际 ID；runtimeObservation 分 expected／observed 比较容器名、Config.Image、container.Image 对固定 imageId、project／service label、端口绑定、命名卷及四 secret 的只读 bind 类型／路径。状态不再回显期望值冒充实际，mismatches 非空令 CLI 退出 1；running／health 另列，不把配置 matches 当作业务健康或迁移结果。

新增两项测试源码已读：一项以四个冲突 CONNET_PG_*、COMPOSE_PROJECT_NAME 和假 DOCKER_HOST 调用只读 Compose config 模型，断言实际 model 仍为固定 image／loopback 端口／project／volume／secret 目录且 inherited 原样；另一项读取真实 inspect 后先匹配基准，再仅克隆修改观测 image/ref 调用生产报告函数，明确 mismatch。后者是实际 inspect＋合成错误观测的函数负例，没有真的替换运行镜像，不改称错误容器实操。

只读 environment/pg-cr01-tests.log，两个新增＋原 runtime 两项共 4/4、无 fail／cancelled／skip。脱敏 runtime-status-cr01.json 显示 expected／observed 一致、matches=true、mismatches=[]、running=true／healthy，实际宿主绑定127.0.0.1:15432，context／project／volume 与原专用资源一致；reviewer 只读该报告的非秘密投影，未读 private-local 连接／password 值，未执行 Compose／inspect、重启或查询 DB。作者未重启且用户当前 context 未变为其回执。PG-CR01 的源码原因与必要定点成立，关闭；PG-CR05 及后续业务验证仍独立。

## 8. R6 PG-CR05 固定修订：596edb4 → 3373dbe

**接受该窄修订，PG-CR05／P1 关闭，无新增实质发现；不等于应用全链或最终 PG 组合通过。** target `3373dbe997ef009c1a5bbf86fe5c1d14ee45775f` 直接 parent 596edb4；permissions.ts、operations-permissions.test.ts 及操作文档三文件新增 73 行。完整增量及测试源已静态读，单提交 diff-check 退出 0。

显式维护步骤在正式 migration 后，对十四个固定 schema 授予 app USAGE 和业务／子表 DML，再撤销三张维护表的广泛权限，只给 module_migrations／legacy_schema_migrations／instance_state SELECT，以及实例守卫所需的 UPDATE(write_generation)。没有授予 schema CREATE、表 owner 或角色继承；应用无法修改 writes_enabled、instanceId、recoveryEpoch 或迁移历史。正式 connet 目标须维护者显式 --cutover，隔离目标仍受既有命名检查；启动／浏览器不会隐式代授权限。以后增加迁移表仍需维护步骤明确重授，不把当前步骤称为自动覆盖未来对象。

定点源使用新建隔离库、维护身份 migrate 和正式权限函数，再以真实 connet_app open／read／transaction。它验证闭门时 read 可用、transaction 回调未进入且守卫不变；raw SQL 的 CREATE／ALTER、迁移历史写、实例插入／删除及身份／epoch／gate 修改均按 42501 拒绝，app 调用开门助手也失败。维护者显式开门后，app 写 agents／profiles 及两个 profile_contents 子行并读回；维护者再关门后，app 删除被拒、守卫不变且读取仍可用。最终关闭自有 pools/store，由本次 manifest 回收自有隔离库。没有借 DDL owner 的连接充当应用验证。

已只读作者明确提供的普通日志 `m1-acceptance/outputs/postgresql/environment/pg-cr05-permissions.log`：1/1，无 fail／cancelled／skip，SHA-256 `a06769af795682addca35e17fae3ce94fc7faa157dd877e8065a4f188fa96d30`。reviewer 未执行测试或读取 private 连接内容。该证据关闭原运行角色无法打开 store 的缺口，并覆盖管理元数据权限边界；A 旧 registration smoke 的较宽 fixture 授权不能代替此证明，应用后续必要定点须使用该正式接缝。DB 内容不可变等另外约束仍按 B 固定后继另审，不扩写为本项通过。

## 9. R7 存储后继：d810498 → 0a50021 → 7b4608a

固定 `0a500218ff091146eaa5ef7314bb7ffdae2f4511` 直接 parent d810498，五文件 156 行新增／5 行删除；固定 `7b4608a599a296a088be51f40025442ed27e9fef` 直接 parent 0a50021，仅 migration 及 constraints 测试两文件新增 125 行。完整两增量、storage-fixture／storage-postgres／constraints 三份测试源已静态读，两次单提交 diff-check 均退出 0。**两窄增量静态接受，未发现新增实质问题；尚未收到普通完整日志，不将 TD 转述的 10/10、18/18 当 reviewer 已核验的实际执行结果。**

0a50021 把已发现的 email_attempts.emailVerified 映射成正式 boolean，以 IAM v2 加列及扩充 presence 白名单。v1 生成明确排除此新字段，保留已演练的旧 migration SQL／checksum；没有把 false 或缺失改为默认 true。scope 的 borrowed client 增加 error 监听以标记销毁并消费连接断开事件，finally 移除监听并 release(destroy)，bootstrap client 也有临时 error 监听。原 COMMIT 结果不明分支仍抛 unknown_commit、不重放 callback，40001／40P01 的有界重试条件未扩大。

7b4608a 追加 platform v2：对当前所有 immutable model 的版本化内容表安装 BEFORE UPDATE OR DELETE 触发器，raw DML 也按 23514 拒绝，并未修改旧 migration 字节。受审测试具体覆盖 documents、catalog_releases、items.content_history、mailbox.message_versions 的 raw UPDATE／DELETE；不据此称未来表／所有触发器排列都已实测。维护迁移身份与 app 权限仍独立。

测试源码包括：最小应用角色 DML／CAS／回滚与 write_generation；闭门纯读／epoch fence；RR 守卫先后两个真实并发方向；scope 逃逸／嵌套／close；独立角色拒绝 DDL／身份／gate／历史写。COMMIT 负例用本地真实 PG 协议代理透传请求，收到服务器 COMMIT CommandComplete 后切断 ACK，断言 unknown_commit、callback 一次、原 operation 仅一份回执；这是其测试设计，尚未以普通日志核验执行结果。约束源另覆盖 FK／active binding／fingerprint／operation 唯一、钱包 0／MAX_SAFE／非法界、profile 与 mailbox 子关系、源姓名声明、数字／hash／null／缺失授权版本、超过16KiB冻结行集、discovery snapshot 顺序、访问目标有序子表、未知字段／kind 整事务回滚。fixture 仅允许专用 connet_storage_tests 名字并使用明确提供的维护／应用 URL 文件；reviewer 未读 URL 值或运行 fixture。

这批新 session 往返样本为合成 shape，不能代替旧 SQLite 实际 discovery token 在转换后继续分页；PG-CR02／04 的完整应用反例、旧 token、副本全部23表字段对账、40001耗尽／池排空及完整恢复仍按后续固定证据成立，不能从单项测试代码推为最终完成。

## 10. R8 应用固定核心：00d3f7e → d06dd6d

target `d06dd6dea72c523c1e44bad8cafc019a27106733`，直接 parent `00d3f7ec5983d0e3b2e9326c6210c082d9da9760`；24个生产文件、2752行新增／1724行删除，含格式展开。只审该直接固定差异，不把7b以来已由B／C负责的依赖重算成A核心。固定差异及关键权限／事务／分页／外发链已静态核对，单提交 diff-check 退出0。**要求修订PG-CR06／07；两项是已批准PG迁移合同尚未完成，不误记为该commit新引入的旧业务回归。** 以下反例为固定源码推导，reviewer未执行。

### 10.1 PG-CR06 · P2 · 从随机ID前200行清理会饿死后面的过期会话

位置：`apps/platform/application/perception-service.ts:280–285`；具名仓储 `domains/perception/repository.ts:32–37`；容量检查 `perception-service.ts:293–299`。

cleanup 对 readSessionRepository.pageAll({limit:200}) 的结果在 Node 才检查 expiresAt，没有过期条件、游标推进或轮转。pageAll 直接 scan('perception_sessions',{},options)，PG scan 固定按 id COLLATE C 取前200行；会话ID为随机 ps_UUID。因此只要字典序前200项仍有效，其后已经过期的会话在每次请求都不可达。若某reader已有200个过期会话恰落在该前缀之后，countByActorId 仍数到200，新目录／列表／正文token继续503 storage_capacity，重复请求不会回收这些过期项，直到无关前缀会话也到期。直接parent已存在同样的200行未过滤清理；本项要求落实批准附录第157行的“索引化有界删除”，不是把旧风险误称该commit新引入，也不是要求后台调度。

最小修订：由实际所有者提供具名、SQL按 expiresAt／recordedAt 选择的索引化有界删除／过期批查询，并使用明确稳定排序；不能把“全表过滤”简单改成“永远扫描同一段未过滤前缀”。保留手动请求范围，不引入自动业务触发。必要定点：在新隔离PG建立200个排序更早的未过期会话，以及其后某reader达到自身上限的过期会话；调用真实清理入口应有界回收后者、reader可继续创建token，前者及仍有效续读内容不变。提供固定修订及正式应用角色的测试，原reviewer复核。

### 10.2 PG-CR07 · P2 · 邮件限额仍拉取全部历史并逐行查询

位置：`apps/platform/application/email-onboarding.ts:127–140`；`domains/access/repository.ts` 的 emailAttemptRepository.findAll，`domains/email/repository.ts:7` 的 findByPurpose。相同模式还见 `m1-service.ts:270`、`:447`、`:570–571`、`:656` 的限额判断。

每次开始验证先 findAll 全部email_attempts，再在Node按一小时过滤／计数；每次发送先 findByPurpose('code')取所有历史验证码job（没有时间界或LIMIT），再 filterAsync 对不匹配ownerKey的历史项逐一get其attempt以比较emailKey，最后才按一分钟／半小时／一天计数。PG内部find没有LIMIT且解码完整源行，这会把所有历史及加密payload送到Node，并形成随历史增长的串行N+1。相关记录没有历史总量上限，时间限额本身并不能限制旧记录数量。该工作还位于保守实例写守卫内，会阻塞其他读取／写入并可能耗尽statement／scope窗口；小规模registration smoke无法覆盖。

这违反已批准附录“查询下推：常用筛选和计数进入SQL、只选必要列、不整表传Node”，并非额外性能优化门槛。给通用find换具名包装没有改变其无界行为。最小修订：按既有业务语义建立具名SQL存在性／有界计数查询，把时间窗、sourceKeys、owner／同email关联下推；关联用正式列／JOIN且只取所需计数，不读取旧job正文或encryptedPayload。其余注册／恢复／邀请的长度配额也一并改为对应有界count／exist，不改限额数字或旧receipt语义。必要定点应有足量窗外历史、窗内临界值、同邮箱跨attempt／不同主人／source及边界时刻，证明结果与原业务相同且一次限额检查不再传回／逐条读取所有历史；使用正式connet_app和固定测试源。原作者修、原reviewer复核。

### 10.3 其他固定源码判断

入口await openPostgresStore／readiness；readiness与health用read，初始化目录独立为显式bootstrap。原identity文件只读且拒绝损坏／冲突／不安全权限，不重建身份；SQLite URL/path不继续作为运行兜底。创建服务本身没有隐式初始化写。wallet查询用read、绑定与原runtime认证都await，既有账户缺失仍报错，不补造0。

具名域仓储把表名／free filters收在内部接缝，应用不直接提供任意表查询；但PG-CR07的全历史查询不能因具名而视为完成。顺序async集合助手实际await谓词／投影；effectiveActions、恢复状态、当前绑定、来源状态／观察层、发件人披露、正文／列表续页、completion及receipt检查均在当前scope等待结果，未发现Promise真值放行。确认仍独立写原通知或本域delivery状态，mailboxReceiptAuthorizationVersion保持排除确认字段，跨页及completion继续比该hash。

命令await业务工作后同事务写receipt/fact，已有精确operation键／载荷重放先于新命令工作；unknown_commit对外使用commit_result_unknown，保留原键恢复语义。邮件只在短事务持久化intent／claim，真正sendResend发生在事务完成后，再另事务记结果，不在可重试callback里联网。固定seed／目录／管理员函数逐步await，保留显式来源与旧文档版本、幂等／不重启inactive grant的规则；这些静态判断不等于真实邮件或未交CLI通过。

## 11. R9 存储排空后继：7b4608a → 85427b4

固定 `85427b4d5db89cc7c68199dad38d53d7f6d2bca0`，三文件47行新增／6行删除，无新DDL。完整增量已读，单提交diff-check退出0。**接受该窄存储修订，无新增实质发现。** store在进入异步scope时记录已接受promise；close先拒新scope，再等待已活动及池内排队scope settled，最后pool.end，保留scope内close拒绝及重复close幂等。没有在排队请求完成前销毁pool。

新增定点以真实DB trigger抛40001，验证完整callback恰三次、原receipt／write_generation全回滚且之后store可用；这是实际SQLSTATE注入，不冒称所有自然冲突排列已测。poolMax1时持有一个读取、排队另一个后close，验证close尚未返回、新scope拒绝、旧两项均完成后才排空。钱包并发改为同一尚不存在账户的两请求，恰一成功／一拒且一行；另逐项核对七类旧对象落各来源域、holding／notification／direct message不混淆及约束负例。

作者明确提供的 `m1-storage/outputs/postgresql/storage-verification-85427b4/` 已只读：storage-tests.log为21/21、fail/cancelled/skip均0，SHA-256 `6303ec6ed4f9b8ff4ee8ff62b08642719a9a584313c8877f3b11f7a9072f43e0`；environment.json固定commit、PG18.6、127.0.0.1:15432／connet_storage_tests_v2、实际connet_app非superuser／不可建库及独立connet_migrator。targeted-tsc／diff-check两空日志hash均为e3b0c442…b855，元数据各记exit0。该21项包含第9节两文件的完整18项和后续新增三项，因此第9节“尚未收到日志”只保留为当时状态，现已核验其后继实际结果。reviewer没有执行测试／DDL／SQL或打开私有连接文件；该结论是存储定点，不是A全应用、真实旧token转换或8789交付通过。

## 12. R10 应用测试后继：c5d9050 单提交

固定 `c5d9050e6ad71f78adcd10bb4b3f131929982193`；仅10个测试／fixture文件1168行新增／938行删除，生产核心仍d06dd6d。固定测试增量、关键新fixture及config断言已静态核对，格式中性token比较确认四份WS02原测试主体保留、主要增加async／await（另数字分隔符／类型尾分号格式变化）；单提交diff-check退出0。**该测试增量无新增实质发现，不关闭PG-CR06／07。**

postgresFixture每例独占新库，维护者migration后调用337正式权限函数，真实app连接open；显式测试初始化后才提供应用，失败路径／finally关闭自有store/pools再依manifest回收本次库。配置改为合成私有URL／配对identity、不触碰原库；server测试保留真实loopback端口0、SIGTERM及同一隔离库重启；proxy断言仍覆盖直接peer、closest forwarded客户端及16KiB边界。闭门startup/readiness/health/wallet定点比较全部M1逻辑行和guard不变，另以app raw SQL验证DDL／迁移／gate／身份拒绝。

已只读 `m1-api/outputs/pg-async/focused-verification.json` 与其指定普通日志并核对hash：config-proxy-minimal-role-final.log为16/16、无skip，hash `8dce2699e5e61706daa81e3e6b4f8d2fc4a3893d7fcebb3c430b24676193af2b`；元数据注明底层B7b4608a。ws02-role-first.log为13/13、无skip，hash `bae0c40d24e2070f84b1327b7349c81c6528023b7c9754d63fde4f80cf8b3422`，原186个schema校验／9类详情／35文档摘要记录保留；该组实际基于B0a50021，不能写成已在7b或854重跑。core／focused typecheck日志为空且hash与元数据一致，作者元数据exit0；不改写为全项目typecheck／全API／CLI测试或真实用户UI通过。

剩余固定组合、全部应用／CLI与wallet-mail权限反例、真实副本和旧token继续、恢复／最终cutoff等尚未提交或仍由各原作者处理。本reviewer本轮只更新独审报告，不操作实现／共享治理／服务／数据库或替TD整合；PG-CR06／07原作者提供固定修订后由本reviewer复核。

## 13. R11 C转换／恢复单提交增量：dbfe32c、f6033bd

固定 `dbfe32c63e47341bfa85753e47c45d5443c29c8e`，parent `db0c73ab3f7b22d3543f7ffc1b1c6174a6e6dfc0`；九文件新增395行。固定 `f6033bd13f90eb3794bf46eaae3abf1c9abcc2bb` 直接parent dbfe32c，五文件216行新增／2行删除。两笔仅审各自delta，不把C依赖历史并入范围。完整新增工具／测试／模板及runbook增量已静态读，两次单提交diff-check退出0。**发现PG-CR08，最终cutoff链要求修订；其余窄转换／备份源未发现新增实质问题，不能推为最终业务恢复通过。**

### 13.1 PG-CR08 · P1 · fresh schema5副本只迁数据库版本，目录仍不能通过只读启动

位置：`scripts/postgresql/prepare-sqlite.ts:24–38`、`convert.ts:14–26`，runbook“最终切换仅TD执行”；接收条件 `apps/platform/application/bootstrap.ts:8–11`（A固定d06dd6d）。

prepare仅在新copy调用migrateDatabase，SQLite schema6原迁移只建wallet／mail表及账户初值，不升级perception_catalog。convert再逐行原样导入，也明确不bootstrap。A的readiness要求catalog.schemaVersion等于当前4。TD明确回执当前8789仍是schema5／catalog3／guide3；因此按当前runbook用当时fresh cutoff依次prepare→convert→grant→闭门buildApp，目录仍为3，buildApp会失败。早期已用受审7b离线buildApp形成catalog4的820行演练源，即使完全roundtrip，也不能证明这一最终fresh流程可用。本reviewer没有读实际8789或私有副本；实际运行版本／目录3来自TD回执，失败条件由上述固定代码独立确认。该发现与TD已指出风险重合，不把TD自查替代本源码依据。

最小修订：原C在明确新copy内增加显式、冻结到已受审7b目录规则的离线升级，先形成schema6／catalog4及所需精确guide／schema，再闭门导入PG。不能靠PG提前开门bootstrap、复用旧演练源或修改原库；不监听、不发码／登录、不seed、不调用用户业务动作、不重发身份。完整最终保全口径应分别核对：除catalog／migrations外18张旧表（含instance_state）不变；原迁移1–5逐行／checksum／applied_at原样追加6；catalog旧行除明确current升级外保留，并追加新精确版本文档。当前“仅schema准备”的18业务表（包含catalog，不含instance_state）不变是其自身阶段事实，不能挪作完整目录升级后的同一集合声明。

必要定点：从与最终输入同shape的schema5／catalog3／guide3副本开始，走新显式离线步骤、PG新空目标转换／正式授权，在闭门状态真实connet_app buildApp/readiness/health成功；验证18旧表、原历史、旧文档字节／digest、实例／epoch／credential／Agent绑定保持及源文件未写。不给未来真实邮件／移动端另设门槛。C固定后继及原reviewer复核前，PG-CR08保持未关闭。

### 13.2 其他转换静态判断与实际证据

readSqliteSnapshot只读源、query_only＋事务，检查23表精确集合、六迁移checksum、单实例／配对identity及quick_check；按BINARY排序读取严格UTF8与JSON对象，递归拒重复解码键。逐行保留raw JSON字节hash和独立语义比较hash，前后检查源／identity不变。comparison只用于对账，不替代旧canonical digest；历史guide/schema分别按旧canonicalDocument重验。prepare只接受新输出目录、只在新copy迁移，核对原业务行与原migration记录。工具输入前提仍是TD提供停止／排空后的SQLite backup一致产物，不能用它直接复制正在写入的单文件。

convert只允许loopback受控演练／测试库，正式connet另需--cutover；通过正式typed import一事务导入，拒目标重用，出错保留私有失败／隔离证据。成功仍validated-not-published且写门关闭，不自动发布。gate为独立维护动作，原identity与库守卫匹配，不由应用启动调用。临时snapshot／逐行证据均0700／0600私有产物，未建立PG永久原始行shadow；reviewer未读这些值。

已只读明确提供的 `m1-acceptance/outputs/postgresql/environment/` 普通日志：

- ops-conversion-verification-85427b4.log：12/12、无fail／cancelled／skip，SHA-256 `39470a06a5f613845c2ab7987d3d675be0a1ae4c24abb3bcb17b48109ebb649f`。其中新转换／schema准备／源快照7项，加既有Compose／角色／runtime5项；涵盖整批roundtrip、拒重用、未知kind／字段、SQL晚故障全回滚，不能写成12项全为新迁移测试。TD回执820行／140文档，该普通日志未打印这些计数；reviewer没有打开私有manifest去独立核验计数。
- migration-pagination-7b460.log：1/1、无skip，hash `094e59fd774f8a6fd0d3130c7cdcc70f81b3d5e3522a42f4cf4cb8279d55deda`。固定fixture要求冻结7b源码归档，以原7b真实API生成limit1 token及原runtime，在新PG迁后继续并比较完整顺序，同时新PG从首页完成。TD回执47项，日志未单列该计数。该实证补齐PG-CR04的实际旧discovery token物理迁移反例；不承诺有意目录升级后旧目录token仍有效，也不代表完整snapshot／changes。
- operations-backup-current-fixed-path.log：1/1、无skip，hash `f426d8b1cc69d23aef42fc666bbf2b1f2d0b83c69216f96a98a3e98d50f28708`；ops-typecheck-current-fixed.log为空、hash e3b0c442…b855，exit0为TD回执。TD另明确首次恢复因macOS临时目录未共享而Docker125失败并保留，固定测试改用本worktree自有shared outputs目录后通过；本轮只获后者日志，未将首试改记为绿。

### 13.3 备份／恢复窄范围

backup独立使用connet_backup进行basebackup／logical dump、管理身份导出globals，并私有保全runtime／实际脚本配置、角色secret、应用配置和配对identity；正式CLI强制identity／app配置，身份需匹配目标connet。pg_verifybackup后复制basebackup，追加显式WAL archive。私有目录递归0700／0600，拒symlink／未审tablespace；不得公开物理cluster备份。恢复先再verifybackup，新labelled卷／容器、network none且无host port，从base＋WAL回放，不挂原卷；清理核对project／drill标签，默认保留卷。

测试的实际业务断言是recovery_probe在basebackup前及之后各一条提交均恢复，另检查隔离网络、无port、identity备份文件字节和文件mode。它证明了该例后续WAL回放，不等于最终23表全行／全部历史digest／角色与运行应用的恢复对账。runbook已明确恢复后还须核身份／全行／digest／cutoff，不能只凭进程ready；最终fresh业务恢复证据仍待其正式交付。生产模板只准备责任人与离机／保留配置，RPO5分钟／RTO60分钟均明示未实证，本批没有公网部署／HA／自动调度。

## 14. R12 CR06／07合同与SQL先行增量

四笔均仅审单commit delta，diff-check各退出0：A合同 `14999922ed2e2499609bd01e5cfaf3c21c2c8eee`（parent b545d82）、B过期SQL `f1281a2dd37addc0306126391fe1f316e03d8ba4`（parent5d28882）；A合同 `9c231def92ef3b1cea432e0fcf9148db435f058c`（parent1499992）、B配额SQL `fb5f523f9e10dbf25f7bc781e489a4cae66ba668`（parent55bc705）。未把父提交组合历史当四笔独有差异。完整合同／SQL／新增测试已读，**底层窄增量静态接受；应用调用与真实应用反例未交，PG-CR06／07不整体关闭。**

RetentionCutoff仅允许perception_sessions.expiresAt或perception_access.recordedAt、受限安全时间及严格／含边界运算，SQL WHERE在ORDER／LIMIT之前。追加perception v2的recorded_at/id索引，旧session expiresAt索引继续保留，不改旧migration checksum。底层测试把200个排序更早live和200个后续expired分别写入session/access，确认选出过期后缀并保留live／边界／null／缺失语义，拒无关表／字段和非法时间。此时尚未审A将cleanup真正改接该能力。

QuotaCountQuery为四种固定域查询，不向调用者开放SQL／列名；SQL以SELECT1＋LIMIT的子查询返回计数。email attempts／code mail／recovery requests按严格createdAt>since，邀请码按active／owner／expiresAt>after；code mail相关性保持ownerKey相同或EXISTS关联同email的attempt，源key下推参数数组。没有SELECT*、to_jsonb、encryptedPayload或Node逐行回查；read wrapper也提供quotaCount。IAM v3／email v2只追加时间／来源／owner索引。测试含窗外200项带长密文历史、边界、跨主人同email、缺attempt、不同source、邀请码状态，以及拦截实际client确认一条count-only SQL、非法shape不发查询。TD回执24/24实际app，正式普通日志尚未提供，本轮不改记为已核验24项。应用是否正确选择时间窗、阈值和关联键，须待A固定后继，不能只凭底层计数通过。

## 15. R13 PG-CR06完整固定修订：A e74f0cc

**PG-CR06／P2关闭，接受该窄修订，无新增实质发现。** A `e74f0ccd836406e0c90511c5840898b185d18cea`，parent70fb5b28d5d9322c9fde12519f9dd776b5a7cc29；三文件41行新增／6行删除，完整增量及真实应用反例源已读，单提交diff-check退出0。它配合第14节1499992合同／B f1281a2，不把同parent的其他WIP纳入该commit。

cleanup现在调用具名access.expiredBefore与sessions.expiredBefore，前者recordedAt<保留边界、后者expiresAt<=当前时刻，均SQL先WHERE再限200；再按原version删除。原请求前清理及capacity内清理两个scope保持，不扩大后台触发。测试以真实应用／正式角色先取得有效items续页，写200个排序更早的live会话、200个较后的当前reader过期会话；另有200条恰保留边界fact与401条更后过期fact。修后请求成功，过期会话回收、live保留，fact因两次各200有界清理恰余1，原有效token继续200。

普通 `m1-api/outputs/pg-async/cr06-counterexample.log` 明确保留仅替换d06 cleanup函数、其余当前PG／fixture的回放503 storage_capacity失败，hash `aaafd3693a7e42acbde0eba582e5b3dbabc26576ee5514d3cd0e62fdf6c669b4`；cr06-fixed-second.log为1/1、无skip，hash `36ea3676e2e1e65ba2d7c5c6ad47ae48acee095bf5667d2a3ae23d960f6bbb0a`。不抹去旧失败，也不由命名推为全WS02通过。B `storage-verification-f1281a2`普通22/22日志与environment已读，hash `daa9869dfcd91cb312495ef57e27f1009587c44dea2da3ee14f9f337c4fca047`；实际固定f1281a2／connet_app、targeted tsc/diff元数据exit0、对应空日志hash均e3b0c442…b855。

## 16. R14 B事务内点读缓存及pending recovery SQL

固定 `8219437bfcb199dec306ee877017cf08b91a4ac5`，直接parent fb5f523；三文件51行新增／7行删除，无DDL。完整增量及缓存测试已读，diff-check退出0，**接受该窄增量，无新增实质发现**。缓存只在createPostgresSession内创建，scope在守卫成功后／每次重试另建；按需get／已查询scan/find行填充，不在open预装全库，不跨请求或重试保留。并发同key点读合并，含missing，返回structuredClone；insert/update/remove前全失效，generation防止旧inflight读重新填旧缓存。权限仍在持有原RR守卫的本scope内检查，未将缓存当跨页当前授权。测试覆盖零预加载、命中／miss合并、调用者改返回值不污染、scan/find回填、写后／失败CAS／删除失效、下一scope撤权可见，以及40001三次各从回滚后源值重新开始。

普通 `storage-verification-8219437`日志为26/26、无skip，SHA-256 `c55012e7d4f708a5335113ee04dcf22f7ca95250a220c40c3637a43265a69158`，环境固定8219437／实际app角色；两限定空日志hash e3b0c442…b855，元数据exit0。它也补齐第14节配额两项实际执行证据，不把此前尚未取得的24项日志改记成当时已读。TD另回执应用WS02曾有4项250ms预算失败，仍在原deadline下复验；26项存储通过不能充作应用预算通过。

后续合同 `ec049ba677596cff88eabee427efa6c22d42575e`（parent804554d）仅新增pending_recovery固定存在性kind；B `2d7742e5be11548e5bc758d71869e1526640d980`（parent d501b9dd1540cf0a95cfc1a318effc77a04bf678）三文件31行新增／1行删除，完整增量已读，B diff-check退出0。SQL强制limit1，把原recoveryStatus的当前owner／绑定／runtime／Agent、epoch／版本／active／过期条件等价下推EXISTS，并追加IAM v4 pending索引；没有按历史逐个get，也没有额外添加旧谓词不存在的业务条件。负例覆盖200个过期历史后一个有效请求及14种原谓词撤销／边界，保留原有业务语义。**底层固定修订接受，PG-CR07应用整体仍未关闭。**

普通 `storage-verification-2d7742e` storage-tests.log为27/27、无fail/cancelled/skip，hash `09a60c821de70bf1281481be747270e0ffe7eba634f04d0717598555cdd11711`；environment固定2d7742e、实际connet_app／PG18.6／专用库，targeted tsc/diff各exit0且空日志hash e3b0c442…b855。全部均作者执行、reviewer只读；不声称自然所有并发排列、全应用或最终组合通过。

## 17. R15 PG-CR08固定修订：C 4d561cd

固定 `4d561cdf6c2dbf3a032e416f5047ebec895cb9de`，parent a0c44691974a3d2295927a9fc19c4bf805fdc125；四文件144行新增／1行删除。完整prepare-catalog／31文件manifest／真实PG测试／runbook差异已静态读，单提交diff-check退出0。**接受该窄修订，PG-CR08／P1关闭，无新增实质发现。** 不以此提前接受最终fresh真实业务全行恢复或8789切换。

显式流程现为停止一致副本→新schema6 copy→另一新catalog4 copy→闭门PG转换。prepareLegacyCatalog先逐文件拒symlink并验证冻结7b SHA-256，再只对新副本执行7b buildApp.ready/close，没有listen／HTTP认证或seed。reviewer另以纯Git字节hash核对受审7b：manifest31项全部匹配、无遗漏platform TypeScript文件；没有执行7b代码或读取实际archive／私有源。runbook要求git archive固定7b并按其锁文件npm ci --ignore-scripts，不指向流动作者工作树。

升级后用compareSnapshots核对除catalog外全部逻辑表、实例与原schema6迁移历史不变；旧catalog除current逐项保留，限制新行为schema4／下一版guide／revision，核全部历史document digest与原源／identity字节不变。相对fresh schema5的18旧表集合、原1–5追加6及catalog旧行保全分别记载，已纠正原最终流程缺口，不借PG提前开门bootstrap。

真实定点由schema5／catalog3／guide3合成副本开始，包含旧guide／schema和合法fact，走实际prepare-sqlite、prepare-catalog、convert、正式权限，在真实connet_app闭门buildApp/ready/health200；确认guide4、原文档保全、不seed、源及identity字节不变。普通 `m1-acceptance/outputs/postgresql/environment/catalog-preparation-final.log` 为1/1、无skip，hash `b0cba5333d07143e4165591498d87006dfe2656c661bf7ad6cfb4b785cb650e2`。TD明确首次合成fixture的未知fact.value被codec正确拒，改用合法changed后才得到本通过；本轮仅有最后日志，未改称首试全绿。该新输入覆盖真正最终前置shape，与早期catalog4／820行演练的证明分开。

## 18. R16 PG-CR07应用固定修订：47863e4、f0c7d83

固定 `47863e42e608ddf543693cea2c6d0a0b3be691d7`，parent7843b8d581ec21d8022ab703fa22342f31cf5cf8；六文件117行新增／29行删除。补充 `f0c7d83b17a5d4434696b2d5dec8ed265a2a6309`，parent3026f15136048592c8e8cfc0448bde599f0252f5；两文件1行新增／5行删除。两笔仅审单commit差异，完整增量及pg-quota测试源已静态读，两次diff-check退出0。**接受该窄修订，PG-CR07／P2关闭，无新增实质发现。** 不把未交的最终组合／其余测试当本次已通过。

startLimit使用严格一小时、source30／全局1000的有界SQL count。sendLimit保持同ownerKey或关联同email的原语义，分别按一分钟1、半小时3、一天10、source半小时20及全局半小时1000计数；没有取历史密文或逐项attempt get。账号／Agent注册、绑定数量、fingerprint／用户名／邮箱／request存在性及有效邀请配额均接有界count／exist。恢复的owner一小时5、source一小时30／全局1000，以及当前pending由既有等价SQL检查；f0c7d83把取消恢复的effectiveActions查询也接同一当前pending谓词，不再查遍历史逐项验权。原具体请求的recoveryStatus／pendingRecovery守卫保留，取消命令自身权限／version规则不放宽。

meteredRead补转发quotaCount，使新增具名查询在包装scope仍使用原session／client。仓储只提供固定域形状，应用没有自行拼SQL；数值阈值、严格时间边界、已有精确operation载荷／receipt重放不变。原revocation与显式列表所需的owner／Agent局部行查询，不在此被改写为新的业务生命周期或另行扩大权限。

已只读明确普通证据 `m1-api/outputs/pg-async/cr07-counterexample-final.log`：2/2失败，hash `c302620844525dc8d912c3a82bbe27f6dc1c37514b350ce998260ee099793110`；分别命中emailAttempt findAll和mailJob findByPurpose的历史抓取阻断。TD明确该反例用Node loader仅换入d06旧email-onboarding，其余新fixture／typed port保留；源码栈也定位outputs/pg-async/email-onboarding-before.ts，不描述为整套旧d06运行。cr07-fixed-first.log为相同两项2/2、无skip，hash `b6f847d200fddec89e6110be5b60b247e1f95a09c5c75f1bdfdfd97ebbf7f6c9`。

测试使用真实最小app PG，加入250个窗外attempt及250份旧长密文job，以包裹真实store的观察器禁止相关find历史并记录quotaCount／点读；验证严格边界、临界source30、跨attempt同email／不同email、通知不计及原发送receipt完全重放。底层owner／来源／恢复等价性已有第16节27项覆盖。此证据关闭指定历史限额缺口，不能推广为所有CLI／API／WS02最终组通过；verified-core-final等尚未提供的结果不预写。

## 19. R17 显式PG行政CLI：3026f15

固定 `3026f15136048592c8e8cfc0448bde599f0252f5` 直接parent47863e4；四文件45行新增／66行删除，完整增量已静态读，单提交diff-check退出0。**窄CLI源码静态接受，无新增实质发现；未提供该固定CLI实际测试日志，不记CLI执行通过。**

共享administrativeTarget要求显式connection／identity／operator／新manifest路径，拒未知／重复flag、非法actor、非绝对路径、路径重合或旧manifest；连接与identity用现有private-file配置解析，open和只读readiness后才交行政函数。失败关闭store；所有业务调用／输出／close都await。不再隐式创建SQLite、迁移、生成identity或自动开门。seed仍是明确行政动作；owner observation在打开目标前检查明确source administrator／operationId，再按原来源声明与幂等合同执行；manifest为wx／0600，错误消息不打印URL／proof，保留原操作恢复语义。

QA fixture改为显式传入现有PG connection文件与配对identity，输出仍为新0700私有目录、0600证明；使用experience，owner／Agent创建及seed按顺序await，没有listener。它不再隐式替调用者新建数据库，调用方必须提供其已分配目标；第20节浏览器入口实际使用正式postgresFixture创建本次独占库，不借用户运行URL。reviewer未执行上述CLI／创建账号或读取任何证明文件。

## 20. R18 E2E隔离PG接线：777d4ab

固定 `777d4abeaedea281914741c03d8a1e6dccfc9a37`，parent866442b0b62dba5bf80a478a77d99affe9caf004；七文件76行新增／87行删除，完整固定接线差异已静态核对，diff-check退出0。**该接线源码无新增实质发现；不代表实际浏览器故事通过，TD当前失败回执保持。**

webServer及Node stories统一调用postgresFixture本次新库，不继承用户application URL／identity；仅显式loopback隔离端口，配置拒8789／8799／8801／8787／8846等保护口。run-e2e在每服务进程先取临时可用端口、复用原完整用例枚举／分片校验，不复用既有服务；app/listen与最后browser→app→自有PG fixture关闭均await。fixture mutations、source撤权、确认状态快照与断言都改为等待真实PG，不以Promise真值替代状态。保留背包14、通知20、撤权／空／网络错误、旧token失效和旧确认不变等原断言，未通过降低数目把失败变绿。

TD明确必要浏览器四故事当前1过3失败，涉及背包14实际0、钱包缺失预期not_initialized却unavailable、正文退出控件缺失；尚未交固定修订／普通完整日志，不能从该测试接线或存储27/27关闭这些问题，不借当前仍在WIP的排查材料预判根因。全量／移动端及独立普通UI仍各守原范围。

另TD提前指出INT02拟允许四并发首次503 retry_same_operation后，用原payload／operationId顺序恢复并核同一Agent。该最后测试提交及原7b逐项差异尚未固定，本轮不接受它，也不先判为违反契约。后续须分别核对：服务器每次scope仍最多三次整事务重试；客户端恢复只针对明确可恢复错误并保留原键／原载荷；实际成功的幂等结果／唯一Agent与receipt相同；不能将客户端补做成功冒称首次四并发均成功，或用无限重试吞掉其他错误。固定后再由本reviewer判断，不以“改后PASS”代替契约审查。

## 21. R19 INT02测试契约：96da989（其余测试见第22节）

固定 `96da98927f7ed9f2cd2c7135063e14f6f85736a3`，直接parent b136f3b09c88a611a02ae5566bda0f26a7ecd91e；六tests文件2635行新增／2150行删除（大量格式展开／await）。单提交diff-check退出0。已直接对照原7b与新INT02完整正文，不把该处当机械await；其余固定测试适配另记，不借整个commit标题接受所有差异。

原7b INT02要求四个同payload并发请求均经ok()返回200。新行222–241保留先提交但丢成功响应，再真实Promise.all四请求；只对503且error.code=retry_same_operation做一次顺序恢复，仍使用同一个payload对象，不生成新operationId／proof。恢复不是第四次内部重试，也没有无限客户端循环；unknown_commit等其他错误不被该分支接受。最后保留同一Agent、原continuation proof可恢复、换operationId仍冲突等断言。结合已批准“40001／40P01整scope最多三次、耗尽可返回可恢复失败”的合同，以及B独立27项中的确切三次回滚反例，**允许原键显式客户端恢复这一语义本身成立**；不能要求任何数量并发都必须首次200。

已只读int02-recovery-final.log：1/1、无skip，明示首次3×200＋1×503/retry_same_operation，后续原键恢复成功。该普通HTTP code本身不独立证明503只由某个SQLSTATE产生，服务器确切三次上限由另外的存储反例证明；不把客户端恢复计成首次四并发全部成功。整组那次四个均200亦只按当次事实，不能抹掉本次3＋1证据。

### 21.1 PG-CR09 · P2 · 新INT02首次200分支绕过旧成功响应验证

位置：`tests/integration/m1.test.ts:227`（96da989）；原成功helper在同target的`:76–87`，原7b INT02`:192`对四项均调用该helper。

新并发改为request后，首次200只执行repeated.push(result.body)，没有原ok()中的noSecrets、outcome===committed及receiptId类型校验。后续只比较agentId；因此并发200即使缺committed标记／receiptId或泄露原proof，也可能通过这个曾覆盖该边界的测试。允许503恢复不需要删掉这些成功响应断言。此发现针对新测试覆盖的实际削弱，不据此声称固定生产代码已经泄密或返回错误receipt。

最小修订：在已有200响应上复用原成功响应验证（或抽取共享校验供ok和这里调用），原token／password材料检查、committed及receiptId都保留；验证已有响应，不能额外重发来替换一次有问题的200。其余原键／原payload／错误种类限定和Agent恢复断言保持。固定测试后继交原reviewer复核；普通PASS日志不能单独关闭该项。

## 22. R20 应用测试组及固定证据：b136f3b、96da989、d1308b3

b136f3b09c88a611a02ae5566bda0f26a7ecd91e直接parent f0c7d83：四测试文件530行新增／432行删除；96da989直接parent b136f3b，范围见第21节；d1308b349e52997994631308bb8b995d105029dd直接parent96da989：六测试文件1069行新增／658行删除。三次diff-check均退出0。静态核对固定适配差异、关键fixture／fault／并发接缝，并以格式／await中性断言比较辅助确认旧业务断言保留；非机械INT02已单列，不用大范围格式变化掩盖。**除已另修的CR09外，无新增实质发现；不把仍失败的旧组写成通过。**

postgresFixture可显式不bootstrap，以新空PG目标构造旧目录并检查闭门readiness拒绝，之后单独显式bootstrap；测试指定实例／epoch现先传入fixture创建，不把新随机metadata覆盖成冲突身份。m1-service／Agent Manager原断言保留，异步throws改rejects、snapshot／CRUD／close都等待实际PG。恢复竞争由必须依赖worker实现的同步SQLite连接，改为同进程真正独立PG pools并发Promise.all；各pool独立事务，不是同一个已串行化内存port，仍核原终态谓词。

新增unknown-commit应用测试在真实PG已提交后于port层合成丢ACK，验证HTTP503 commit_result_unknown、不泄proof、callback一次，先查原scope/action/op receipt再用原载荷恢复、全行不再变且仅一份receipt。这是应用／transport故障接缝，不能冒称该项本身切断真实协议；真实COMMIT ACK切断属于第9／11／16节B存储测试。

WS02 legacyCopy明确从合成逻辑DTO生成离线SQLite schema4／5基线，不称执行过旧二进制，也不用于PG运行。原SQLite真实故障改成专用新PG库中的维护trigger，operation／fact／access等失败仍检查同事务全回滚。旧目录升级用未bootstrap新PG目标插入旧current／schema／guide；不删除已发布不可变行，不关闭DB immutable trigger。启动先拒旧目录且快照不变，显式升级后保全旧版本；新响应helper正确取data envelope。wallet／mail的版本不可变、域独立确认、owner各层／绑定／来源、sender撤名、预算以及WM-CR04—08实际断言保留，没有放宽250ms读取准备预算。

普通 `application-verification-final.json` 索引（head=d702140）已读，指定日志hash核对一致：verified-core-final.log为39/39、无skip，hash `a0b73c94e5b01493b191d6aa94360a081f08e78a0706ede305b405a6af5fe16e`；ws02-fixed-complete.log为57/57、无skip，hash `334b29fa6482322fe9f1491f57f4e01a92e6113ec549550d6fe03e7189aac662`。后者含新message数字／hash授权版本实际路径、完整正文／confirmation／WM08冻结页反例；结合先前闭门启动39组、C旧token迁后1项，补齐PG-CR02／03／04的对应应用定点。它们不是最终integration全套或浏览器交付结果。

已只读索引指定四份基线对照日志并核hash：API candidate api-baseline-groups-final.log、baseline-7b-api-groups.log均40=1过39失败，无skip；CLI candidate cli-integration-baseline-final.log、baseline-7b-cli-integration.log均29=15过14失败，无skip。逐条失败名称及日志中的code／actual／expected集合相同；不宣称错误消息／stack每字节相同，更不宣称全套绿。索引hash分别为 `7d138d3c6483e43a08a1d92c224d65ad00da554beff619b0539b08432b1659a4`、`125a441e37eed95a46322c0ba9e1a90de91bc975a68450484071550c2ef7ad04`、`ed1bb6252c0b9600656bc51e54f508a5435b87f79f5cd8d662c6056899a4f339`、`031e6b807c1f2bedf42d15ce2dac523f49103ffe9c0529f1aaa489699ad01fa3`。

版本归属限制：96da989的recovery-assistance固定标题已为“independent PostgreSQL pools”，而提供的candidate API日志仍记“independent SQLite connections”（同源码行244）。因此此日志确证的是所记录那次旧失败集合，索引整体head不能证明每份日志都执行了96da989完全相同文件字节；缺少该组逐日志固定来源的说明前，不将它改称exact96全部同版重跑。该限制不反推固定业务代码新增了39个失败，也不抹掉已实际通过的39／57组。

## 23. R21 PG-CR09固定补回：3c147b6

固定 `3c147b667af69dadfee79b69f964e32769540821`，parent d7021406da9aab270aac51b750df986bed3cfdad；仅integration/m1测试5行新增／3行删除，完整增量已读，diff-check退出0。**PG-CR09／P2关闭，INT02窄测试契约修订接受。** 原ok()成功校验完整抽为successful(result,method,url,payload,bearer)，ok和每个首次200共用；在已有响应上验无秘密、committed及receiptId，不额外发请求替换待验200。原键／原载荷／仅503 retry_same_operation／每失败一次客户端恢复及同一Agent／proof断言保持。

普通int02-success-assertions-final.log为1/1、无skip，hash `1be296e95ccbc79306185b61054cb05e96cef2805bda14d5bcb6c1ab0d1e64e6`，首次200、200、503、200，之后原键恢复；该来源未含B d590退避，不描述为退避后同版结果。服务器三次内部重试上限与此客户端恢复分开证明，不要求首次四并发必全200。

## 24. R22 CLI补齐与部分E2E后继

A `d7021406da9aab270aac51b750df986bed3cfdad`，parent d1308b3；仅manager QA fixture CLI六行增／六行删，完整窄差异及diff-check已核对0，无新增实质发现。候选和输出原路径检查保留，新增显式绝对connection／identity，沿原私有proof保存流程、experience配置及现有PG打开／await生命周期，不再传SQLite字段。普通qa-cli-smoke-final.log hash `69870faee1d5c9e5dda5bbe853f709d94dc5f8b730e78194c2b19b8827e5350d`，只记manager3主人／3Agent与WS02 prepared两个明确smoke，不把node:test的0tests改计成2项测试。A限定apps＋归属scripts/tests的typecheck空日志hash e3b0c442…b855，索引result passed，不宣称跨所有者全项目typecheck。

C `8b6f5db1cdf9261ff4a115ec2f0270892dd59464`，parent aedacd7edb49dfb8a640c9301400a4fcbbd407e0；三文件38行新增／3行删除，完整差异已读、diff-check0，窄增量接受。新的messages默认分类下，两个原通知恢复故事显式点“通知”，保留20条及原过期／拒绝清缓存断言；并未把新message当旧通知或删原断言。e2e-server就绪日志只报合成origin／新库名；生命周期测试启动真实子进程，SIGTERM后等退出0并从同专用cluster确认本次库已不存在，检查诊断无URL／密码，不操作原端口／库。

已读普通e2e-owner-context-pg.log 1/1（基于777）；e2e-owner-recovery-pg.log 2/2（基于f0应用）；e2e-server-pg-lifecycle.log 1/1，均无skip，hash依次为 `778bea736d9621b1ce63e9d897133311a67e69ea86977a3f35f93e682f480b11`、`32cdf400e3053d180ba972ea03e96e4461f5db6505a627ad8b7195f62b990a3d`、`04e0ba25a5eccebecaa41220d046c26454bb2f05d03cad7816a295d8b62f2681`。e2e-typecheck-final.log空、hash e3b0c442…b855、exit0为TD回执。不改写为原7故事矩阵重跑，也不据此关闭另外的必要四桌面故事。

## 25. R23 全typed业务恢复：C ab76f60

固定 `ab76f6056dd68a4d5489373762da0f704852f643`，直接parent8b6f5db；三文件新增76行，完整evidence helper／测试／runbook已读，diff-check0。**该固定全typed恢复增量接受，无新增实质发现。** helper仅允许隔离库／受控源与restore容器，按十四正式schema枚举所有BASE TABLE；一个只读RR内对各表全部列to_jsonb、明确C稳定行序作hash，核表集合／计数。历史document_text另验旧canonical digest及存储文本hash，实例／epoch／closed gate另验；原文只在私有进程／产物中，不输出聊天。

测试新库migrate／import后用正式codec回构源23表0diff，再取完整typed基准；basebackup＋WAL后再次检查源quiescent，隔离restore后逐表全列／metadata／文档／identity一致，正常按label／OID回收本次restore容器卷与rehearsal库，保留备份／私有证据。该测试未启动恢复后的应用／重跑其权限矩阵，57表是正式业务／child／domain metadata，不扩大称PG系统角色目录也逐列hash通过；角色globals／配置保全仍分别属于原备份步骤。

明确安全普通full-recovery-final-metadata.json与full-recovery-latest.log已读，未打开verification.private.json。固定C ab76f60、底层B2d774／签名59dc5807…，旧7b预升catalog4副本：23源表820行、57typed／child／metadata表2128行、140文档，全部matched；1/1、无skip、120.4秒，network none／无host port。log hash `8f75a936b25fed2ff5847095e3ec677631c961bd8c84ccb43982536d2eabe7db`，metadata hash `190fc801733030eeff5419c083161aa203fd1b0ba93fe35b3c71da770cc71368`。这是该来源的完整typed恢复证明，不是最终fresh cutoff；CR08最终输入shape链另证，正式connet／8789未因本测试变化。

## 26. R24 B有界退避：d5908d1

固定 `d5908d138d35b90d3c74e90c5dfeacde24432ff4`，parent08ec5999c0a82da76871505ef9c9e678cc22cd81；store及存储测试两文件18行增／3行删，无schema变化。完整差异已读、diff-check0，**该窄源码接受，无新增实质发现；不接受其为必要桌面并发问题已解决。**

仅对原40001／40P01且attempt<retries的整scope重试，在finally结束ROLLBACK／release后delay(randomInt(50,151)*attempt)，最多前两次150＋300=450ms；仍最多三次尝试，每次新client／当前守卫／新scope缓存。成功return或其他错误throw不进入delay；COMMIT不明仍unknown_commit且不重放。没有联网、后台任务或提高原250ms读取准备deadline；close继续等待已接受scope及其有限退避。

新增五波×四竞争scope测试保留20条实际fact及5秒p95窗口，原确切三次回滚／unknown-commit等存储测试仍在；TD回执28/28但准确普通目录当时尚未提供，不先记reviewer已读28项。明确诊断日志曾显示读／写40001及第三次耗尽后的discovery503，不能把所有source_unavailable都解释成deadline。TD另回执d590后必要桌面仍3过1失败，因此本次只接受源变化，不关闭实际交互问题；拟调后继或fixture顺序尚未固定，不预审WIP。

## 27. R25 最后退避与桌面fixture／HTTP容量：8ffe18b、c415237

固定 `8ffe18b069c59a42b5addde567dcfc27748b83f4` 直接parent d5908d1，仅store两行增／两行删；固定 `c41523710bb92b38c605a484ef798e6a232dc827` 直接parent8ffe18b，仅三个tests/site文件72行增／50行删。完整固定增量已静态核对，两次diff-check退出0，**两窄增量静态接受，无新增实质发现。实际exact HEAD证据及最终integration组合尚待提供，不先写正式交付接受。**

退避改为randomInt(100,201)×3^(attempt−1)，只可能在前两次失败后执行，分别100–200ms、300–600ms，总上界800ms。仍只有原40001／40P01且attempt<retries才进入；rollback／release先完成，每次重建当前guard／scope，成功或其他错误不延迟，unknown_commit不重放。没有增加三次上限、改持久化动作或放宽250ms内容准备deadline；该800ms是重试等待上界，不冒充整HTTP响应上界。

site fixture使用本次postgresFixture正式最小角色、私有配对identity，可信mailbox source的authenticate／authorize／观察policy都await；控制性余额／投递／撤权／确认快照／close同样等待实际PG，异常路径回收本次资源。原addHoldings13的合成准备从“尚在看旧背包时写、之后关闭”改为“先完成同一个returnToWorld关闭、再写、再打开”。该点原意是先准备27条持有关系再测试20＋7分页、选中项恢复及自由搜索不持久化，未承担在线撤权／晚到结果反例；最终观察前状态相同，未改27／20等断言或timeout。真正的来信／物品撤权、缺钱包、延迟跨Agent等反例仍在原可见时点执行，没有借此把撤权移到读前。因此该fixture顺序变化保留这条故事的测试意图。

新增真实loopback HTTP容量例先做实际身份／capabilities／discovery，再五波×四请求，不添加客户端重试；每项必须200、complete且14个物品ID与单次基准一致，计算20请求p95≤5秒，仍用默认250ms内容准备预算。它与底层五波scope压力例是两个证明，不能混计。TD回执同次四故事4/4、20/20 HTTP约755ms p95；当前未给exact HEAD普通目录，故只记回执。原d590失败、合成数据准备与页面读争guard的诊断均保留，不以本回执抹去。

下一步仅消费TD明确冻结的integration SHA及纯Git归档普通证据，核7b→该tree全部代码／配置差异是否已有固定覆盖、是否存在组合新增差异，再分别登记typecheck、核心业务、HTTP容量及桌面实际版本。当前没有读取浮动integration HEAD或运行服务／DB；最终cutoff及原8789仍由TD依既有授权办理，本报告不代执行。

## 28. R26 冻结integration组合：7b748ab → 9acc8cd

固定 `9acc8cdde5963d5e455655b40a92c7e9e770dd62`，372 tracked文件；相对原钱包基线7b共114文件、11129行增／6133行删。完整文件清单与累计diff-check核对退出0。**该组合静态覆盖完成，无新增实质发现；最终工程交付接受仍等下面明确未齐的实际证据。** 没有读浮动integration HEAD／作者WIP或执行归档代码。

逐文件Git blob核对113个实现／配置／测试文件全部与各责任作者已审固定tree一致：A 3c147b6覆盖58文件；B8ffe18b覆盖11文件；初版B38d0de3的package/lock／SQLite仅legacy import覆盖3文件；C ab76f60覆盖38文件；B site c415237覆盖3文件。差异数0，无手工组合新增字节。唯一另列的是TD执行合同，已读其固定95行及后继状态／边界；该文档按当时进度记录，不把后来完成的证据倒写为早期通过，也不把其旧待交状态覆盖本报告后续定点。root package／lock仍与受审38d相同，没有新增依赖或install脚本差异。

另直接比对c415与9acc的整个apps/platform，差异0。因此B exact c415的运行生产应用与本冻结候选同字节；仍分别标测试源码／源tree和归档组合验证，不把整套测试都改署9acc。TD提供纯Git归档 `integration/outputs/postgresql/candidate-9acc8cd`，完整typecheck exit0为其回执；candidate-9acc8cd-typecheck.log已只读，空hash e3b0c442…b855。最终核心／WS02／容量等正在此归档执行，尚未提供结果时不预写。

### 28.1 B exact c415普通结果

明确普通目录 `m1-storage/outputs/postgresql/final-storage-site-c415237/` 的environment／check-results、storage／site-provider-http／browser／tsc／diff日志已只读。metadata清楚分testedCommit=c415与当时currentHead=3dd、newTestCandidate.executed=false，没有用当前工作树HEAD冒充既有运行来源。

- storage-tests.log：28/28、无skip，hash `e78247a2b6c92bad1107f7bad299235f724bdcd9bd2e09295c25d7c16be9b012`；5波×4 scope共20，p95 671.39ms、max745.21ms；仍含精确三次回滚／unknown COMMIT／守卫／scope cache等。
- site-provider-http-tests.log：48/48、无skip，hash `400586ed2715700445f899c84f2686239b0984f4b1739c59c9da5a5442f4c077`。其中新增真实HTTP5波×4共20/20全200、完整14个item ID相同，p95 739.41ms、max760.63ms、内容准备budget250ms；不能把这48都称浏览器故事。
- wallet-mail-browser-tests.log：4项中3过1失败、无skip，hash `5ba985f24e62a5d8c7d737d3ce2937eb7503c3224fa6c89f069c64ad4da2ce03`；失败仍为背包故事滚动恢复的立即断言。其余messages／wallet缺失与撤权／关联名称三故事实际通过。早前单独4/4不替代本次3/4。
- targeted-tsc／diff-check为空且hash均e3b0c442…b855，environment各记exit0；Node24.16／PG18.6／正式connet_app／签名59dc5807…保持。没有读取其runtimeFile指向的秘密内容。

## 29. R27 滚动观测窄后继：3dd6bfb

固定 `3dd6bfb22858a73fe8510dd6b32593c1f51e8b27`，直接parent c415237；仅tests/site/ws02-wallet-mail.node.ts两行增／一行删，完整差异已读，diff-check0。**该测试观测修订静态接受，无新增实质发现；实际原四故事仍待同版复验。**

仍在同一时点核对abs(current scrollTop−原position)≤2；仅由同步assert改为expect.poll(timeout5000)读取当前Locator布局结果，没有设置scrollTop、触发额外业务操作、加大2px容差或修改故事timeout。此前cell数量／aria-pressed已满足，不等价于异步DOM／浏览器布局观察已经落定；有界等待原终态不删除原选择／分页／位置恢复意图。因此接受其作为异步断言方式，不据静态判断宣称此前失败“只是瞬时”或产品已通过。若真实5000ms仍达不到同一≤2px条件，仍是失败，不继续放宽来掩盖。

此提交只改测试，生产与9acc同字节；TD尚未交最终整合后继SHA／完整四故事结果。待其固定后只核此单测试差异及实际范围，不把9acc归档组改记为后继SHA重跑，也不因测试源码可接受就预先接受最终桌面交付。

## 30. R28 最终固定接受：7b748ab → 6947c4d

**最终接受target `6947c4d7988396239cec9d37987e21b530a3a09e`，无剩余实质发现；PG-CR01—09全部关闭。** base仍为已接受钱包／信箱 `7b748ab94ff944e3c54f98b8a112d0a3a7727791`，未改写旧WM独审和旧演示历史。本接受是该本地PG固定实现及交付前置工程验证，不替代实际fresh数据转换／8789切换回执。

### 30.1 最终tree与覆盖闭合

6947直接parent为9acc8cd；唯一差异就是已审3dd6bfb的同一滚动断言两行增／一行删，Git diff确认无其他文件变化，累计7b→6947 diff-check退出0。目标372 tracked文件，TD普通candidate-6947c4d-manifest.json逐文件SHA-256与reviewer直接从6947 Git对象计算的372份字节全部相同，遗漏／hash差异0；changedFiles仅tests/site/ws02-wallet-mail.node.ts。manifest hash `04270932c21622bd94f734912a9fb0da6d3b8072f13bc144786f13db7c3e4508`。

第28节113份组件文件＋固定执行合同覆盖保持；6947生产代码、配置、9acc的36个组合测试入口与其相关输入均未改变，最后一个.node.ts独立复验。9acc与6947完整typecheck均为TD在纯Git候选运行、exit0，两个普通日志均已只读为空、hash e3b0c442…b855；不称reviewer自行执行过compiler。该复用有逐文件证据，不要求把未改变的235组另记为在6947重跑。

### 30.2 9acc最终归档组合与旧失败

明确普通candidate-9acc8cd-combined-run.json固定source9acc、36个实际测试文件、开始／结束与exit1；combined-evidence.json及原combined-tests.log均已只读。原日志hash `1f866341e99a3449f0970fa54f9ca5866b06f963cc7b13334650fdbf915d1bff` 与元数据一致，实际235项＝182 pass／53 fail，cancelled0／skipped0，exit1如实保留。入口含API／config／WS02／CLI／integration／site-provider／离线SQLite测试，专门PG存储28项另按B exact证据，不把两个集合混算。

reviewer从原日志逐个提取53个失败用例和code／actual／expected／operator，与原7b的API39＋CLI/integration14失败逐项对照：差异0，unexpectedFailures为空。唯一明示标题alias为“independent SQLite connections…”→“independent PostgreSQL pools…”，其错误签名不变。此次真正最终源码的PG标题已在归档重跑，解决第22节先前旧日志归属不足；保留早期日志原范围，不倒写旧candidate的执行版本。combined-evidence.json hash `0f692d3052aa0a881bad8ea96a2ea701e99f3f0df1e6bd387e81b567bf6f11ac`。因此没有把历史不兼容／过时载荷的已知失败隐藏、skip或改记通过；也没有新增同名不同错误来冒充基线失败。

### 30.3 独立本地容量

candidate-9acc8cd-performance.json／.log明确固定source9acc、全新合成三Agent seed目标、正式connet_app、真实临时loopback HTTP端口、固定fixture时钟，不用原identity／认证／数据。普通日志1/1、fail/cancel/skip0，hash `8340eb535ffaac73a48b37fefbadc4f83af58490b110e7ac5fe2e4cb6dec4ace`；JSON hash `b22635ad9e20147dc348d47fd6d6f354c709007b142800430fb4354454f82c25`。实测对已准备PG目标的冷应用ready/listen24.51ms；10次health p95 16.93ms、list p95 38.78ms、detail p95 16.89ms；4并发共20次全200，无客户端补重试，p95 736.39ms／max797.22ms。阈值分别30秒／1秒／2秒／2秒／5秒，failures为空。

这些是当前小数据本地交付指标；不扩大成PG容器初始化、全量生产负载、维护窗口实测或生产SLA／RPO／RTO结论。另有B exact c415的28项存储／48项site-provider-HTTP及此前守卫、unknown COMMIT原键恢复、精确三次重试、最小权限等证明，分别沿原版本成立。

### 30.4 最后四桌面与后继复用

普通 `m1-storage/outputs/postgresql/final-site-3dd6bfb/` 的browser／environment／tsc／diff全部已读。准确testedCommit=currentHead=3dd6bfb、实际connet_app／PG18.6／59dc签名，最后同次完整四故事4/4、fail0／cancel0／skip0；browser hash `eca0051eb84514df8b84e0cb0720cc2bb38732fbc5c15bf065780b83150915db` 与metadata一致，两限定空日志均e3b0c442…b855且exit0。原2px、5000ms观测和250ms业务准备预算保持；B回执browser／app／本次fixture已正常关闭回收，不借原端口／库。

6947的tests/site及apps与该B来源逐字节相同。所比跨责任区域中仅额外的三个ops示例／冻结manifest及manager QA CLI入口存在已审差异；该CLI main在测试作为模块import时不执行，导出的owner／Agent helper未改变。没有将这些无执行差异隐瞒为整棵作者tree一致。原c415准确3/4、此前立即断言失败和更早4/4各自保留，最终4/4有自己的固定source与日志，既不拼接也不抹去失败。

最终四故事覆盖钱包与真实持有关系／分页选中及滚动恢复、四类信箱与可信来信、缺钱包及延迟／撤权清理、关联物品名称与失权；它们是本次必要桌面工程故事，不称原7故事全矩阵或手机／独立普通UI／原Agent手动HTTP已在最终PG重跑。

### 30.5 接受后的既有授权边界

专职独审已无待作者修订项，TD可依既有用户授权继续保全main非目标脏路径与index、停止／排空原8789写者、fresh一致备份原SQLite及配对identity，在新副本执行受审schema6＋catalog4准备、正式空PG目标闭门转换／全字段对账／只读ready，然后执行既有本地切换与实际回执；不新增人类批准门槛。本报告接受的是实现与前置验证，尚未发生的源表计数／余额／消息／实例／PID／版本不预写PASS。

最终fresh cutoff必须取当时数据，不能用本次旧820行演练副本覆盖后来用户写入；原迁移1–5、18旧非catalog/migrations表（含instance_state）、旧catalog除current及新版本追加分别核实。PG首次新持久写（包括session/access）后的回退仍保全当前PG全部提交，不能切陈旧SQLite。无公网／push／自动Agent触发扩大，整个WS02状态与独立UI／Agent后续验收仍由原稳定责任会话分别维护。

reviewer本轮只读固定Git／明确普通证据、编辑本独审报告；未执行项目代码／测试／Docker／SQL／HTTP／服务，未读真实DB／identity／token／private验证原件，未操作原8789／正式connet或代TD整合／部署。报告保留未stage状态，供TD在其既有交付范围选取；不bulk stage或混入他人改动。
