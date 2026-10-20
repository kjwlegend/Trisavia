# 双 Agent 世界核心：执行合同与交付记录

## 1. 授权、固定依据与范围

总指挥于2026-10-21明确开始实现。技术总监仅统筹接口、资源、整合与验证，业务实现交独立 Sol 作者。统一代码基线为 main `676c38a287d1c17a50c28ea9b59dbd9dcc610931`；本文件是该基线上的 S0 执行约定，不修改其他 WS 的业务规则。

最终架构文档在主目录 `/Users/kjw/Workspace/Codes/agents-era`，各工作树旧版文档不能替代本轮已审依据：

| 文档 | 复核时 SHA256 |
| --- | --- |
| `docs/workstreams/ws06-platform/architecture/README.md` | `be4c8194f876af11b60e502a1d66812ca349e57676a5636d519eb1eeef08ac57` |
| `docs/workstreams/ws06-platform/architecture/data-and-agent-api.md` | `8d5fa794564a67feadfdd276aa6ec9617bb65c19c2c027202aeede75a1bcb22d` |
| `docs/workstreams/ws06-platform/architecture/extension-contracts.md` | `4d604259c2802f0c85aa9fa948ca40f32c1f82241232998dabbd2e54219d558b` |
| `docs/workstreams/ws05-real-world/03-technical-design.md` | `c031e10c342775b4707c3a6c54eecfb21e33732ddeca79ed811e2295852407e3` |

保留既有身份、主人管理、资料、背包、钱包、四类信箱功能；新增独立 Gateway、World、Decision 和 WS03 双人文本反馈。可重建本项目本地测试结构和数据，不要求兼容旧协议或导入旧数据。当前阶段使用新隔离测试库；具体端口、数据库、实例及启动版本在本记录追加后才能作为交付入口。原8789先继续现有运行，项目其他服务、公网、原始 Sunnyside 素材和密钥不在本轮修改范围。

首片使用手动 HTTP；不安装 Node 客户端或 Agent 定时器。完整 snapshot/changes、全量 AWP、通用插件安装平台、WS05 市场、完整经济和新美术不是首片前置。设计师当前只制作规范；前端作者在相应设计合同具备后接入，不自行发明视觉风格。

## 2. 唯一文件所有权

所有作者使用 `gpt-6.1-sol` / `xhigh`；配置和实际轮次核验另记。每名作者独占自己的普通 Git worktree，禁止回滚其他作者改动。原分支与 ignored outputs 保留。

| 角色 / 稳定 ID | worktree / 新分支 | 唯一写入责任 |
| --- | --- | --- |
| A，`01a1576d-e964-7323-a8df-fec8881db720` | `m1-api` / `codex/world-gateway-decision` | `apps/platform/domains/decision/**`、`application/decision-service.ts`、`application/agent-gateway*.ts`、`transport/http/agent-gateway*.ts`；`app.ts`、`server.ts`、`configuration/**` 组合根；身份接入适配及必要 M1 最小抽取；能力、schema/guide、`docs/access/v1/**` 与初始公开指引；`tests/gateway/**`、`tests/decision/**`。 |
| B，`01a13916-86a5-7dc0-af80-efabb15c492d` | `m1-storage` / `codex/world-persistence-scheduler` | `infrastructure/postgresql/**`、`infrastructure/scheduling/**`、`contracts/runtime-store.ts` 及 `domains/runtime/**` 公共事务/回执/事件/Outbox/任务端口；`tests/runtime/**`、`tests/storage/**`；隔离本地数据库初始化/检查脚本 `scripts/world-core-*.ts` 与必要 ops 文件。 |
| C，`01a13917-146c-7aa2-91ff-c6bd5d2501ce` | `m1-acceptance` / `codex/world-interaction` | `domains/world/**`、`domains/interaction/**` 及其 `repository.ts` 业务端口；`application/world-service.ts`、`application/interaction-service.ts`；`tests/world/**`、`tests/interaction/**`。本轮是代码作者，自测不能作为独立验收。 |
| TD，`01a138f6-2c0e-75a1-87fe-ee0735493f4f` | `m1-integration` / `codex/world-core-integration` | 本执行记录、资源生命周期、作者提交整合、固定差异送审、交付证据；不代写业务实现。 |

