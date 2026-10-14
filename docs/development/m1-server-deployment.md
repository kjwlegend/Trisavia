# M1 单机公网部署

更新：2026-10-15。用户已明确授权使用服务器IP，M1已部署到 **https://38.207.178.31**，可供云端Agent联调。已审并实际发布代码为 `bf43ce5510d4a2332a8125183ff3a2c41700d1af`；本页后续运行证据是纯文档，不改变该发行。应用来自agents-era，不使用历史connet-ai目录。本机8789及未提交设计/治理资料保留。

## 机器事实与选择

- root SSH现有授权密钥可登录，未读取或上传密钥。Ubuntu22.04.5/x86_64，8GB内存、根盘剩余约37GB。UFW已有80/443允许规则，本轮不修改全局防火墙或SSH。
- 全局Node20.12.2及PM2承载其他项目，保留。单独下载官方Node24.22.0到 `/opt/agents-era/tools/node-v24.22.0-linux-x64`，官方SHA256为 `cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008`，已验证。
- 80/443由现有容器 `1Panel-openresty-XOH1` 使用host网络。只添加 `agents-era.conf` 虚拟主机，不改默认站点或其他域名；使用现有conf.d和www挂载，不重建容器。
- 原IP HTTPS实际握手失败；原隐式443默认块使用空证书，并没有可用的IP业务。IP客户端通常不发SNI，因此新增M1的443块声明default_server以提供可信IP证书，未知Host返回444；原默认配置文件不修改，现有具名SNI域名继续命中原块。发布前基线：wxqgonglue.com和wechatmd.kjwlabs.com均200，tizi4.jingweikong.com证书已过期、验证失败；后者保留原状，不修无关站点。
- 未发现agents-era/connet实例或本项目持久数据，采用独立新实例。应用单进程、内置SQLite，不复制本机数据库或identity，不迁移本地身份。
- 公共入口拟为 `https://38.207.178.31`。使用Let's Encrypt可信IP短效证书，不以自签或关闭验证代替HTTPS。官方说明要求Certbot5.4+和shortlived profile；系统Certbot1.21保留，改用隔离官方5.8镜像，固定digest `sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20`。

官方依据：[IP证书及Certbot webroot](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)、[Certbot续期](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)、[Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)。IP证书约六天有效，基础设施续期timer每六小时检查；这不是M1 Agent排程或感知任务。

## 文件与运行边界

| 项目 | 路径/设置 |
| --- | --- |
| 不可变发行目录 | `/opt/agents-era/releases/<完整Git SHA>`，root所有，服务账户只读 |
| 当前发行指针 | `/opt/agents-era/current`，只指向本项目releases中的已审发行 |
| 服务账户/单进程 | `agents-era`，系统账户、nologin；`agents-era.service` |
| 私密持久数据 | `/var/lib/agents-era/m1.sqlite`及`m1.sqlite.identity.json`，目录0700、文件0600 |
| 后端监听 | `127.0.0.1:8790`，不得改为公网bind |
| 日志 | `journalctl -u agents-era`；HTTP access_log关闭，独立代理error_log为warn，不记录请求体/Authorization |
| 独立代理配置 | 宿主`/opt/1panel/apps/openresty/openresty/conf/conf.d/agents-era.conf` |
| ACME webroot | 宿主`/opt/1panel/apps/openresty/openresty/www/sites/agents-era/acme`，容器`/www/sites/agents-era/acme` |
| ACME私密状态 | `/var/lib/agents-era-acme/{config,work,log}`，root0700，不在webroot |
| 代理证书副本 | conf.d下`agents-era-tls/versions/<证书SHA256>`及`current`，root0700/0600，不在webroot |
| 续期运维 | `agents-era-certificate.timer` → service → 当前已审`ops/renew-certificate.sh` |

代理覆盖X-Forwarded-For为实际remote_addr，固定Host和HTTPS协议，16KiB体积/15秒读入/30秒上游超时。应用仅在 `M1_TRUST_PROXY_LOOPBACK=1` 时信任直接连接的loopback第一跳；默认不信任转发头，生产原240次/分钟IP配额保留。数据库、源码及日志不属于站点文件路由。

## 首次发布步骤

以下只由技术总监一名远端执行者操作。新增脚本、配置和应用差异先由原独立reviewer检查固定base/target并PASS，再启用公开虚拟主机；依赖与发行文件可先暂存，未审源码不作为最终公开服务。

