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
| D，`01a1576e-5a22-79a2-8752-daa9b3a4e36e` | `m1-web` / `codex/world-core-web` | `apps/web/public/`下`hud/world-scene-provider.js`、`hud/world-scene-projection.js`、`hud/scene-renderer.js`、`world-scene.js`、`world-owned-layer.js`、`hud/owned-agents.js`六个生产路径；`tests/site/world-core*.test.ts`、`tests/e2e/world-core*.{spec,node}.ts`及同名helper。后继Owner摘要必要接缝另报。不制作新素材、另定视觉或修改平台HTTP/组合根。 |
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

### 6.2 公共接缝固定审查与首次整合

原reviewer在主目录 `docs/workstreams/ws06-platform/validation/world-core-code-review-2026-10-21.md` 已完成三轮静态接受，无待修项：

| 轮次 | 固定范围 | 实际结论 |
| --- | --- | --- |
| R1 | `54c30df → 970e06e`，A身份抽取/facade四路径 | 保留原M1鉴权语义，新增当前身份接缝；尚不证明真实PG或业务接线。 |
| R2 | `54c30df → 122b52f`，B六路径 | 公共事务、命令/回执及旧M1存储复用host；PG attempt和新域adapter仍待后续。 |
| R3 | `54c30df → 70cb742`，A/C七路径 | World/Interaction/Decision接口与auth单测；业务service未在该范围。 |

TD依次整合已审原提交 `970e06e`、`cf7d432`、`f7eac22`、`c52d842`、`cb49b42`、`122b52f`、`6977d608`，当前整合代码 `6a8b145`。所有cherry-pick无冲突，`git diff 70cb742 HEAD -- apps tests` 为空，无额外整合代码差异。

TD在该固定组合运行 `node --test tests/gateway/identity-access.test.ts tests/runtime/command.test.ts`，7/7通过、0失败、0skip；其中5项auth与2项command，不再相加成额外检查。第一次typecheck因integration旧node_modules缺`pg`及类型依赖失败，按既有lockfile仅重建本worktree依赖后重跑 `npm run typecheck` 退出0；package/lockfile未改。diff-check通过，工作树clean。以上是合成端口/命令工程检查，不是PG、HTTP、独立Agent或主人UI验收。

B已创建独立开发库 `world_core_b_20261021_01`，记录OID并使用0600私有配置；未操作原connet。N1候选与正式切换尚未发生。N1拟由显式 `WORLD_CORE_ENABLED=1` 启用新组合，公开指引保持候选同源，只发布实际已装配能力；不在GET或readiness中初始化schema。

A/C发现并按所有权实施leave→rejoin旧共享不能复活的边界：新增身份sharingGeneration，仅实际leave递增，pause与重新join不回退共享代次。Decision旧领取另绑定暂停/限制等当前资格版本。该后继修改尚未纳入上述R1—R3接受。

### 6.3 实现后继、独审状态与现有UI接线

原reviewer R4发现两项P2：WC-CR01场景游标暴露隐藏Agent标识，WC-CR02目标读取/事件授权泄露不可见原因。R5在C `bfe3556`静态关闭WC-CR01；WC-CR02的Avatar分支已修，但事件分支仍未关闭。C后继 `70358b3`修事件目标不存在/受限/退出统一404，保留调用者自己的资格错误及真实基础设施失败；该修订与完整C包已重新提交原reviewer，本记录不提前关闭问题。

R6已静态接受B `122b52f → 630b95b05d217cc51f76bc23fd1c68196520ba70`的16个拥有路径：具名PG适配、隔离初始化及相关测试。reviewer已读普通日志，4/4由两项utility和两项真实PG组成，不表示HTTP或N1通过。TD尚未整合该节点，等待其新增身份/领域依赖的固定独审，不把作者树的其他cherry-pick一并当作接受。

后继固定包与工程证据如下，均区别于独立验收：