根 `package.json`、锁文件及 `tsconfig.json` 由 A 唯一写入，先向 TD 报必要性；B/C 的需求回派 A。`contracts/store.ts` 和现存 M1 具名仓储默认不扩写为新世界总表，若确需公共接缝由 B 所有、先通知 A。A 的身份抽取文件与 B 存储适配文件分开。其他路径发现必要变更先报 TD 分配，不抢写。

## 3. S0 最小接线

各业务 owner 先提供可编译的类型和端口小提交，随后实现；具体 TypeScript 签名由实际作者协商并记录，不能由两个作者各造一套接口。B 维护公共运行事务，A 维护 Decision 端口，C 维护 World/Interaction 端口。B 的具名 PG adapter 实现 A/C 定义的业务仓储端口。

| 接缝 | 固定语义 |
| --- | --- |
| 当前请求上下文 | principal/agentId、凭据版本、recoveryEpoch、用途来自服务端当前认证。每次查询及提交在当前事务重验；请求体不能自填身份。Owner 不代替 Agent 业务签名。 |
| 事务宿主 | 同一 PG 事务内供具名仓储参与；新旧身份撤销/暂停与新业务提交共享有效的并发栅栏。可复用现有 instance 行锁机制，不能在事务外认证一次后信任陈旧结果。事务回调无外部模型、网络或用户工具。 |
| 命令与回执 | `commandId`、域/动作、主体、recoveryEpoch 加规范化请求摘要定义同次操作。相同键同正文返回同次结果；不同正文冲突。未知提交先查原回执，不换键重做。回执读取重新判权。 |
| 业务提交 | 业务状态、事实 eventId、命令回执、Outbox 和所需下一阶段事项/任务原子提交；Decision 的目标命令与结果可稳定关联，不能出现接受成功但活动缺失。 |
| 版本 | 对象 version、规则/模板 version、授权 version、任务 fencing/generation 分别定义；不要以一个版本号替代全部语义。非创建动作明确 expectedVersion；公开 schema 如实说明。 |
| 读取 | 场景/Avatar/有效邀请/有效决策可分别查询，返回各自版本、查询时间、范围与完整性。事件分页稳定，但不冒称全平台增量断点或跨域原子快照。 |
| 错误 | 有界错误包含稳定 code、可公开 message、requestId；至少区分认证失败、权限不足、不可见/不存在、版本冲突、同键异正文、过期/已撤销、预算不足、busy/unavailable、unknown_commit。未授权不返回私密对象版本或存在性。 |
| 调度 | 确定性任务持久 dueAt、kind、target/version、lease/fence/generation 和有界重试。领取后提交再次验证租约和当前业务条件；过期旧 worker 不能提交。处理器属于原域，通用执行器不发明业务规则。 |
| Outbox | 同库提交事实；投递/投影按事件/消费者去重，失败不回滚已提交事实。当前权限控制可见引用。通道 ACK、可靠消费进度、Agent 正文版本确认、业务接受各不相同。 |
| 决策 | durable pending/claimed-or-dispatched/responded/resolved 与 expired/cancelled/failed；明确领取、独立回应命令、当前业务结果关联。responded/resolved 不意味着业务成功。外部结果未知保持占额和核对路径。 |
| 预算 | 首片约束平台派发次数等可实际保证的额度，原子预留；真实模型/工具费用由外部宿主控制。不伪称平台知道真实 token/费用，不因未知释放后再发重复调用。 |

接口变化由生产者通知消费者及 TD；补充记录不得改变 WS01 身份、WS02 可见性或 WS03 规则。完整增量未实现时仅保证当前状态＋原回执恢复。

## 4. 最小业务切片

World：稳定 Agent 引用与 worldId 唯一活动 Avatar；持久逻辑坐标、当前场所/状态及版本；合法路径/边界/版本校验的移动；服务端权威查询。逻辑格与屏幕像素分离，具体映射等待设计规范。场景只实现同场所范围时就叫“同场所”，不得称精确附近。世界规则任务由受控调度调用，不把画布动画作为业务事实。

Interaction：A 固定自有文本版本并邀请 B；B 自己读取、领取并接受或拒绝；接受原子形成唯一 `waiting_feedback` 活动；B 在外部宿主生成并提交反馈，进入 `waiting_ack`；A 读取反馈后明确结束，进入 `closed/received_confirmed`。确认仅表示收到，不等于满意、采用、学习。Decision 三阶段为 B 接受、B 反馈、A 结束，各阶段去重。

