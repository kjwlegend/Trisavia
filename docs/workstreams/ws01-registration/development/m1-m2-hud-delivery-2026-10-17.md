# 桌面 HUD 本地交付 · 2026-10-17

日期：2026-10-17，Asia/Shanghai。实施与整合：原技术总监及原前端／验收作者。

**已完成桌面 HUD 的审后主线整合和本地 8789 更新。**M1 沿用真实账户与 Agent API；M2 仍是主动进入、明确标识的只读演示。手机统一后查，本次未部署公网、实施目标架构或真实 M2 后端。

## 1. 固定源码与主线整合

| 项目 | 实际结果 |
| --- | --- |
| 整合前 main | `eea82653d1f99d1ab9aaf25fc22ad638ab4d8633` |
| 已审候选／主线代码提交 | `fd2e9aee9b661f1d35af927f130065d46a31e525` |
| 整合方式 | 核验祖先关系及范围后 `--ff-only`；仅 24 个应用／测试文件，1264 行新增、178 行删除；无冲突处理或新增代码 |
| 产品树指纹 | Git `apps` tree：`18be6db9170aa452c4ff24940c57b11845429d4c` |
| 用户运行只读快照 | `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-m2-hud/user-delivery-fd2e9ae` |
| 导出校验 | 从固定 Git 提交导出；117 个文件的 SHA-256 清单与已审 QA 快照完全一致。源文件 0444／目录 0555；仅 `outputs/` 可写，依赖指向主目录已安装的 `node_modules` |
| 完整运行与资源清单 | `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-m2-hud/local-delivery-fd2e9ae.json` |

主目录既有文档迁移、设计及其他未提交工作均未纳入此次代码整合。整合前对 675 个既有变更文件记录校验值；架构稿 `agent-discovery-protocol.md` 在该窗口内的并发变化保留，未回退或覆盖。保护记录为 `outputs/m1-m2-hud/main-pre-hud-integration-20261017T140911Z.json`（位于 integration）。本交付文件是单独的实现记录，不代改治理、INDEX 或会话登记。

## 2. 当前可用入口与用户数据

