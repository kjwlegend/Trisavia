# M1 新主人账户 · 本地交付记录

日期：2026-10-17。范围：当前新账户体系与必要地图修复已独审、普通用户闭环及完整作者回归后整合 main；仅本地，未部署公网。新的游戏化首页与 M2 效果图仍为设计提案，不据此宣称已实施 M2。

## 交付与版本

新主人以自选 ASCII 用户名、邮箱和密码注册，使用用户名或邮箱登录。用户名 trim/NFKC 后为 2—32 个英文字母、数字或下划线，忽略大小写唯一；邮箱私有、未验证，不提供邮件找回。UUID 只用于内部关联。

人可先注册再从真实空态邀请 Agent；Agent 也可自主加入后交接给新账户或已有账户明确确认绑定。多 Agent 管理、受限邀请、新账户自己的备份找回、并发唯一性、原请求未知结果恢复及 A/B 临时状态隔离均保留。主人备份统一为 `connet-owner-v2`；按用户最新范围不实现旧 UUID 登录、旧账户补全或旧文件迁移。

全屏世界与手机探索保留；已修正旋转导航、资源失败控件、全景详情跨尺寸关闭、冲突提示和跨任务成功提示。地图演示不代表真实 M2 后端。

| 记录 | 固定版本 |
| --- | --- |
| 已审产品来源 | `218d888a5a206329202faad61b564c19f2fba5d6` |
| 最终测试及独审增量目标 | `1c45a60fde86af2bc66b52867f2bca0623629ea9`，相对产品来源仅两份测试断言增量 |
| main 程序／测试提交 | `1eb343e80ae22eeff87698c3333e35fcedafaa1d` |
| main 公开接入提交 | `f9f7df9cb9427d9d4d663bb02b0b5becfe20b321` |

60 个程序／测试路径及 4 份公开接入内容按实际归属应用，不合并旧 worktree 的文档布局。main 上述路径与已审最终目标逐路径一致；既有 HTTP 文档迁移链接仍以未提交修改保留。整合前重新记录 668 个受保护条目，程序／接入提交的即时前后无内容／权限差异。随后原 WS06 继续更新架构图，本机 Obsidian 界面状态也有正常变化，均原样保留；其他迁移文档、设计图、架构产物及索引状态未覆盖或清理。本文作为独立交付记录提交，不混入其他人的文档修改。

## 实际运行

- [首页](http://127.0.0.1:8789/) · [注册／登录](http://127.0.0.1:8789/owner) · [Agent 接入](http://127.0.0.1:8789/agent/entry.md)。本次四入口含 `/health` 均 200，health=`M1 / ok`。
- 实例：`instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`；本次核验 Node PID `24630`，Node `24.16.0`。
- 当前运行固定来源 `218d888` 的只读目录：`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-human-account/new-account-v2-feedback-snapshot`。main 产品源码与它一致；本次整合没有重启此进程、退出用户会话或重置用户数据。
- 用户数据库：`/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite`；identity：同名加 `.identity.json`。数据目录 0700、库／identity 0600，已被 Git 忽略；与全部 QA 数据库分离。
- 原 `data/m1.sqlite` 及原 identity 保留，无旧体系迁移；切换前一致备份在 integration 的 `outputs/m1-human-account/original-8789-backup-20261017T080042Z/`，0700 目录／0600 文件。原 identity SHA-256 保持 `299624be241a8cebf13e1427ab336ff751e125807121a5d39ca134b486c7a75d`。

**当前新库可能已有用户刚注册的数据。后续维护必须沿用这份库、identity 和实例，不能替换成旧库、空库或 QA 库。运行快照仍是当前进程依赖，不能随 worktree 清理删除。** 下次维护可以核对并停止实际监听进程后，从 main 启动相同数据库；本次无需重复启动：

```sh
cd /Users/kjw/Workspace/Codes/agents-era
umask 077
M1_HOST=127.0.0.1 M1_PORT=8789 \
M1_DATABASE_PATH=/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite \
M1_IDENTITY_PATH=/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite.identity.json \
npm start
```

## 验证与独立边界

- 最终目标 `1c45a60`：typecheck + Node **107/107 PASS**；完整浏览器 **94 枚举、92 PASS、2 预期 skip、0 fail**，24 批全新临时实例，不修改真实 240/min 限流。Chromium `153.0.8010.12`，桌面与手机模拟；没有真机或所有 Agent 宿主兼容性承诺。
- main 整合后：typecheck + Node **107/107 PASS**。应用／脚本内容与已审来源核对，用户预览 PID、实例和入口保持。
- 两项 skip 仅在 desktop：`mobile scrolls naturally, explores with two-dimensional touch drag, then restores page scrolling`（原生手机触控专项）；`same-document portrait to landscape viewport changes keep a single honest registration and login navigation`（手机旋转专项）。两者在 mobile 均实际 PASS；注册、登录、绑定、找回等核心流程没有跳过。
- [原专门 reviewer 最终报告](../validation/m1-account-v2-final-code-review-218d888-2026-10-17.md)：完整责任范围 `19ab658`→`1c45a60`，PASS，无未关闭 P1/P2；与作者回归分开记账。
- [普通用户覆盖](../validation/user-simulation/m1-account-v2-round-02-coverage.md)及[最后 U01b 定点](../validation/user-simulation/m1-account-v2-round-03-u01b.md)：新流程与指定残项有实际复验；218 仅做必要增量，不改写成普通模拟者整轮重跑。撤销的旧兼容 V2-F01 不写成修复通过。

完整日志、校验和、主目录保护记录、运行元数据及各阶段 QA 原件保存在 integration 的 `outputs/m1-human-account/`。初次浏览器缺默认二进制，以及两处测试遗留适配导致的中断均保留原日志；最终完整通过单独记录于 `new-account-v2-full-e2e-final.log`，不混称首轮通过。未部署公网，未操作 8787 无关服务或 8846 设计参考。