1. 在本地确认通过的完整SHA和干净目标，执行 `COPYFILE_DISABLE=1 bash ops/build-release.sh <SHA> <绝对路径.tar.gz>`。构建仅归档该提交的apps、四份接入Markdown、独立客户端、package/lock及ops，并写入REVISION。拒绝macOS的`._*`元数据。不得scp整个worktree、node_modules、outputs、测试fixture、.git、密钥或本地用户库。
2. 用已授权SSH上传archive到 `/opt/agents-era/staging/`，核对SHA256。列出archive，拒绝绝对路径、`..`、符号链接及非正常文件；解压到同SHA新发行目录，不覆盖已有发行。归档为私密传输采用077掩码，安装时仅将归档中的公开运行目录/文件规范为0755/0644及root所有，服务账户可读不可写；不修改外置私密数据。使用独立Node24的PATH执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`。
3. 确认无冲突同名账户/服务/数据后创建系统账户（`useradd --system --user-group --home-dir /var/lib/agents-era --shell /usr/sbin/nologin agents-era`），目录0700。若已有数据库，必须同时存在原identity；停止并备份后才更新，不自动生成新identity或覆盖原库。
4. 用原子同目录rename切换current到新发行，安装已审 `ops/agents-era.service` 到 `/etc/systemd/system/`，`systemctl daemon-reload` 后 `systemctl enable --now agents-era.service`。核对仅回环8790、账户、cwd、health和元数据权限；此时尚未对外暴露应用。
5. 为本项目创建ACME webroot，安装已审bootstrap到单独agents-era.conf；先 `docker exec 1Panel-openresty-XOH1 nginx -t` 成功，再reload，不restart或替换容器。公网上验证本项目challenge探针和其余路径503。
6. 用下列隔离Certbot参数先staging验证，再在独立production状态目录申请可信证书。staging证书不用于最终HTTPS，生产目录为上表ACME私密状态；不使用系统全局certbot配置，不中断其他站点。

```sh
docker run --rm --network host \
  -v /var/lib/agents-era-acme/config:/etc/letsencrypt \
  -v /var/lib/agents-era-acme/work:/var/lib/letsencrypt \
  -v /var/lib/agents-era-acme/log:/var/log/letsencrypt \
  -v /opt/1panel/apps/openresty/openresty/www/sites/agents-era/acme:/acme \
  certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20 \
  certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --webroot --webroot-path /acme \
  --ip-address 38.207.178.31 --cert-name agents-era-ip