| 作者 | 固定包/范围 | 当前工程结果与限制 |
| --- | --- | --- |
| C | `33598a5691642fc92d81f0551c119b3c367eff50`；World/Interaction拥有路径 | 作者clean停工。提交路径生成持久计划，1秒规则任务逐步移动，迟到不追赶；资格/版本/容量/租约和提交前条件重验。WS03三阶段与公开场景白名单已实现。精确同次26/26（World13、Interaction13）纯规则/内存UoW、full typecheck及diff-check通过；未跑PG/HTTP/独立Agent/UI。manifest为`m1-acceptance/outputs/world-core-c/final-33598a5-verification.json`，日志同前缀。 |
| B | `5a239f9`及`4c8b2ab5bd54069291e4cdcb2865edd4e1d5cb58`；已送原reviewer | durable movement adapter、提交前校验、有界runDue/close与仅领取已注册handler kinds。作者报告17/17无skip，包含真实路径不瞬移、租约重领拒旧worker、重开续进、原回执重放不重启、unknown COMMIT、40001三次重试、epoch及close排空。普通日志在`m1-storage/outputs/world-core/host-movement-node/`；owned strict typecheck通过，旧full诊断的C fixture hook已由C703补齐，后继完整组合另验。 |
| A | Decision编排已形成固定节点，HTTP组合仍在实现 | 作者真实隔离PG Decision4/4覆盖三手动阶段/真实C回执、no_action、unknown保额和暂停恢复后旧claim失效；尚非N1。HTTP根计划实际启用1秒有界无重叠规则循环，关闭时先停循环并等待runDue再关pool。 |

以上C、B包与A的`7a69a294`/`553a28b6`身份后继已按拥有路径送原reviewer，结果待回执。当前integration代码仍为R1—R3接受的`6a8b145`，未启动18893，未对外给新核心入口。

总指挥已授权先将现有主画面接入真实状态，不等待新美术。C完成固定包后停止编辑释放执行资源；D原会话恢复，TD核对其worktree clean且仍在旧`001ae3f`后，保留旧分支并从已审整合`2a7cf61`新建`codex/world-core-web`。D实际模型轮次及精确路径待其回执；不由派单推定核实。

A/C冻结公开读取为候选同源`GET /v1/world/scene`和`GET /v1/world/rules`。场景返回当前获准公开Avatar、白名单资料、权威逻辑位置及版本/时间/分页；不含完整路径、movementId或私有暂停原因。D仅投影这些真实位置，插值不是业务动作；不把旧地图道路/场所或演示漫游冒充新引擎事实。Owner互动摘要必须使用有效Owner session、有效binding和来源许可，不用Agent runtime身份代读。

候选交接将同时注明新隔离Owner正常网页注册/绑定是否可用、实际测试验证码/邮件模式及人类允许观察范围。总指挥安排两个独立Agent先无Owner绑定完成N1/N2，随后可由一个新Owner绑定两者。Agent给主人的私密绑定链接由测试会话另存0600交接文件，只传路径给获授权UI模拟者，不转交runtime凭据。N1交付后保留新身份、绑定材料和业务状态供N2续验，不能静默重建。上述流程尚未执行，独立AgentHTTP与人类UI不记PASS。

### 6.4 N1 HTTP固定稿与后继审查

原reviewer R7在`33598a5`关闭WC-CR02，WC-CR01保持关闭；八个World路径单独静态接受。Interaction新增WC-CR03/P2：`listCurrent`过滤不可见邀请后仍用其明文ID续页。其余七个Interaction路径尚未整体接受，A拟议的Gateway游标包装不能替代域public port修复。B完成后停止编辑释放资源，TD已派原C在335固定基准修复，并要求与A协调新游标签名、保留隐藏整页/页尾及基础设施故障反例。

R8接受A原`7a69a294`、`553a28b6`两个自身身份diff；R9接受原`8dc9527`三路径提交前认证复核。各轮未把作者树其他cherry-pick混入接受。B后继及A Decision/HTTP仍待报告，不由已审World推定整条N1通过。

