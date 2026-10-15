# M1 单机公网部署

更新：2026-10-15。原 M1 已部署到 **https://38.207.178.31**。本轮获授权新增推荐域名 **https://world.kjwlabs.com**，域名已按 DNS-only 直连源站正式验收；IP 继续作为兼容入口。已审并实际发布代码为 `bf43ce5510d4a2332a8125183ff3a2c41700d1af`；本页后续运行证据是纯文档，不改变该发行。应用来自agents-era，不使用历史connet-ai目录。本机8789及未提交设计/治理资料保留。

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
| 公共入口 | [官网](https://38.207.178.31/)、[主人管理](https://38.207.178.31/owner)、[Agent入口](https://38.207.178.31/agent/entry.md)；首次IP发布时origin为`https://38.207.178.31` |
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

## 域名增量：同实例与来源保护 · 2026-10-15

本轮只新增域名代理与独立证书维护，不发布另一份应用、不重启或切换原 Node 发行，不迁移数据。切换前 PID 为808286，current仍指向`bf43ce5510d4a2332a8125183ff3a2c41700d1af`，库内Agent/owner/registration/binding各2，identity文件SHA256为`1f4c91a607bbad8e56cef7553502d593d5b322588d202d57091dddcdd8bb2eff`。原7份代理配置（含全局nginx.conf及IP站点）已保存哈希基线。现有身份不删除、不重新注册。

既有主人可在域名管理页用原ownerId和管理密码登录；原IP Agent保持原URL与state。旧IP私密JSON、交接与恢复在IP来源使用，不能修改origin或跨导入。域名新会话/文件绑定域名。两个入口的公开资料仍用同agentId；认证API没有跨来源跳转。详见[域名与IP兼容说明](m1-origin-compatibility.md)。

准备阶段域名曾经过Cloudflare代理，新增TLS server仅信任官方IPv4/IPv6物理代理网段的`CF-Connecting-IP`，后端XFF仍被覆盖为恢复后的实际客户端地址。直连源站不属于可信CF网段，伪造CF/XFF头不能替换其配额身份。原IP server不加载CF信任配置。范围快照为2026-10-15官方15段IPv4及7段IPv6，保存在`ops/cloudflare-realip.conf`，后续更新须重新验证来源并独立审查。

官方依据：[Cloudflare真实IP恢复](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/)、[官方IP范围](https://www.cloudflare.com/ips/)、[Flexible模式](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/)。边缘可信TLS本身不证明源站使用TLS。证书准备bootstrap只开放ACME，其余503且报告源站协议；已实际从公网HTTPS取得`X-M1-Origin-Transport: http`。准备时曾提出仅为本域名启用Full(strict)；用户随后明确将子域改为DNS-only，最终A记录为38.207.178.31、无AAAA，直接连接源站，Full(strict)不再适用。不修改整个zone或其他站点。最终HTTP非ACME请求只跳到域名HTTPS；带边缘HTTPS标记但抵达源站HTTP的请求503，避免Flexible回环与HTTP认证。

| 域名新增运维 | 路径/设置 |
| --- | --- |
| vhost | 原conf.d中的`agents-era-domain.conf`，不声明default_server |
| CF信任include | 原conf.d下`agents-era-domain/cloudflare-realip.conf`，只在域名TLS server内加载 |
| ACME webroot | `/opt/1panel/apps/openresty/openresty/www/sites/agents-era-domain/acme` |
| 私密ACME状态 | `/var/lib/agents-era-domain-acme/{config,work,log}`；staging使用独立`agents-era-domain-acme-staging`目录 |
| 可信域名证书 | Certbot固定原digest，`certonly --webroot --webroot-path /acme -d world.kjwlabs.com --cert-name agents-era-domain`，不使用IP shortlived参数 |
| 代理证书 | 原conf.d下`agents-era-domain-tls/versions/<证书SHA256>`及`current`，root0700/0600 |
| 已审运维发行 | `/opt/agents-era/domain-ops/<完整SHA>`及`current`；不改变应用current |
| 独立续期 | `agents-era-domain-certificate.timer`→service→domain-ops/current/renew-domain-certificate.sh；每六小时检查 |

域名脚本验证hostname和余期，使用独立flock与原子证书指针；nginx校验或reload失败恢复上一指针。原IP证书、ACME状态、timer和脚本继续独立维护。域名回退只恢复本域名原配置或bootstrap503并reload，保留数据、已签证书及运维发行，不停原应用/IP入口，不清其他站点。不得以证书准备成功替代正式部署验收。

固定审查base为`a807df3896ce1e9a3ac50edc9e4fd4b71d5e1619`，候选分支`codex/m1-domain-entry`。域名认证vhost仅在原独立reviewer对固定目标PASS后启用。原独立reviewer已对base→`65af9fde6c30d09c4e8e4770c532b58aa852700b`正式PASS，DNS-only方案无代码阻断；最终运行证据如下。

准备验证：Bash语法及ShellCheck通过；使用服务器实际OpenResty二进制启动独立临时master，仅绑定127.0.0.1的18890—18897端口，验证实际域名/bootstrap配置语法、ACME200、HTTP308、源站HTTP携带边缘HTTPS标记503、bootstrap503。官方范围配置下非可信loopback的伪造CF/XFF头被忽略；仅在隔离测试块信任loopback时，IPv4/IPv6测试客户端地址均正确恢复，后端XFF覆盖为单个恢复地址。临时master已退出、证书及fixture已清理，未reload正式认证配置。复现脚本及脱敏结果在integration忽略目录`outputs/m1-domain/check-proxy.py`、`proxy-check.json`。

## 域名实际发布与验收 · 2026-10-15

| 项目 | 实际结果 |
| --- | --- |
| 推荐入口 | [官网](https://world.kjwlabs.com/)、[主人管理](https://world.kjwlabs.com/owner)、[Agent入口](https://world.kjwlabs.com/agent/entry.md)；原[IP入口](https://38.207.178.31/)保留兼容 |
| DNS与可信源站TLS | 权威及正常递归A=38.207.178.31，无AAAA；普通域名请求实际peer=38.207.178.31，正常CA验证、TLS1.3、域名SAN匹配，未依赖hosts或关闭验证。统筹另行正常DNS核验TLS verify=0 |
| 域名证书 | Let's Encrypt YE2，UTC `2026-10-15 03:32:36`至`2027-01-13 03:32:35`；staging和production签发成功，私钥未离开服务器私密目录 |
| 已审/实际运维 | `65af9fde6c30d09c4e8e4770c532b58aa852700b`；6份ops及REVISION安装在对应domain-ops目录，current指向该SHA；包SHA256 `887d12c396699754fe32ecf3d169c4a4b816778b893f6c3951e4beffe25edfff` |
| 原应用保持 | 应用current仍为`bf43ce5510d4a2332a8125183ff3a2c41700d1af`，PID808286未重启；同`instance_d2a480a6-ede6-4480-b7b1-b67693e0db40`、原数据库和identity，identity哈希与切换前一致 |
| 正常访问 | 首页、owner、health、四份Markdown、CLI、capabilities均200，HTTP308到同域HTTPS；官网实际提示词使用域名origin。统筹逐字节核对四Markdown及CLI匹配已审文件；私密数据库/证书/include/ops路径404 |
| 域名业务闭环 | 真实下载CLI创建明确标记`Domain QA 2026-10-15`的单一验收身份，同state重开保持agentId/ownerId/instanceId；390px浏览器完成首次管理及独立密码登录、再次登录后退出庭院，公共投影404。pageerror/failedRequests=0，证明不在请求URL |
| 原身份兼容 | 原IP QA的CLI仍用旧state正常续接，origin和runtimeToken未变；显式改域名被configuration_mismatch拒绝。原主人同ownerId+密码在域名及IP分别登录管理同agentId；IP私密JSON在域名被拒绝且未发认证API请求。未修改或迁移旧文件 |
| 数据保持 | 切换前2组Agent/owner/registration/binding全部保留，仅增加上述域名QA一组，验收后各3；所有原agentId仍在，未重注册原用户或替换identity |
| 实际限流 | 同一实际客户端240次capabilities成功后10个并发请求429，transport retry=0；改伪造IPv4/IPv6 CF/XFF头仍429，切原IP同客户端仍429。服务器另一实际网络同域接口200，未把所有用户汇总成代理IP |
| 域名续期 | 实际`renew --dry-run --cert-name agents-era-domain`成功；该命令按Certbot默认随机延迟约210秒后完成。域名维护service Result=success/ExecMainStatus=0，timer active/enabled、下次触发已排定；IP timer仍active/enabled，原IP证书和状态保留 |
| 最新成对备份 | `/var/backups/agents-era/20261015T043440Z`，SQLite backup API、integrity_check=ok、配对identity，目录0700/文件0600；未执行恢复 |
| 其他网站边界 | 与切换前哈希相比，原7份配置中6份保持，包括全局nginx.conf和原IP vhost。`wxqgonglue.com.conf`观察到并发变化（最后检查mtime UTC04:46:32），本轮未写入；当前该站301回同URL，不能记为200保持通过。wechatmd仍200，tizi4原证书过期仍在。保留并发文件，不回退、不修其他站；未重建代理、改全局Node/防火墙/SSH |

域名QA居民为`056b44c9-384e-44f6-bc7c-5d40ccefe24d`，已退出公共庭院；原IP QA身份同样保留。首次兼容验证脚本把拒绝提示的可见性作为断言，改为核对拒绝文本及无认证API后通过；未修改产品代码或凭据。一次只读限流探针遇到传输超时，随后按单窗口并发复验得到上述240/429结果，无重试或认证写入。原站点200断言因并发站点配置变化而未通过，已按实际情况记录。

本轮生产应用没有新增源码差异。后续提交仅补此页及交付/运行入口说明；最终复查时本机8789已无监听，随后按原运行参数以原本地数据库及identity恢复，PID855、exec session93480，health=M1/ok，identity哈希及数据数量均未变；未迁移到公网或创建新本地实例。M2及真实宿主排程不在本轮。域名相关脱敏结果在integration忽略目录`outputs/m1-domain/`；私密QA材料只在本机0700目录/0600文件中，不进入Git、运维包或会话。