- [世界首页](http://127.0.0.1:8789/)
- [主人管理／注册登录](http://127.0.0.1:8789/owner)
- [Agent 接入](http://127.0.0.1:8789/agent/entry.md)
- [健康检查](http://127.0.0.1:8789/health)：`ok / M1 / apiVersion 1`

| 项目 | 本次核验值 |
| --- | --- |
| 用户实例 | `instance_6ee4d865-1e1a-4b40-90eb-2dbe6c46165f`，更新前后相同 |
| 用户数据库 | `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite`，沿用原文件 |
| 配对 identity | `/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite.identity.json`，沿用原文件 |
| identity SHA-256 | `f950f2a9d4df36be1b982160bc9ca76ff607d9c124fdc0cef4ad9d8a8729170d`，更新前后相同 |
| 新运行进程 | 初次启动 PID `20233`，exec session `15437`；重启后 PID 会改变 |
| 启动数据检查 | 启动前后各表记录数一致；未重建主人／Agent、清库、迁移或复制 QA 数据 |

先核验旧 8789 PID `24630` 的端口、cwd、实际打开的用户库及 health，再完成在线一致备份，最后仅对该进程发 SIGTERM。退出后另做一份最终一致备份，再从新快照启动。数据目录及秘密文件沿用 0700／0600；备份目录 0700、备份文件 0600。

备份目录：

`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-m2-hud/user-8789-backup-before-hud-20261017T141123Z/`

- `live-consistent.sqlite`：旧服务仍运行时，用 SQLite backup API 生成的一致备份。
- `stopped-consistent.sqlite`：旧服务正常退出后生成的最终一致备份。
- `m1-account-v2.sqlite.identity.json`：配对 identity 副本。

两份数据库备份均通过 `PRAGMA quick_check`。没有以复制正在写入的 SQLite 主文件代替一致备份，也没有将 QA 库用于用户运行。

## 3. 已有验证与本次启动检查

| 检查 | 精确范围与结果 |
| --- | --- |
| 最终候选自动化 | `fd2e9ae`：typecheck 通过；Node **107/107**，无跳过；desktop 项目 55 项中 **53 通过、0 失败、2 原有手机场景跳过**；未运行 mobile project |
| 原代码审查及修订 | 专门 reviewer 完成初审及 c60→f7 增量复核，HUD-R1／R2／C1 fixed/verified。f7 实际 25 个不同桌面用例通过；其中恢复 fixture 首次 429 和一次有界复验按原报告保留 |
| 最终四文件增量独审 | f7→fd **PASS**，无新增 P1／P2；独立 5/5 桌面 E2E，另验证偏好作用域、当前 401、退出、另一主人及旧响应／旧 401 不干扰新主人；未冒称该轮重跑 Node107 或全55项 |
| M1／共同 HUD 设计 | f7 上 HUD-D01 fixed/verified：1440×900／1280×900 的 Dock 避让、四槽实点、单窗口、视角与焦点；最终增量未改样式，保留该版本实看范围 |
| M2 设计 | f7 上 M2-D01／D02 fixed/verified：两桌面尺寸下名称／日期及相邻筛选返回；最终增量未改几何或演示内容，不扩大为真实 M2 或新版本全量视觉验收 |
| 普通用户闭环 | 原 R1 核心故事、f7 的 HUD-U01、fd 的 HUD-U02 按各自版本保留。fd R3 实际选择非首项→刷新→个人→管理→真实品牌首页返回同对象；正常退出重载无残留，定点 PASS |
| 本次交付必要检查 | health 同实例；首页、owner、5 个 Agent 说明／客户端入口及全部允许公开的静态资源，共 **57 项 HTTP 200**、字节 SHA-256 与固定源码一致；`nosniff`／`no-store` 保留，演示 JSON MIME 正确 |

最终全套日志、每批清单和问题对照见 integration 的 `outputs/m1-m2-hud/review-handoff-fd2e9ae.json`。此前 `1d4ffd7` 全量尝试在选择目标前，因“第二个创建对象必非首项”的 fixture 假设失败；原证据保留。最终测试按真实 option 顺序映射本人对象，仍明确断言非首项，保留身份／形象／真实品牌导航及隔离要求；最终固定版本的全套结果另列，不改写旧失败。

独立原件：

- [代码报告第 6／7 节](../validation/m1-m2-hud-desktop-code-review-2026-10-17.md)
- [M1／共同 HUD 设计第 6 节](../validation/design/m1-m2-hud-desktop-2026-10-17.md)
- [M2 设计第 6 节](../../ws02-perception/design/visuals/m2-desktop-hud-2026-10-17/frontend-desktop-review.md)
- [普通用户 R1／R2／R3，第 7 节为最终 U02](../validation/user-simulation/m1-m2-hud-desktop-round-01.md)

本次只做交付／启动必要检查，未重复全套自动化或新增 UI／手机验收，不扩大上述独立结论。

## 4. 重启与回退

旧稳定快照保留：

`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/m1-human-account/new-account-v2-feedback-snapshot`

常规重启使用本节相同的原用户库和 identity，cwd 为第 1 节新快照。回退时先用 `lsof -nP -iTCP:8789 -sTCP:LISTEN` 取得实际 PID，再核对其 cwd／源目录，仅停止核验过的本项目进程；随后在上述旧快照目录使用同一参数启动：

```sh
M1_HOST=127.0.0.1 M1_PORT=8789 \
M1_DATABASE_PATH=/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite \
M1_IDENTITY_PATH=/Users/kjw/Workspace/Codes/agents-era/data/m1-account-v2.sqlite.identity.json \
node apps/platform/server.ts
```

本次没有数据库迁移，常规源码回退继续使用当前用户数据，不回灌旧备份覆盖后续写入。重启后复核 health 的原 instance 和入口。原／新快照及依赖都是运行／回退资源，清理 worktree 前须保全，不能随临时 QA 一起删除。

8799 的最终 QA 快照、库、identity 和合成身份保留，实例仍为 `instance_4d17393d-8d4b-4006-afe7-869eaa9db5d5`。8787、8846 及公网未操作；真实 Agent 宿主兼容性、手机和真实 M2 仍不在本次交付范围。