A固定N1为`c1ce50e8ca2095fe36b32b2d4fb3febe15b9076b`，自身13路径294增19删，依B1754、C335及A8dc/8f。N1只发布World模块，不启用Interaction/Decision业务能力，也不在GET/readiness中初始化模板。TD已读作者`m1-api/outputs/pg-async/world-gateway-n1-manifest.json`及普通日志：准确18/18＝2真实HTTP故事、4Decision PG、8auth、3config、1driver，无skip，full typecheck/diff-check通过；18包含此前Decision4项，不重复相加。HTTP证据包括独立HTTP注册和身份、发现精确接口、Avatar及pending路径在服务器驱动下完成、公开来源撤回隐藏，另含闭门build/health/public/wallet不持久写。作者18894服务、pool及逐例库已关闭清理，未给外部测试者交付。

B最终固定`1754a36e9262578374ae05a5ca07295d01485b62`，clean停止编辑。真实关联反例先在旧5ff schema失败，再追加Interaction v2复合FK修复；旧迁移字节保持。最终schema signature为`d130a37cf5a1a0de1951c585b09c5c860b545e9e171fa01dadc3e25903888d38`。准确HEAD的22/22无skip/cancel、完整typecheck和diff-check为0，manifest/普通日志/命令归`m1-storage/outputs/world-core/final-1754a36/`。保留B初始化库在旧5a源码创建真实合成Agent/Avatar/pending路径后原地升级，79表98行语义hash、配对identity、instance及epoch保持，机械write_generation及迁移history单列排除，最终写门关闭。该结果是B隔离作者验证，非正式connet或独立Agent验收。

候选初始化使用最终受审整合源码调用B显式维护入口；先以关门状态启动同一源码检查readiness，再明确开写门。N1入口不初始化Interaction；后继N2用独立模板维护入口并保留候选身份/数据。TD仍未创建`world_core_integration_20261021`或启动18893。

D实际轮次`01a15a58-dd2d-73b0-ad34-7068c82e7fd7`，UTC `2026-10-20T17:29:45.887Z`，已回执`gpt-6.1-sol`/`xhigh`。已冻结六生产路径。页面可见时允许不快于1秒的有界只读刷新，无重叠、失败退避、切页/hidden/destroy取消；恢复先新读，迟回不能覆盖新轮，撤回/权限变化清旧资料。此刷新服务于人类正在看的场景，不是外部Agent定时执行或业务动作；不增加访问频率设置，不把失败缓存继续动画为实时行为。

### 6.5 N1固定整合、隔离启动与实际交接

原reviewer R10—R15分别接受A Decision、B后继与关联约束修复、A N1、C密文续页及A模块／文档版本后继。WC-CR01—04均关闭，具体固定差异和证据以唯一独审报告为准。TD仅无冲突cherry-pick各作者已审自有提交；至`917d4e7101de2cac98145a77d478f18739e5c476`完成A/B/C组合，后继A `1ffc322`整合为`b55fc04f7bae92ecda848890fea911241881f968`。未手写新增业务代码，未把作者分支中的其他依赖重复并入。

TD在917d4e7运行70/70、fail／cancel／skip均0，包括A18、B22、C30同次组合；完整typecheck及diff-check退出0。随后在b55fc04仅运行模块注册与N1 HTTP受影响4/4、fail／cancel／skip0，完整typecheck与diff-check退出0。两份固定版本分别记录，不称同版74项或全量回归。普通命令、日志及manifest分别在integration的`outputs/world-core/integration-917d4e7/`与`outputs/world-core/integration-b55fc04/`。真实PG测试使用作者隔离fixture，不操作正式connet；这些工程结果不替代独立会话Agent。

N1实际运行资源如下：

| 项目 | 实际值 |
| --- | --- |
| 固定源码 | `b55fc04f7bae92ecda848890fea911241881f968` |
| origin／公开入门 | `http://127.0.0.1:18893`；`http://127.0.0.1:18893/agent/entry.md` |
| 新隔离PG库 | `world_core_integration_20261021`，使用既有专用PG的loopback15432；不使用正式connet |
| instance／epoch | `instance_f7bc19f2-4ce2-4804-a746-c686eed723e8`；`epoch_185c2209-fa9c-4fd1-8ab5-87dc6dbac5cd` |
| schema signature | `d130a37cf5a1a0de1951c585b09c5c860b545e9e171fa01dadc3e25903888d38` |
| 进程／固定cwd | PID`92107`；`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/world-core/n1-b55fc04/source` |
| 固定源码包 | 上级目录的`source.tar`，SHA256 `eead405bd4b091a7a4ce788fdb135ceb5ce4a2b630d0c46c07fc419c1a5f5109`；依赖独立复制，非共享symlink |
| 运行私有目录 | `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/world-core/private-td-20261021`；配对identity、连接与backend.env保留，秘密不进入普通记录 |
| 状态与生命周期 | 显式初始化、关门启动、匿名就绪检查后显式开门；N1验收期间保持运行，不自动drop／重建 |

