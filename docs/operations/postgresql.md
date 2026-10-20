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

仅发布 `127.0.0.1:15432`；容器内 5432 不等于向公网开放。Colima 分配 2 CPU／4 GiB／30 GiB，PG连接上限40是本地初值，不是性能／高可用结论。配置在 `ops/postgresql`，可以复用于自管部署；生产必须另定资源、TLS／网络、离机备份与保留期、RPO／RTO，不能把本机卷当灾备。

`init` 生成0700私有目录、0600秘密／连接文件，模板只含占位。密码经 Docker secret 文件传入，不作为命令参数或日志输出。`postgres` 管理、`connet_migrator` DDL、`connet_app` 运行DML、`connet_backup` 只读备份／复制职责分开；应用用户不是库owner且无建库／建角色权。正式schema及运行授权随受审的存储迁移实施，不能以超级用户运行应用。外置原identity须与数据库一起独立保全，不能写入公开配置或secret样例。

若新 Colima VM 的 `/etc/resolv.conf` 是失效链接，应只在该 profile 内恢复解析后再拉取；若宿主已有私有代理，应按 Colima 当前网关映射给该VM的Docker daemon，不硬编码个人代理地址到仓库、不关闭TLS验证、不修改默认profile。首次启动失败的日志保留，不能把网络就绪记为产品通过。

## 隔离目标与迁移边界

```sh
node scripts/postgresql/database.ts /absolute/private/new-directory/runtime.json connet_rehearsal_001 /absolute/private/new-rehearsal-connections
```

该命令只创建新目标库，已有名字明确失败，不自动删除或重用；连接秘密只写私有文件。正式转换必须使用TD冻结的schema6一致副本与配对identity，先复制到独立0700目录，原源只读。转换调用storage作者的正式分域migration／codec，不建永久原始JSON镜像；23张源表逐行可追溯，未知表／kind／字段、版本／digest或身份差异均阻断。每次演练使用新目标；失败目标隔离保留，不发布半成品。

备份需包含角色、配置、basebackup＋连续WAL与配对identity，逻辑dump只作补充；恢复必须在新隔离目标实际演练并对账。具体转换及备份命令随同批已固定codec接缝补齐，不能把当前编排就绪当转换或恢复已完成。

最终切换前重新取得当时一致备份与cutoff，停止并排空所有SQLite写者；沿用实例及业务recoveryEpoch，不借迁库换凭据。PG首次接收任何新持久写（包括读取会话／访问事实）前，可在写门关闭、原库仍是最终cutoff且源码兼容时恢复SQLite；之后须保全PG全部已提交写入并在PG侧修复，不回灌旧库或直接切旧SQLite。无已验证反向转换就不承诺迁回SQLite。