邀请终态包括 accepted/declined/withdrawn/expired/unavailable；活动另有 cancelled/expired/unavailable，不复活终态；结果区分 received_confirmed/submitted_unconfirmed/no_feedback。具体字段及屏蔽/撤回/并发规则归主目录 WS03 当前技术稿及 plan 对应段。远程文字反馈不强制同场所，World 创建/移动单独验证。

开发默认可采用邀请、反馈、确认各7天，作为有版本模板参数存储并在指南展示；正文和字段使用明确有界默认，由 C 根据 WS03 定义。过期用注入时钟/隔离夹具验证，不声称实际经过7天。

两个独立 Agent 可属于同一主人，但必须使用各自注册身份和凭据。独立测试由总指挥调度，不使用单个作者脚本冒充两个会话。

## 5. 交付节点与审查

1. N1：新隔离 PG 初始化；现有注册/主体链可用；公开 capabilities/schema/guide 正确；两个身份各自创建 Avatar、合法移动并回读持久位置，重启不丢状态。作者工程验证，不冒充独立 Agent。
2. N2：完整文本反馈三决策闭环、双方共享 eventId；覆盖拒绝、到期、撤回/屏蔽、越权、重复、冲突、未知响应恢复和受控任务重领。
3. N3：每作者固定提交与针对性证据交原独立 reviewer；原作者修复、原 reviewer 复核；TD整合后的新增差异同样独审。相关既有功能按影响验证，未测范围列明。
4. N4：告知总指挥固定候选源码、端口、公开入门指引和真实/演示数据范围；其调度两个独立会话与主人 UI。后端可先验收，新美术按后续设计合同整合。

不在运行旧库上试改 schema。作者可使用明确隔离数据库进行测试，须记录名称/创建归属/关闭清理状态，不输出连接密码或 Agent 凭据。端口和临时服务须限 loopback；原8789切换另记录实际资源、当前备份、停启与新版本，不扩大公网。

## 6. 执行回执

S0 文档建立时所有四个工作树均 clean；旧分支分别为 `codex/pg-async-application`、`codex/pg-domain-storage`、`codex/pg-migration-ops`、`codex/pg-integration`。尚未形成新代码或运行结果。后续在此追加实际提交、配置核验、测试、独审与交付状态。


### 6.1 实现启动与首片业务参数

2026-10-21，A/B/C均收到明确实现任务，三个工作树已由TD从clean旧分支切至第2节新分支，共同起点 `54c30df55e56c90dba80a33966329f97bf268a0e`。该提交仅含本S0文件。三位各自核对本轮精确 `turn_context`，实际为 `gpt-6.1-sol` / `xhigh`；A/B/C报告时间分别为UTC 2026-10-20 16:39:34.621、16:39:35、16:39:45.796。配置核对不代表实现或测试通过。app聊天工具不能向v2子代理派发，已沿用原collaboration任务，没有因此替换负责人。

WS03已将参数写入主目录技术稿“本轮核心实现切片”，123行，核对时SHA256 `cba6c42b1c6aaa98034da28ff4e9769bf2e1003e3edad4c90b8e4277cd0f80f9`：正文1–4000、反馈1–2000、意图1–300 Unicode码点；可选标题不超过80、拒绝/退出理由不超过300；空白必填拒绝、不截断；窗口各604800秒。发邀请时固定模板/配置及三个窗口和内容限额，后续配置不追改既有事项。C已收取权威依据。

WS01明确自主注册Agent无需主人绑定即可使用独立runtime参与；pending_setup的ownerId不是有效绑定。Owner观察仍须有效session、有效binding及来源许可。A/C已收取，Decision无Owner时使用适用Agent/平台派发约束，不虚构Owner额度或真实宿主费用。

资源预留：TD候选 `127.0.0.1:18893`，A可用18894，C可用18895；预留时三端口无listener，仅为计划，不表示已启动。候选新库名称拟 `world_core_integration_20261021`，由B提供显式初始化后TD创建。原15432现有PG转发保持，未操作原connet、8789或其他服务。原独立reviewer已收到新批范围；仅在收到后续固定base/head后开始实审。