TD使用已核当前0600维护配置`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/postgresql/private-local/runtime.json`，从上述固定归档调用显式World初始化；未使用旧physical-backup配置。初始化只建立catalog／World／domain generations，Interaction模板未初始化。关门状态的health、首页、owner、entry、capabilities、discovery、scene、rules八条匿名GET均200且no-store；初始scene为0 Avatar，未由TD注册。原始响应与修正后的header解析记录在`outputs/world-core/n1-b55fc04/closed-*`。入口SHA256为`09c039458e219a79b56187c361e9a2122e6958f4ce26a51aa8a5bced3cc19567`；能力仅发布World，catalogRevision为`gateway-fc612a985bde83788ce44b4d`，实际启用字段为`caps.gateway.worldSimulation.enabled`。开门CLI明确返回writesEnabled=true，随后health仍ready。

总指挥已收到固定入口和资源，并回执启动原独立Agent验收负责人及其A/B。各自通过公开指引与实时能力自行发现、注册、创建Avatar和移动；TD不提供隐藏命令或代执行。N1身份／状态和同origin／instance／epoch保留供N2；等待总指挥双边安全检查点再短停原地发布。原8789／正式connet、旧身份、其他端口和公网未动。

当前运行页面仍旧前端。D真实事实适配尚未部署，不能以旧演示推断真实Avatar或UI通过。Owner正常网页注册／绑定源码已有，但本候选未做独立浏览器提交；实际experience邮件模式的公开测试码为四位`1234`，不是真实邮箱验证或真实发信。绑定私密链接由各Agent保存在0600交接文件，仅给获授权模拟者路径，不传runtime凭据。

### 6.6 后继独审、前端合同缺陷与视觉并行

R17接受B `1754a36 → cb17ce9`两路径顺序解码修正，R18接受A `bb61653 → 758266a`九路径显式N2装配与Owner最小摘要，R19接受D `da39c02 → 24f162a`四路径Owner摘要界面。R16与R20曾接受D N1适配及未运行浏览器脚本，后因TD读取实际候选capabilities发现层级接错，原reviewer在R21正式记WC-CR05／P1并撤回这两项接受；保留原审查历史与错误fixture下的20项结果，不追改为已正确接通。实际后端在gateway内返回worldSimulation，而D旧provider和脚本读取顶层，阻断真实场景显示。该D代码未部署，不影响已开放N1后端。

原D以`08dbebf → ebe76777c15b68d2e465853b934844d9c161630c`三路径修复provider、真实嵌套形状正反例及待运行E2E断言；定点9/9、语法、full typecheck／diff-check通过，证据在`m1-web/outputs/world-core-web/td-n1-ui01/`。已送原reviewer复核，本文不提前关闭WC-CR05。D七项Owner摘要和浏览器脚本静态结果分别守自身范围；尚无D真实HTTP／浏览器或独立UI通过。

用户后继已明确“继续视觉制作与整合（推荐）”。原设计总监继续原430素材的完整像素小镇预览／适配与生产合同，人物先左右朝向。TD已同步实时World 16×16整数逻辑格、版本1、spawn(0,0)、无blocked、唯一commons场所、每规则步1秒及公开白名单DTO；格未定义米。D临时中央投影仅为视觉映射，可随合同更换，不能改变服务器位置、障碍、场所／路径规则；若涉及规则由C/B负责固定送审。环境可动，真实Avatar不能补假漫游／在线。核心N1／N2与视觉并行，不等待新美术才开始独立验证。
