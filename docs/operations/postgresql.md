# 本地自管 PostgreSQL 与离线转换

本批经用户授权实施。运行时为 Node 24；项目依赖由提交的 package-lock.json 安装。这里只编排数据库及受控离线工具，不启动应用、seed、邮件或 Agent 任务。原 8789／SQLite／identity 的停服与最终切换由技术总监执行。

## 独立本地环境

使用已有 Colima／Docker。先核对同名 profile、context、容器／卷和端口归属；不得覆盖已有资源。所有 Docker 命令显式指定 `colima-agents-era-pg`，不修改用户当前 context。

```sh
colima --profile agents-era-pg start --cpus 2 --memory 4 --disk 30 --runtime docker --activate=false --ssh-config=false
node scripts/postgresql/local.ts pull
# 将上一命令返回的精确 image 字符串代入；私有目录必须尚不存在。
node scripts/postgresql/local.ts init /absolute/private/new-directory agents-era-pg 15432 'postgres:18.6-trixie@sha256:REPLACE_WITH_PULL_REPODIGEST'
node scripts/postgresql/local.ts up /absolute/private/new-directory/runtime.json
node scripts/postgresql/local.ts status /absolute/private/new-directory/runtime.json
```

本批固定 `postgres:18.6-trixie`，拉取后以 RepoDigest 启动；不得改用浮动 latest。PG18 的数据卷挂载 `/var/lib/postgresql`，实际 PGDATA 为 `/var/lib/postgresql/18/docker`。[官方镜像说明](https://hub.docker.com/_/postgres)、[版本政策](https://www.postgresql.org/support/versioning/)。命名卷 `<project>-data` 不随停止容器删除。`local.ts stop RUNTIME_JSON` 只正常停止，不执行 down -v、volume prune 或数据清理。

仅发布 `127.0.0.1:15432`；容器内 5432 不等于向公网开放。Colima 分配 2 CPU／4 GiB／30 GiB，PG连接上限40是本地初值，不是性能／高可用结论。配置在 `ops/postgresql`，自管准备模板见 `application.env.example` 与 `production-plan.example.json`，不能把本机卷当灾备。

`init` 生成0700私有目录、0600秘密／连接文件，模板只含占位。密码经 Docker secret 文件传入，不作为命令参数或日志输出。`postgres` 管理、`connet_migrator` DDL、`connet_app` 运行DML、`connet_backup` 只读备份／复制职责分开；应用用户不是库owner且无建库／建角色权。正式schema及运行授权随受审的存储迁移实施，不能以超级用户运行应用。外置原identity须与数据库一起独立保全，不能写入公开配置或secret样例。

若新 Colima VM 的 `/etc/resolv.conf` 是失效链接，应只在该 profile 内恢复解析后再拉取；若宿主已有私有代理，应按 Colima 当前网关映射给该VM的Docker daemon，不硬编码个人代理地址到仓库、不关闭TLS验证、不修改默认profile。首次启动失败的日志保留，不能把网络就绪记为产品通过。

## 隔离目标与迁移边界

```sh
node scripts/postgresql/database.ts /absolute/private/new-directory/runtime.json connet_rehearsal_001 /absolute/private/new-rehearsal-connections
```

该命令只创建新目标库，已有名字明确失败，不自动删除或重用；连接秘密只写私有文件。正式转换必须使用TD冻结的schema6一致副本与配对identity，先复制到独立0700目录，原源只读。转换调用storage作者的正式分域migration／codec，不建永久原始JSON镜像；23张源表逐行可追溯，未知表／kind／字段、版本／digest或身份差异均阻断。每次演练使用新目标；失败目标隔离保留，不发布半成品。

正式storage迁移之后、用应用凭据启动之前，必须显式运行最小授权步骤。`connet_app`仅取得14个已定schema的USAGE和业务／子表DML；`platform.module_migrations`、`legacy_schema_migrations`只读，`instance_state`只读并仅允许更新`write_generation`以取得守卫锁。应用无DDL、不可开写门或修改实例／recoveryEpoch。正式目标`connet`需维护者显式加`--cutover`，不是浏览器或运行用户的权限。

```sh
node scripts/postgresql/permissions.ts /absolute/private/new-directory/runtime.json connet_rehearsal_001
```

## 离线准备、转换与正式写门

Node 24直接运行工具。源必须是已停止并排空全部写者后由TD取得的一致副本，含WAL的SQLite backup产物与配对identity；不要拷贝正在写入的单个sqlite文件。先将它们复制到0700私有工作区。`prepare-sqlite`只以只读连接检查输入，在新文件上调用保留的原schema1–6迁移；原18张业务表及原迁移记录逐行／校验值／时间不变。输入已为schema6时同样只复制和核对。工具拒绝覆盖既有输出目录。

```sh
node scripts/postgresql/prepare-sqlite.ts /private/cutoff/stopped.sqlite /private/cutoff/identity.json /private/new-schema6-copy
# 提前从已审7b提交制作源码归档并以其锁文件装依赖；不得指向流动工作树。
mkdir /private/frozen-7b
git archive --format=tar --output=/private/frozen-7b.tar 7b748ab94ff944e3c54f98b8a112d0a3a7727791
tar -xf /private/frozen-7b.tar -C /private/frozen-7b
npm ci --prefix /private/frozen-7b --ignore-scripts
node scripts/postgresql/prepare-catalog.ts /private/new-schema6-copy/schema6.sqlite /private/new-schema6-copy/identity.json /private/frozen-7b /private/new-catalog4-copy
node scripts/postgresql/convert.ts /private/new-catalog4-copy/catalog4.sqlite /private/new-catalog4-copy/identity.json /private/rehearsal/migration-database-url /private/new-conversion
node scripts/postgresql/permissions.ts /private/runtime/runtime.json connet_rehearsal_001
node scripts/postgresql/gate.ts /private/rehearsal/migration-database-url /private/new-schema6-copy/identity.json status
```

转换使用storage正式typed codec整批事务；23表（21业务＋实例／迁移历史）逐行回构对账，保留id、version、null／0／false、原正文与历史canonical digest。私有临时snapshot／行证据不是PG永久shadow表。未知kind／字段、完整性／身份或任一差异均失败，目标不发布；真实SQL中途失败整批回滚。对账成功仍是`validated-not-published`，写门关闭，不执行bootstrap、seed、重发凭据或业务重试。

schema迁移与目录升级是两个显式阶段：最终fresh cutoff的schema5仍可包含catalog schema3／guide3，不能拿早期已升schema4的820行副本代替。`prepare-catalog`先按已提交SHA256 manifest验证冻结7b全部platform源码，再仅对另一新副本调用7b `buildApp.ready/close`，无listener／seed／认证请求；原catalog除`current`逐行保留，只追加schema4／下一版guide及其不可变revision声明。对真实guide3输入，结果为guide4。它验证所有非catalog表、实例与原迁移记录不变；最终相对schema5 cutoff的保全口径是原20表中除`schema_migrations`／`perception_catalog`外的18表（含instance_state）不变、原迁移1–5原样加6、旧catalog除current保留。不得在PG业务写门打开后补做bootstrap。

最终切换仅TD执行：正式`connet`须已存在且所有业务表为空，沿当时fresh cutoff重新准备／转换，不能复用早期演练数据。使用正式私有migration连接，把上面convert末尾显式加`--cutover`；permissions对`connet`也须`--cutover`。用原配对identity及application连接在闭门状态运行纯read readiness／health；不得把会持久化读取事实的感知请求当闭门探针。应用配置由模板复制到0600私有文件，数据库URL只在0600连接文件，运行角色为connet_app。所有检查及停机边界记录后，仅TD执行以下显式开门，随后按其交付流程启用应用：

```sh
node scripts/postgresql/gate.ts /private/runtime/migration-database-url /private/original/identity.json open
# status/closed是独立维护动作；不由应用启动自动开启。
# 先固定源码与私有环境，再由TD启动；本工具不操作原8789。
env -i PATH=/absolute/node24/bin:/usr/bin:/bin /absolute/node24/bin/node --env-file=/private/application.env apps/platform/server.ts
```

## 备份与隔离恢复

```sh
node scripts/postgresql/backup.ts backup /private/runtime/runtime.json /private/new-backup /private/original/identity.json /private/application.env
node scripts/postgresql/backup.ts archive /private/runtime/runtime.json /private/new-backup
node scripts/postgresql/backup.ts restore-drill /private/runtime/runtime.json /private/new-backup
```

备份包含已`pg_verifybackup`的basebackup、连续WAL、角色globals、原配对identity、私有运行／应用配置与角色secret；逻辑dump仅补充。正式命令要求配对identity及应用配置，identity须匹配目标`connet`。整个备份0700／0600且含秘密，应加密离机保存，不进入Git或聊天。物理basebackup覆盖本cluster所有库，不能将其作为可公开工件。当前WAL archive在同一持久卷，必须再显式拷到备份集和独立故障域。

恢复先再验basebackup，使用新labelled卷、新容器、`network none`且无host port；从basebackup＋WAL回放，不挂载或覆盖源卷。CLI返回新容器／卷名供维护者核对；`stopRestoreDrill`仅在project／drill标签匹配后正常停止，默认保留诊断卷，只有明确一次性演练才删除其自有资源。恢复后的身份／全行／历史digest及cutoff后WAL探针必须核对，不能只用进程启动证明恢复成功。测试已实际覆盖basebackup后提交经WAL恢复；这不等于生产RPO／RTO达标。

全业务恢复检查由`tests/postgresql/operations-full-recovery.test.ts`消费显式`M1_PG_RUNTIME_FILE`／`M1_PG_SQLITE_COPY`／`M1_PG_IDENTITY_COPY`：新隔离目标导入并以正式codec回构原23表，再对14个正式schema内**全部**typed／child／metadata表的全列、稳定行序做SHA256；恢复后逐表计数／hash、历史canonical文本／digest及配对identity一致。`recovery-evidence.ts`经`docker exec psql`只读取得实际数据并在进程内摘要，日志仅计数／hash，不保存第二套业务JSON镜像。证据与物理备份仍是私有材料；该检查不把早期820行／预升catalog4来源冒充最终fresh cutoff。

## 自管生产准备边界

模板给出建议RPO≤5分钟、RTO≤60分钟，均为**未实证目标**；建议保留7份日basebackup、4份周basebackup、3份月逻辑dump，WAL从最早保留basebackup起连续保留到目标恢复点。删除须以离机副本校验和新恢复成功为前提，不按日历盲删WAL。本轮不安装定时任务；当前为显式操作，未具备离机连续传输前不能宣称满足建议RPO。

上线责任在模板中逐项填写具名服务负责人、DB维护者、备份保管人及恢复批准人；维护者负责archive失败／磁盘／备份新鲜度巡检、受审升级、恢复演练与cutover记录。应用仍只绑定loopback，若后续自管公网服务，另行配置受控入口、TLS／网络访问和按负载测算资源。模板已准备，未部署公网／高可用，也未引入新中间件。

最终切换前重新取得当时一致备份与cutoff，停止并排空所有SQLite写者；沿用实例及业务recoveryEpoch，不借迁库换凭据。PG首次接收任何新持久写（包括读取会话／访问事实）前，可在写门关闭、原库仍是最终cutoff且源码兼容时恢复SQLite；之后须保全PG全部已提交写入并在PG侧修复，不回灌旧库或直接切旧SQLite。无已验证反向转换就不承诺迁回SQLite。
