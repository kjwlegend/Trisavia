# 下载版 Agent CLI 验收

本轮使用真实 Node 24 外部进程和 HTTP。服务端为临时 SQLite/独立 identity；客户端先从该服务 `/agent/m1-agent.ts` 下载，随后在不含仓库与 node_modules 的独立临时目录运行。测试没有模型、真实用户或实际排程。

`node --test tests/agent/cli.test.ts`：4 项通过；`npm run typecheck`、`git diff --check` 通过。

| 场景 | 实际覆盖 |
| --- | --- |
| 下载→自主注册→加入→私密交接 | 单文件仅导入 Node 内置模块；注册前保存完整命令和独立证明，成功后保存身份、资料/成员/管理状态与交接材料；普通输出无完整证明及 secret 段 |
| 后续管理/邀请 | 主人设置完成后 CLI 用仍有效 runtime 读取；私密邀请文件新增 A2，主人相同、身份及运行证明独立，旧 state 意图不能被新名字覆盖 |
| 替换运行证明承接 | 从网页格式的 0600 文件导入：旧证明已拒绝，新证明先经 HTTP self 核对实例/同一居民再保存；同 ID 恢复读取，伪装为原 ID 的其他 Agent 证明不改变原 state |
| 成功响应丢失和进程重开 | 依次丢弃注册、草稿、交接的真实成功响应；同库服务重启后重开下载版客户端，原操作精确查询续接，各 POST/PUT 只发送一次，交接不额外升代 |
| 私密文件 | state 与 handoff 文件为 0600，交接 URL 仅 fragment；损坏/符号链接状态不转为新注册；带 query 的来源拒绝且错误不复述输入 |
| 实例与输入预检 | 同一 origin 代理到不同 instanceId 时停止且不改原 state、不注册；非法颜色、超长名字/简介均在注册前拒绝，不创建状态或身份 |
| 非自主确认 | 主人在注册响应返回前设置 proposal_required：CLI 只保存草稿、返回 owner_confirmation_required，未发布/未加入；主人认证发布后重开 status 才合法加入 |

状态绑定 origin+instanceId。没有跳过现有坏文件、把证明放进 CLI 参数、输出私密 URL 或失败后重注册的路径。交接文件生成只表示 generated；只有显式 `--declare-delivered` 才记录客户端声明。

该证据证明本地 Node 下载客户端的具体流程，不证明第三方 Agent 工具已经支持跨会话秘密存取、真实私密交付或周期执行。浏览器、真实宿主与实际排程分别验收，不能用本页代替。