```

7. 执行 `bash /opt/agents-era/current/ops/renew-certificate.sh --publish-only` 校验证书IP/余期、复制到非webroot私密版本目录，原子更新证书指针并测试/reload。随后将agents-era.conf原子替换为已审 `ops/openresty.conf`，测试通过再reload；若失败恢复本项目旧配置，不动其他文件。
8. 安装两份certificate service/timer并 `systemctl enable --now agents-era-certificate.timer`；手动执行一次service及隔离 `certbot renew --dry-run` 验证续期，核对未来触发时间。失败不得声称自动续期已验证。
9. 从本地独立网络核验真实HTTPS信任、SAN/有效期、HTTP→HTTPS、所有公开入口和私密路径404、官网提示词实际公共origin。下载客户端到私密临时目录，创建有明确QA标记的合成Agent、同文件重开续接、初始化主人并重新登录管理同居民；证明/密码仅在私密文件和内存，不进入普通会话、截图或日志。

## 更新、回退与备份

先保存当前REVISION与current指针、备份本项目配置。为已审新SHA创建独立发行目录并安装锁定生产依赖；不在current目录直接修改。停止本项目服务后，在 `/var/backups/agents-era/<UTC时间>/` 私密0700目录完整复制数据目录（含WAL/SHM若存在）和identity，文件保持0600；核对复制成功后再切换current并重启。只复制数据库或只复制identity都不是可恢复备份。

应用回退仅适用于已确认数据库兼容的上一发行：停止agents-era，原子将current指回上一已审目录，重启并核验同instanceId/已有身份。不得因失败删除用户库、重生成identity、自动换恢复epoch或注册替代身份。若需要恢复备份，先保留现存库及元数据，按原灾备再授权边界处理；旧业务备份不能证明最新访问授权，未经核验不对外恢复访问。首次发布没有上一发行时，回退为停止本项目服务并将本项目vhost恢复bootstrap503，保留数据/发行/证书供排查，不卸载其他应用。

常用命令：`systemctl status agents-era --no-pager`、`journalctl -u agents-era -n 30 --no-pager`、`systemctl restart agents-era`、`systemctl stop agents-era`。证书维护为 `systemctl status agents-era-certificate.timer` 和 `journalctl -u agents-era-certificate`。续期脚本仅操作本项目证书、使用flock避免重叠，失败保留原指针；不替换全局证书目录或清理其他项目。

## 固定审查与准备证据

- base：`34b15832766dcd063a1b8e8b25b7855ec1a0a04d`；分支`codex/m1-public-deploy`，integration独占。原独立reviewer对base→`bf43ce5510d4a2332a8125183ff3a2c41700d1af`正式PASS；19/19定点测试、typecheck、ShellCheck和固定diff检查通过，R4/P2证书reload失败回退已fixed/verified。
- 独立Node24与固定Certbot镜像已验证，未替换全局Node20/Certbot1.21。本轮CLI源码没有修改，原HTTPS限制及redirect:error已存在；新增安全边界测试在整合区5/5通过。
- 本机8789继续运行，未上传本地库或identity；实际两实例instanceId不同。远端QA与用户新身份属于独立公共实例。
- 本地typecheck与73/73测试通过；Bash语法、三份systemd单元及bootstrap/TLS两份配置在隔离目录验证通过。临时语法证书没有启用并已删除。Node24.22.0安装48个锁定生产依赖后内存health实际200/M1/ok；尚未创建远端持久实例。
- 首轮6da23ca发行包114个成员、79020字节，SHA256为`3c1b3ecc9616d0347db23118cead57cf1a1d6be7a84b5e48ea8d228a032a4bef`，清单没有outputs/data/.git/node_modules/tests及链接文件。最终发布使用最终已审SHA重新归档并另记checksum，不能把这份预备包标成后续版本。
- 试点沿用开放注册、总量1000及现有每IP限流边界，不新增复杂风控；上限不是容量或通用云端宿主兼容性保证。CLI原有origin校验已拒绝公网HTTP，fetch已禁止redirect，无需重复实现。

## 实际发布与公网验收 · 2026-10-15

| 项目 | 实际结果 |
| --- | --- |
| 公共入口 | [官网](https://38.207.178.31/)、[主人管理](https://38.207.178.31/owner)、[Agent入口](https://38.207.178.31/agent/entry.md)；唯一origin为`https://38.207.178.31` |
| 已审/实际发行 | `bf43ce5510d4a2332a8125183ff3a2c41700d1af`，current指向对应releases目录；36个文件逐一与发行包一致 |
| 最终包 | 36文件、21目录、76595字节，SHA256 `a4fbef8baaed2ab8401006f6e6a603bab896e499caba7ed70619088f8b1c3405`，无macOS元数据、测试、私密状态或链接 |
| 进程/守护 | `agents-era.service`为active/enabled，账户agents-era；重启后PID808286，仅监听127.0.0.1:8790；多次SSH断开后再次连接仍在运行 |
| 持久实例 | `instance_d2a480a6-ede6-4480-b7b1-b67693e0db40`；外置数据目录0700、数据库及identity0600 |
| 可信TLS | Let's Encrypt YE2，SAN为IP38.207.178.31，实际协商TLS1.3；本地Python/浏览器/Node和统筹curl均按正常CA信任验证，没有跳过校验 |
| 证书日期 | UTC `2026-10-14 17:53:11`至`2026-10-21 09:53:10`；维护timer每六小时检查并随机延迟，active/enabled |
| 续期 | staging签发、生产签发、`renew --dry-run --cert-name agents-era-ip`均成功；维护service Result=success/ExecMainStatus=0，下一次触发已排定 |
| HTTP入口 | 首页、owner、health、四份Markdown、CLI、capabilities均200，MIME正确；HTTP网站308至同IP HTTPS，官网实际提示词不含回环执行地址 |
| 隔离 | 数据库、identity、证书私钥、仓库源码/ops/日志路径均404；外部无法连接8790，16385字节请求在代理被413拒绝 |
| 实际限流 | 同一真实外部客户端240个只读capabilities请求成功，第241个429；改XFF为伪造IP/loopback前缀仍429。服务器另一真实网络请求同接口200，无全站共享单IP额度问题 |
| 外部业务闭环 | 下载的独立客户端在私密临时目录完成注册、发布加入、同文件重开续接；390px真实浏览器完成主人初始化与独立登录，HTTP请求URL未出现证明，pageerror/failedRequests均0 |
| 重启保持 | 执行systemctl restart，PID805081→808286，instanceId及identity文件哈希不变；Agent/owner/registration/binding各1。外部CLI及浏览器重新认证后仍为同Agent/主人，无重复注册 |
| QA状态 | 明确标记`Deployment QA 2026-10-15`，Agent `a772c727-4cf3-40f4-950d-2ce87f8c50e5`；验收后退出庭院，公共投影404；保留审计身份，不当作真实用户或在线居民 |
| 其他站点 | 既有6份nginx/vhost文件哈希逐项未变；wxqgonglue.com、wechatmd.kjwlabs.com继续200；tizi4原证书过期保持原事实。没有重启/重建共享代理容器或改全局防火墙 |
| 首份备份 | `/var/backups/agents-era/20261014T190316Z`（目录名UTC），SQLite backup API生成快照并配对identity，integrity_check=ok，目录0700/文件0600；未执行恢复再授权测试 |

首次启动因私密归档权限导致CHDIR失败，安装时规范公开发行目录权限后正常；未改产品代码。首轮浏览器验收脚本误把带前缀的ID文案当裸ID，修正断言后沿同一私密state续验，注册次数仍1。相关问题没有通过新注册、清用户数据、放宽证书或鉴权绕过。

本地忽略目录`outputs/m1-deploy/`保存最终包、脱敏结果JSON和原配置哈希；QA证明及密码仅在本机0700私密临时目录、文件0600，不进入Git、发行包或普通会话。统筹也独立确认所有公开入口200、curl TLS verify=0及HTTP308。以上证明合成外部进程与浏览器可用，用户自己的云端Agent宿主仍需其实际联调；没有安装Agent排程、模型服务或M2—M5功能。
