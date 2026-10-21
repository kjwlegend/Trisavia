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

R22随后静态接受D `ebe7677`并关闭WC-CR05，D最终11指定路径获接受；旧da39／08db单独版本仍含已记录问题。TD将B cb17、A758、D3fb／e680／da39／24f／08db／ebe无冲突整合为`b5f0285b1f5c4cd850689c86a2fbf8eb216ec942`。后端拥有路径与A消费B后的`d7554e2`完全一致，前端／site／E2E与D ebe完全一致，无手写整合差异。

TD在固定b5f0285运行受影响38/38、fail／cancel／skip0：两N1 HTTP、两N2 HTTP、两registry、三config、一真实PG邀请分页、九修正后公开场景、七Owner摘要、十二既有owned／map检查；full typecheck与diff-check0。命令与日志在`outputs/world-core/integration-b5f0285/`，仅使用隔离A/B fixture及18894，不访问正在独立验收的18893或正式connet。前序70／4及作者结果保持各自版本，不累计称一次全量。

N2固定包已准备于`outputs/world-core/n2-b5f0285/source`，archive SHA256 `49fb1d6e596b258d8e6e47698869c542fe3c91d8edee8e42f525ceddd01cb087`，package-lock SHA256 `3bc1406cc0c0febcdfa49a95dc0c6661534a8883f83dcb06a00e27e62753d7b0`，依赖独立复制。此时尚未运行N2；18893仍为b55 N1。TD另只读保全N1公开目录引用的21份精确schema／guide响应，均200／no-store，见`n1-public-documents.json`，供升级后核对旧文档摘要。等待总指挥双边安全检查点后再备份当前库及identity／配置、显式初始化模板和原地发布。

### 6.7 N2原地切换与继续独立验收

总指挥回执独立A/B均达到N1安全检查点并停止HTTP：A位置(1,0)、B(0,1)，双方经完整公开场景发现对方；B首次pending后真实回读completed，正式脱敏报告仍在整理。此回执用于安排维护，不冒称TD独立完成其验收。总指挥明确允许同origin／instance／epoch原地发布已审N2与D事实适配，保留两身份及数据。

TD先保存当前新库live一致逻辑dump及配对identity／私有配置，再核对PID92107的固定cwd后SIGTERM排空，确认18893无监听；另保存stopped一致dump。两dump均经`pg_restore --list`成功，未执行本次dump恢复演练。秘密文件留在0700目录／0600文件`outputs/world-core/n2-b5f0285/maintenance-private/`，普通索引`preflight-backup.json`、`maintenance.json`不含凭据。stopped dump为402857字节，SHA256 `ec4cbccabbef596aa331213ed0b4e72fe36627e372dbcc3056f2fc1a7cd5c24d`。

对唯一目标`world_core_integration_20261021`只读采集完整80张用户表、168行的全列SHA256；显式调用已审`world-core-initialize-interaction.ts`后为169行，仅`interaction.configurations`由0到1。其余79表语义hash保持，`platform.instance_state`的write_generation／writes_enabled两机械字段单列排除；instance／epoch及identity文件SHA256保持。模板维护返回text_feedback／templateVersion1／configVersion1、写门关闭。没有迁移、World／目录重seed或身份重建。

私有backend.env显式追加`WORLD_CORE_INTERACTION_ENABLED=1`，使用固定b5f0285归档关门启动。health、首页、owner、entry、capabilities、discovery、scene、rules均200／no-store；闭门启动前后80表169行全列hash完全相同。两Avatar完整公开事实及worldRevision7与切换前一致，旧21份精确World schema／guide内容和digest不变，D八个生产资源HTTP字节与固定源完全匹配／no-store。上述文件分别保存在`stopped-before-continuity.json`、`after-template-continuity.json`、`after-start-continuity.json`、`closed-readiness.json`及原始响应。

北京时间2026-10-21 **02:14:29.557**明确重新开写门，health ready；从正常停服到完成为96.09秒。当前PID **907**、固定cwd **`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/world-core/n2-b5f0285/source`**，源码 **`b5f0285b1f5c4cd850689c86a2fbf8eb216ec942`**。origin／公开入口、库名、instance和epoch沿第6.5节不变。公开模块实际从`[world]`变为`[world,interaction,decision]`，catalogRevision为`gateway-26efefe55243d028819b88ae`。总指挥已收到实际可恢复时间及资源，只需提示原A/B重新发现实时能力；没有重发身份或私密操作捷径。

原D收到运行已审公开浏览器故事的任务，限新空context、匿名首页／owner和公开事实、使用现有双Avatar，不创建账户或借凭据。此时脚本尚未回报，独立N2／Owner UI和新视觉仍未记通过。N2后所有新增状态继续保留，不回灌本次维护前dump；任何后继切换再做fresh备份。原8789／正式connet、其他端口、历史资料及公网未操作。

### 6.8 作者浏览器工程与视觉接续

D随后在固定执行树`ebe7677`对运行b5f0285执行已审`tests/e2e/world-core-public.node.ts`：同一新空context、1440×900、首页和`/owner`的一项故事1/1通过、无skip；两真实Avatar与实际公开响应字段一致、无demo actor及公开World请求Authorization、键盘详情／手动刷新通过、未观察到pageerror。首次因Playwright headless shell1248未安装，在创建browser前停止，run01日志保留；通过既有`M1_TEST_CHROMIUM_PATH`使用已装Chrome155.0.8059.85重跑原故事为run02。TD已读manifest／普通日志及该既有执行参数，没有新增测试代码。证据归`m1-web/outputs/world-core-web/browser-b5f0285-ebe7677-run02/`；自有page／context／browser已关闭，无注册／私有接口／业务写入。此为作者工程故事，不替代独立普通用户UI或新视觉验收。

D工作树随后无冲突merge已审b5f0285，HEAD`3c889ce68cec2828438572fadb192f98ca9500e7`、两parent为ebe与b5；完整tree与b5同为`a2298edef214a3e36cfc34829c7874f0a5c89740`，历史、outputs及失败／通过日志保留，未再次运行浏览器或操作服务。原设计师的`docs/design/pixel-world-20261021/production-contract.md`已固定`pixel-town-commons@1`空间映射：768×512源像素、`sourceX=264+16*x`／`sourceY=136+16*y`，当前真实公共庭256×256，外围仅景观。TD已派同一D先按固定合同适配几何、相机尺度、资产加载与渲染接口；装饰、脚点和完整预览仍等设计师最终字典／验证，不猜未定细节、不改World规则或当前N2资源。

总指挥补充普通用户主界面要求已派设计师及D：角色详情优先姓名、可理解的所在区域和已有数据能证明的状态／结果；版本、逻辑坐标、协议／规则代次等只放必要调试层。公开World不推导私有互动结果或在线，idle不表示没有移动。保留原底部HUD、居中内容窗和账号流程，设计预览不替代真实背包／信箱数据。该后继视觉差异尚未实现、独审或部署，不继承b5浏览器通过。

### 6.9 独立闭环、安全点与像素固定输入

独立Agent正式报告为[核心Gateway／World／Decision实测](../../ws02-perception/validation/user-simulation/core-gateway-world-decision-20261021.md)：A/B分别完成注册、Avatar、移动、发现对方，以及A原创文本邀请、B自行读取接受并提交反馈、A实际读取确认、双方回查同一活动closed／received_confirmed。182次主线HTTP为180次200及两次预期同键异体409；后续正常换发主人入口不计入这182次。报告列明重放抽样、未测跨主体私有读取、期限、撤回及故障恢复；不扩写为完整WS03或所有边界通过。TD仅读取正式脱敏报告，不读取双方运行凭据或正文。

原主人交接入口首先显示合并失效原因；两Agent随后沿公开正常流程、原身份换发代次2入口。不能以换发成功反推旧入口的唯一失效原因。独立人类报告[阶段三](../../../validation/user-simulation/world-core-desktop-round-01-2026-10-21.md#阶段三b5f0285新主人注册双agent与互动事实)记录02:32:07—02:39:15在b5旧画面完成一个新Owner先B后A绑定、双Agent选择／所属高亮、各一条最小互动事实、整页刷新、正常退出与密码重登；体验码1234并非真实邮箱验证。消息空态通过，背包／通知／公告／事件显示未开放，未记为真实空集合。CORE-UI-O01／P2为摘要日期与邀请状态挤叠；已派D定点修复。原UI已保留登录及当前A，归档并交还维护安全点，未对最终像素验收。

总指挥确认最终新版本继续使用18893及当前新库、instance／epoch、Owner绑定、Agent凭据和真实业务，不切回8789；8789只保留历史版本。本轮后继固定差异经独审／工程检查后可fresh备份并原地发布，前后回报。后续由总指挥协调原A提交真实短路径、原UI观察新画面行走和到达，不用示例角色或注入代替，也不启动外部Agent定时任务。

原设计师固定包`pixel-town-v1.0.0`、地图`pixel-town-commons@1`、素材`2026-10-21.r3`已经总指挥接受为首个生产视觉基线。TD核对31文件（含19PNG）及11份证据hash，冻结于`outputs/world-core/pixel-town-v1.0.0-design/`，receipt为`td-receipt.json`；bundleDigest为`e51eaf38c10765eceaee2cb22147211b76e2adbc5d98447b74d6f9386dca29b1`，按相对路径排序后的`sha256  path`行计算。采用production-contract SHA256为`bebd6dddd942ad682a4c585e2d231c5474075664c6d17c8725eee5e28dbea96c`；人体96×64、脚点[48,39]、左右朝向及idle／walk帧合同已固定。原430素材保全，19PNG保持原字节。D只能消费此固定输入，保留真实provider、Owner及HUD，不接预览演示背包／信箱。设计自身逻辑、桌面及短性能结果各守原范围，不推为产品浏览器或60fps／容量通过。

原reviewer R23接受D`3c889ce → 4df5d8`九路径可注入像素基础，R24接受`4df5d8 → d278d59`六路径公开能力说明、角色详情层级和首次拒绝入口引导。TD无冲突cherry-pick为`db19bb5`与`04705feb2ea1e7b9dad18320c68b0330dcf22cb8`，生产／测试路径与D固定d278一致；未新增整合逻辑。此时尚未在047运行TD组合检查或部署，实际18893仍b5。D两路径摘要排版修复`d278 → e6bf1cb`已送原reviewer；完整像素激活仍由D实现，不继承上述静态接受或旧b5浏览器通过。

A/D只读定位Owner未开放：676→b5既有感知读取源及对应前端门控未改；fresh catalog默认禁用部分已实现来源，UI由category／source缺失或not_enabled进入未开放分支，区别于真正空集合及403。通知另依赖历史31条demo来源策略，旧固定31refs授权helper不能用于新空实例。匿名实际capabilities仍声明Owner读取API，perception revision为catalog-1／skills-1；匿名discovery401后未借Owner材料继续，不冒称已读取候选私有目录或私密业务行。最小修补准备是分离reader可用性与示例内容、显式版本目录发布；通知collection-query许可交回WS02确认，逐对象来源授权保持，不seed、不改grant、不用前端假空掩盖。该修补尚未实施、受审或发布。

### 6.10 像素激活固定送审与WS02修补合同

原reviewer R25接受D`d278 → e6bf1cb63c1a52b321fbd468b338567258f3196e`两路径摘要日期／状态分行，R26接受`e6bf → 3b14215cd2305e179b8a9d41b420dfa8fe9eb553`单路径“最近互动”文案。后者按总指挥明确要求，只在这一块用简短人类表述，received_confirmed为“反馈已确认收到”，不解释为赞同／采纳／满意；接口、权限、状态和失败／空态区分不变。TD无冲突整合为`8dc94b1`、`77f6c422c2e3ab5f182927d0fac3681ae53864d1`；CORE-UI-O01仍待实际发布后原UI复验，不借静态接受关闭。

D完整像素激活固定`3b14215 → 75bbb857e8dfa015618ca271c0e205817188be35`，工作树clean，34路径为32个生产文件及两个测试文件，已送原reviewer，尚未得到本片审查结论。实际provider、Owner查询／账号、背包／钱包／四类信箱接口保持；真实完整场景投影消费已批准布局、人体帧和脚点，外围7建筑／94景观不成为新的服务器场所或碰撞规则。实际收到的相邻位置最多补间180ms，不生成下一步或推断在线。

作者普通manifest及日志归`m1-web/outputs/world-core-web/pixel-activation/`：同次site32/32＝11pixel／实际字典＋9公开reader＋10owned＋2旧town helper；最终synthetic browser run06为3/3、无skip，8JS语法、full typecheck及diff0。浏览器全路由拦截至`https://pixel-world.invalid`，空身份、无真实网络／账号操作，1440×900与1361×765桌面；覆盖19PNG校验／解码、fit／2×／3×、拖动、同格原生指针与键盘选择、日间／黄昏、减少动态、撤回及404清理、资产失败后fallback／重试按钮出现、pagehide回收和11人有界分页完整收口。没有点击重试后成功恢复的证据；browser清空会推进worldRevision，同revision清空只由site覆盖。不是18893实际HTTP、真实移动或独立UI通过。

失败run01—04保留：初始近景角色在固定顶栏下，后续选择先把目标拖到可见区；locator.click自动scrollIntoView导致在close handler入场前滚页。最终按语义定位可见按钮rect、等既有打开动画完成再原生mouse点按，page scroll和camera仍严格相等，未放宽断言或为此改变生产关闭逻辑。run05两故事通过与run06新增分页后的三故事分别归档，不累计。TD核22采用文件含19PNG与冻结包逐字节一致、12普通日志hash一致，读取通过日志并看过1361全景日间及1440近景黄昏截图；不代替原reviewer或实际产品视觉验收。

WS02已正式补入[原接口合同§11.7](../../ws02-perception/world-perception-api.md#117-2026-10-21fresh实例读取可用性与主人集合查询裁定)，将此问题裁定为恢复既有主人读取的必要修复。集合查询许可与逐对象许可独立；通知来源可声明current_bound_owner查询获准集合，不授正文／附件／发件人或隐藏数量权限。过滤后空与真空同形；公告／事件仍按公开world、背包按有效holding、钱包读真实已初始化账户。helper只发布限定来源／声明新版本，保全旧精确文档和业务事实，不seed、不补grant／投递／余额，不从GET／readiness初始化。TD冻结原合同到`outputs/world-core/ws02-reader-contract-20261021/world-perception-api.md`，全文SHA256为`ccceb3566813535d18a22ba7cec0d4ac0d552b114beb97dafea945171d350932`，第405行起为裁定；A据此准备修补和反例，最终固定差异及审查尚待交付，18893仍b5。

R27后继正式发现WC-CR06／P2：world-scene将帧间隔截到50ms后交位置补间，低帧率／长帧下不能守180ms上界，原单测直传大dt未覆盖实际链。75bbb暂不整体接受；原D据此修单调真实经过时间与实际RAF调用链反例，其余已核范围保持。上述资产失败、same-revision的表述按reviewer实际证据校正；作者被要求保留旧manifest并明确勘误，不通过补无关故事扩统计。总指挥已授权若前端先受审可单独fresh备份发布并并行验收，后端修补另在安全点维护；是否拆批按两原作者实际收口进度确定，不发布未审75bbb。

### 6.11 像素截止修复接受与18893分批发布

原reviewer R28接受D`75bbb → 71751edcc255e159a921719438fbdbff5b22fab6`五路径，并接受`3b14215 → 71751ed`完整34路径像素范围，WC-CR01—06均关闭。原装饰dt仍限50ms，位置改由接收事实时performance.now与180ms绝对截止、真实RAF时间驱动。作者实际主循环250ms反例在75得到268.444而非目标280，修后同故事1/1到280，另守pause／首帧截止／hidden清空恢复；该同次11site／1synthetic、full typecheck与语法检查独立于旧32／3，不累计冒充重跑。旧manifest保全为manifest-original-75bbb85.json，勘误及日志见`m1-web/outputs/world-core-web/pixel-deadline/`。

TD无冲突整合75与717为`e6710d4`、**`e93b8f11748b6cc078543f7dfdfd98358ba52cfd`**；生产前端／相关测试与D717一致，后端／脚本／依赖／公开接口文档与运行b5完全无差异。本固定组合受影响39/39、fail／cancel／skip0，full typecheck及diff0；命令、日志、manifest归`outputs/world-core/integration-e93b8f1/`。总指挥已确认Owner与原Agent安全点，授权先交受审视觉，读取初始化另批；TD未等待后端审查才部署画面。

视觉固定归档为`outputs/world-core/pixel-e93b8f1/source`，source.tar SHA256 `304fc46461ba778f01406edc5366824f0c124d1ef7dc7d5cca499e351938b8f9`，依赖独立复制，非共享symlink。切换前实际验证PID907及旧cwd，保存live一致逻辑dump、配对identity／配置，正常SIGTERM排空并确认18893无监听，再存stopped dump。两dump经清单验证，未作本次恢复演练；stopped为417479字节、SHA256 `9c06c6f4b9b226ebba1daecfe49dafe7d731348c93d9f82946170b9b849322ca`，秘密仅留0700／0600的maintenance-private。预检曾漏带worldId而得到一次400，补齐公开合同参数后通过，未因此修改服务或业务。

stopped全库80表278行；显式关写门后从固定e93启动，closed-before与after-start的80表全列指纹完全一致，停服到闭门启动全部语义指纹保持（只排除instance_state开关／write_generation机械字段）。identity SHA256仍`da233bcdf1316505e28851bd673166164d000e9a8b701fcb19f7aec46038b612`，instance／epoch未变。67条匿名GET均200／no-store：八基础入口、38个实际变更生产资源逐字节匹配固定源、21旧精确World文档的document与digest保持。两Avatar完整公开事实、位置及worldRevision7保持。没有Owner借凭据读取或后台造业务。

北京时间2026-10-21 **03:14:18.633**重新开门并health ready，维护**83.83秒**。当前PID **25983**、固定cwd **`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/world-core/pixel-e93b8f1/source`**，origin仍**http://127.0.0.1:18893/**，执行会话67060。普通证据为该归档上级的preflight-backup、maintenance、三阶段continuity及closed-readiness。总指挥收到完成回执后接续原UI像素／文案／摘要定点及原A一次真实移动；此处尚无其最终结果。原8789／connet和公网未动；后续新移动与人类状态继续保留。

R29同时接受A`d7554e2 → 4e73c391d493fafebf0e9e4c609cf6509685b9d6`九路径读取修补，无新增实质问题；作者64/64含7新反例、full typecheck／diff0，原wallet-mail测试98行的pg并发弃用warning单列保留。TD核9固定文件／4日志hash，无冲突整合为`473e7ed2b5249396ebdc37361fc6553c2f002564`，后端／脚本／WS02测试与A固定内容一致。该后继仍在隔离组合检查，未在18893执行helper／发布；视觉e93仍保留原reader未开放，不能记空态通过。下一次维护等待原UI／Agent新安全点并再做fresh备份，不回灌本次dump。

TD后继在准确473e7ed完成68/68、fail／cancel／skip0：WS02相关64及N1／N2真实HTTP4同次组合，full typecheck与diff0。仍使用明确私有runtime支持的隔离fixture／18894，没有访问正在独立验收的18893或connet；原wallet-mail测试98行warning保留。证据归`outputs/world-core/integration-473e7ed/`。待发布固定源码归档已准备于`outputs/world-core/readers-473e7ed/source`，archive SHA256 `19fb7ac374aa9fa743fa61dc9715e2936f06c1871da6b55c7e205b081ff82584`，依赖独立复制，前端与已发e93相同。尚未执行候选helper或第二次维护，等待总指挥安全点。

### 6.12 已审源码合入main，读取修补待安全点

在运行e93保持不动期间，TD按既有授权将main从`676c38a287d1c17a50c28ea9b59dbd9dcc610931`以ff-only推进到`c0752f1416a557463ae528d29a5a32ec3e2c2ece`（473e7ed代码及TD交付记录）。132个目标变更路径与原7193个修改／未跟踪路径无重叠。操作前私有保全原staged／unstaged补丁及文件指纹；操作后7193路径的字节hash、模式、缺失／symlink状态完全一致，原staged patch保持。证据在`outputs/world-core/main-integration-c0752f1/receipt.json`，私有保护文件同目录，不bulk stage、不回收原设计或其他WS文档。服务独立冻结源不随main变化，不因main已含修补而冒称目录已恢复。

### 6.13 真实移动后fresh保全与读取修补实际发布

总指挥正式交还两个安全点：原A于03:22:06.353完成20/20步、位置(15,6)／Avatar v22，四次HTTP全200且无未决动作，已停止；原UI约03:31完成像素、真实中途／终点、姓名／高亮、A/B切换、摘要布局及文案、缩放／窗口／减少动态的既定定点，交还同Owner／当前A、全景108%／日间／减少动态关闭、无内容窗及待提交。该回执用于维护安排；正式报告归原验收者，不由TD扩大为手机／容量或未测路径通过。总指挥明确不等离线报告整理即可维护。

473e7ed归档已逐文件验证484文件与固定Git一致。TD再核PID25983及e93固定cwd，读取公开快照确认A(15,6)v22、worldRevision28，fresh live备份配对identity／配置；正常停服排空、确认18893无监听后另存stopped dump。两份逻辑备份均核清单，未作本次恢复演练。stopped为423903字节，SHA256 `e8e9ff25c11322e12915276b719281db2d992bf7624f0a7f0859ccc30c7e5cba`，保留在`outputs/world-core/readers-473e7ed/maintenance-private/`，不复用移动前dump。

维护无运行应用时，显式处理写门并从固定473调用受审`ws02-implemented-readers.ts`，目标为原instance／epoch、预期catalog-1，actor为`td-reader-maintenance-20261021`、operationId为`reader-availability-20261021-01`。该次明确提交成功后立即关门；回执位于私有reader-publication-receipt.json，普通脱敏结果为reader-publication-stdout.json。catalog-1→**catalog-readers-1-schema-4**、Skill revision→**skills-catalog-readers-1-schema-4**、guide1→2，schema4不变。holdings／demo-items／direct-mail／demo-announcements／demo-events／platform-publications六来源从not_enabled变enabled；direct-messages原enabled及其他来源保持，未启用demo-places。只新增一个具名query-only声明，objects=[]且四对象层权限false，不新增通知内容或逐对象观察权。

stopped→after-readers为80表403→414行。七个核定表变化：access_facts 2→3、catalog_current 1→1、catalog_releases 1→2、documents 48→55、observation_policies 0→1、source_states 11→11、administrative_receipts 0→1；其他73表语义指纹保持，instance_state仅机械开关／generation另列排除。旧48份精确文档、旧release及原两条access fact的全行hash保持，源状态逐行核对只有六来源改变；Owner／Agent身份、凭据／绑定／会话、正文／grant／确认、钱包及World／Interaction／Decision全部业务表未改。没有seed、迁移、身份重建或补余额。

固定473闭门启动后，after-readers与after-start的80表414行全列指纹完全一致；identity文件SHA256、instance／epoch保持。29匿名GET均200／no-store，首页和owner字节匹配冻结index，实时capabilities已显示新catalog；两Avatar完整公开内容、A终点／v22、worldRevision28与维护前一致。21份旧World精确文档的document／digest保持。此处不借Owner凭据验证其私有列表；原人类与原Agent的reader定点由总指挥另派。

北京时间2026-10-21 **03:34:24.230**重新开门并health ready，维护**100.67秒**。实际源码 **`473e7ed2b5249396ebdc37361fc6553c2f002564`**、PID **33604**、执行会话 **92595**、固定cwd **`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-integration/outputs/world-core/readers-473e7ed/source`**；入口仍**http://127.0.0.1:18893/**。原8789／connet及公网未动。当前恢复须保留473兼容源码、当前PG／identity与所有后续写入；不得覆盖回本次或更早dump，不将旧e93的catalog代码作为未评估回退。总指挥已收到实际版本、来源目录变化及连续性，原UI／Agent读取复验尚待其正式结果，不扩做整轮视觉或全量。

### 6.14 独立定向验收完成与本轮收口

原独立人类报告[阶段四](../../../validation/user-simulation/world-core-desktop-round-01-2026-10-21.md#阶段四e93b8f1像素世界与真实移动定向检查)已正式记录e93真实移动呈现：固定相机原生样本显示A中途向右、向下推进，姓名及选中高亮跟随，随后停在终点，B保持原位；与原A独立HTTP完成20/20、(15,6)v22对应。21张阶段图与300张移动图保留采集间隙，不宣称逐帧覆盖全部20步、任意方向或所有遮挡。A/B最近互动各1条且日期／状态分行，旧CORE-UI-O01在所测桌面路径修复，CORE-UI-A01所测说明修复。匿名公开Avatar原world-detail关闭路径没有重跑，CORE-UI-A02仍待同路径复验，不以主人管理预览或场所关闭按钮替代。

阶段四图19的外层滚动条件继续保留原报告限度。原D仅只读现有图／AX／步骤及固定717源码：世界、HUD与管理预览整体上移，但缺少触发前后scrollY、元素rect及输入轨迹，既不足归因为AX自动滚页，也不足确认新产品缺陷。当前按世界区域居中的静态边界不能证明所有外层滚动组合；历史75的locator自动滚页证据也不能外推本次Owner路径。总指挥接受保留“因素未区分／所有滚动组合未测”，本轮不扩矩阵、不改代码或重启。

原人类报告[阶段五](../../../validation/user-simulation/world-core-desktop-round-01-2026-10-21.md#阶段五473e7ed后继读取修补)在运行473完成03:35:27—03:38:48定向读取：复用同一Owner与两绑定，A/B背包及通知／消息／公告／事件均显示正常可读空态，两者星币均在加载后实际显示0；未见未开放、错误或未授权。四类信箱仍明确“阅读标记暂未开放”，没有将内容可读扩大为人类阅读状态写入。A→B→A后当前对象、背包标题及收件对象一致；原2角色、移动后位置区域及各1条互动保持。两者都为空且余额相同，只通过所测对象切换，不能独立证明非空隔离、延迟响应或完整权限矩阵。18张原生图／18份脱敏AX及材料检查归`outputs/user-simulation/world-core-ui-20261021/readers-473e7ed/`。03:38:48已交还安全点，同Owner登录、当前A、108%全景、内容窗／菜单关闭，无待提交；之后没有追加浏览器操作。

原Agent报告[473实际结果](../../ws02-perception/validation/user-simulation/core-gateway-world-decision-20261021.md#473读取恢复版a实际结果与停止点2026-10-21t0340250800)正式记载原A自主重新发现新目录及Skill revision，取得所需5份guide v2／14份schema v4，19份canonicalDocument原始UTF-8摘要、JSON结构及精确版本均匹配，首尾目录／权限一致并保全旧基准。真实overview与7个有限list均200：背包／物品／通知／消息／公告／事件计划／已发生事件均complete=true、records=[]、source enabled；钱包权威返回星币0、accountVersion1、platform、注册初始化来源。没有未开放、权限拒绝或来源错误，没有条目则没有编造详情或新内容。该阶段**36次HTTP全部200**、零重试／跨源／重定向／未知结果，独立于历史N1／N2的182次及观察移动4次，不合并为一次全量。A已停止HTTP，B未复跑；未移动、重注册、重绑或确认消息，读取产生的既有session／access不称零DB写。

本轮已授权核心实现、像素接入、读取恢复、固定差异独审、main整合和18893本地交付完成；原reviewer R29接受及WC-CR01—06关闭不变。最终双端仅在各自上述定向范围通过，无新增阻断。手机、完整权限／故障／生命周期矩阵、非空读取隔离、匿名A02同路径复验及未区分滚动组合保持未测／未决范围，不用工程检查或不同入口替代。TD只补本唯一执行记录；WS06在主目录同步其七份治理／架构原件，独立报告仍归原验收者，不覆盖或代提交。当前473服务、原新库／identity及所有后续真实写入继续保留；本次收口不追加测试、维护、回灌、端口或公网发布。

## 7. 2026-10-21后继：世界读取可靠性与像素面板

### 7.1 新授权、资源与诊断分工

用户新增两项交付：修复频繁出现的“服务器世界暂不可用 · 可重试”，并将背包、Avatar设置与信箱接入像素世界视觉。总指挥授权原作者实现、原reviewer固定差异独审、main整合及18893本地交付；故障包可先独立交付，面板合同随后接入，不等全部视觉完成才修报错。原设计总监负责通用像素面板及Avatar／账户，WS07负责背包／信箱状态与布局；D独占web，不由不同作者并写。真实字段、权限和操作保持，未开放的人类已读／删除等能力不由视觉补造，Avatar预览须与实际世界一致；外层滚动时窗口标题出屏纳入容器检查。

本轮起点main／integration均为`4d3f88bd480510b9fe80666e40ec5b1a5c222db5`，实际运行仍473冻结源。此前按用户启动请求于16:19:01以nohup及独立进程会话恢复，PID15970／PPID1，stdin关闭、输出至私有文件，PG原本healthy而未重启；旧33604退出原因无现成证据。启动记录归`outputs/world-core/restart-473e7ed-20261021T081901739Z/`。20:31:47 TD只读确认同PID／cwd、health ready、capabilities world enabled及pollIntervalMs1000，scene200／complete，**当前worldRevision29、3个Avatar**；这是已有后续用户写入，不能再以先前2角色／revision28作当前库断言。原库、配对identity、Owner／绑定、互动及所有新写入继续保全，后继切换再做fresh备份；不重建、seed、迁移或回灌，不操作8789／公网及其他服务。

原A本轮实际turn_context为`gpt-6.1-sol/xhigh`，保留m1-api旧clean4e73分支，从4d3建立`codex/world-read-reliability-api`；其新增写入责任限`apps/platform/transport/http/agent-gateway-routes.ts`及`tests/gateway/rate-limit.test.ts`，补现有限流的重试时间，不改变额度或安全保护。原D本轮实际同为Sol/xhigh，保留m1-web旧clean717分支，从4d3建立`codex/world-ui-reliability`，独占前端读取状态／容器／面板及必要site／E2E。原B本轮实核Sol/xhigh，只读现有日志／进程／PG健康，m1-storage仍clean cb17，不改代码。TD仅维护本记录、整合／交付；原独立UI由总指挥另派，作者观察不代替验收。

### 7.2 首轮现场证据与待证假设

D于20:39:05—20:40:08以新空匿名单tab观察实际18893，caps60／rules59／scene59均200，12次采样ready、complete、3Avatar，无429／5xx／abort／pageerror，随后关闭自有browser；脱敏证据在`m1-web/outputs/world-ui-reliability/observe-public-01.json`。B于20:39—20:42确认PID持续存活约4小时20分、PG healthy／restartCount0／OOM=false；指定日志仅一条47字节启动记录，没有持续HTTP日志，因此不能据无错误记录排除间歇异常。A的三次匿名GET同样正常，不读取主人或Agent私有行。

固定473静态链已确认：每个可见World页每秒读取caps／rules／scene，rules与scene合约120次／分钟；两者及其他Gateway操作共享同IP240次／60秒固定窗。两个页面已占满理论预算，额外正常读取可能触发429，而当前429不带Retry-After。前端将任一短网错／429／5xx统一清空已有画面并显示同一提示。此为确定的策略冲突风险与错误处理事实，尚不能当作用户现场每次故障的唯一根因；隔离自然双页预算、短暂失败恢复及过期／取消响应反例待完成。用户的多个浏览器页不自动等同多个World轮询页，不在现用服务造压。后继修补应保持最新有效公开画面并明确连接状态，对首次无数据、明确停用／撤权、暂态失败与主动取消分别处理，不将旧画面无限冒充实时真数据。

### 7.3 独立基线、设计冻结与首个后端固定差异

原独立UI[阶段六](../../../validation/user-simulation/world-core-desktop-round-01-2026-10-21.md#阶段六晚间世界不稳定与旧面板改版前基线)在20:42:45.533—20:48:09.996记录CORE-UI-BL01／P1：普通浏览中多次不可用与角色消失，20:44:55及20:46:11未显式重试也曾恢复，唯一整页reload未保持恢复；20:47:42一次可见“刷新世界”恢复3角色，20:48:09再次失效。背包／信箱自身仍正常空态与0，不能把世界故障泛化为全部数据不可读。原UI没有HTTP网络监听，不以这些时间点推定状态码或唯一根因；TD20:47:32单次scene200也不否认间歇失败。其13张原生图／14份脱敏AX归主目录`outputs/user-simulation/world-core-ui-20261021/baseline-panels-20261021T124245Z/`，20:48:09后停止输入、保留同Owner／当前A及无待提交安全点；世界仍不可用，不是验收通过。

同报告CORE-UI-BL02／P2明确以Avatar窗外侧普通滚动复现标题／关闭出屏；**Home没有恢复**，最后工具能定位屏外原关闭控件才退出，不当作普通用户在视口可达。此为本轮已复现容器缺陷，原阶段四证据仍保留当时限度。BL03为三面板旧风格及旧basic预览不一致的设计输入，非新增业务能力。WS07另有20:42:34.113—34.296失败语义快照、无故障截图或网络捕获，材料在主目录`outputs/ws07-m2-pixel-panels-20261021/`；其最近成功快照20:38:54，实际失败起点未知，成功原图不挪作失败证据。

总指挥确认共享合同和WS07最终§6可供D接入。TD冻结于`outputs/world-ui-reliability/design-contract-20261021/`：共享实施输入`pixel-panels-contract-r2.md` SHA256 **`05f010f4906471a60580ff7471e1261075e1f1fa6fadc47b04f28bf1cbd8b14e`**；WS07全文`m2-owner-data-ui-minimal-design-2026-10-20.md` SHA256 **`6264c7104080884e226b076b7d23611b63e46f76b2dce836b6a99499dcdc7816`**，其中§6摘要`0827581138f592ec96083e1de24054cf05b93c0d5ee96e7500c09cd58d048f51`。初冻174a7b旧副本保留，实施用r2；对应源仍归设计总监／WS07，不由TD覆盖或代提交。主窗960／最高676／标题64／关闭44，详情680／最高620；视口安全区、主窗HUD可达／详情独占、Avatar分开保存／未确认恢复与同一human.js映射统一。设计预览／自查及生产独立视觉复验分别继续，不借合同冻结预记通过。

A已固定`4d3f88b → 5db904d593a82f70b5870988fa8c5666f5de74d0`两路径，仅Gateway自身限流429增加Retry-After及no-store，剩窗秒数向上取整、范围1—60，map容量满为60；原240/IP、60秒窗口、鉴权／写保护与body保持。隔离Fastify.inject假钟反例为59个1.01秒周期两页236次rules／scene＋6正常发现＝242，240接受／2次429，旧版剩窗1420ms而无等待header；单页124全200。修前4例1过／3失败，修后新增5＋原目录2＋driver1同次8/8、无skip，full typecheck／diff0；无PG／服务监听或当前库操作。TD核2文件／4日志hash一致，证据归`m1-api/outputs/world-read-reliability/`，已送原reviewer R30，尚待独审与D故障包固定；当前18893未切换。

### 7.4 故障包固定与独审推进

原reviewer R30已接受A两路径，未发现新增实质问题；TD无冲突cherry-pick为`2083fef`，没有手写整合逻辑。该后端只为现有429给出等待依据，不单独宣称消除共享预算竞争或现场故障。D独立固定`4d3f88b → 4bb9fa5d1b4843c4b9f6f1b088e398d9ba33e353`七路径（四生产、三测试），固定时clean，尚待原reviewer R31。common仅解析错误Retry-After元数据，不增加自动写重试；公开World保持GET，元数据30秒有界缓存，scene最短1秒单链；暂态保留带旧读取时间的最后完整事实，明确失效／新空集合清除，恢复不生成移动。

D最终site同次27/27＝7可靠性＋9公开reader＋11像素，合成浏览器恢复故事1/1、无skip，full typecheck、四生产JS语法及diff0。隔离双页60秒预算为125次Gateway（含一次其他读取）、capabilities四次、无429；旧模型241触限流。合成浏览器全路由拦截至pixel-world.invalid，覆盖503保留标记、更新的完整空集合清除、429冷却恢复和明确404清除，不访问18893或借用Owner凭据。失败run01—02及旧site／typecheck记录保留，最终断言要求成功读取时间推进、真实新空集合及清除错误；没有以正常refreshing采样或已禁用按钮时序的失败冒称产品故障。TD核12普通日志hash一致；证据在`m1-web/outputs/world-ui-reliability/`。

D从固定4bb继续像素面板后继，与此故障提交分开；根实看1440角色／背包及1024信箱详情，确认方向可接入，正式UI须删实现说明且配色称代表色／资料配色，不暗示一定染衣。最终设计文案合同另冻。当前独审尚未接受D，故障包未组合测试、未发布；18893仍15970／473，独立UI安全点保持。

R31检查确认WC-CR07／P2：无合法Retry-After时，fallback退避仅由定时器和UI显示，公开refresh／隐藏再显示可绕过。TD静态疑点送原reviewer，原D也复核，随后固定独立`4bb → e9e2fc44dbc2a4c0f351200b9b01feed5db9204a`三路径修订；暂态错误把服务器等待与本地退避统一存入notBefore，自动／手动／可见恢复共用，明确业务失效清除及手动重查保持。新反例在t1000失败、t1500多次手动／隐藏及t2999均无新读，t3000实际恢复；涵盖无头429、非法数值等待及短网错。17/17＝8可靠性＋9公开reader，full typecheck／语法／diff0；初跑三失败与修正后日志均保留：前两项来自作者中间态把退避误施于非暂态业务错误，第三项才是假timer未推进时间；固定e9只对temporary设门禁并修正假钟，原断言保持。原D另加errata.json澄清，不覆盖原manifest；此作者后继未重跑Browser／现服。证据归原D`outputs/world-ui-reliability/cooldown-followup/`，原4bb manifest不覆盖；同一reviewer继续复核最终整个4d3→e9故障范围，未借作者自查关闭问题。

最终设计总监交付`pixel-panels-v1.0.0`已由根实看后确认可实施。TD冻结至`outputs/world-ui-reliability/pixel-panels-v1.0.0-design/`，五文件hash及bundleDigest **`365cdae73862bcbf2461f9b334146b41817dd6f27b8b4ae0d3b4298497811f0f`**重算匹配；最终共享合同SHA256 **`a0a919e27887ec391ed974fae74a1c565c1243add28504d1b52841a00e3922fd`**替代r2／r3实施输入，旧冻结副本保留。原pixel-town包31文件仍逐字节匹配原manifest。预览HTML／CSS／JS、合同与validation只提供设计输入；D有选择复用样式／布局，示例数据、模拟保存及PIXEL_PANELS接口不接正式产品。根所见1440／1024与设计作者内部滚动／草稿保护／减少动态结果不代替新生产代码独审或普通UI验收。

### 7.5 可靠性故障包独审、组合检查与实际发布

原reviewer R32接受`4bb → e9e2fc4`三路径修订并关闭WC-CR07，结合R31接受D最终`4d3 → e9`七路径；A R30接受保持。TD无冲突整合D两提交为`a3cff3a`、**`d8ee361597d277d12fbda6fcc9260991a8d5f971`**，九个A／D归属文件与各自固定作者版本逐字节一致，无新增整合逻辑。该组合实际36/36＝Gateway8＋公开reader9＋可靠性8＋pixel11，同次另执行已审合成Browser恢复1/1，均fail／cancel／skip0；full typecheck与diff0。Browser全路由拦截，不访问18893或当前Owner，作者e9未重跑与TD组合实跑分别记录。普通manifest、源码匹配及日志在`outputs/world-ui-reliability/integration-d8ee361/`，不是独立UI或三面板验收。

固定源在`outputs/world-core/reliability-d8ee361/source`，486文件与Git逐字节验证、独立复制依赖，archive SHA256 **`909d3d10567b9621e92383c6bbc9f53629de1a178160f7b24b9ae1970130a720`**。相对现服473，后端仅已审Gateway header七行差异，脚本、依赖、schema／catalog及所有业务逻辑保持；本次无需任何reader发布helper／迁移／seed。

依据根已交还的20:48原UI安全点，TD先通知维护，再fresh保存当前live逻辑dump及全部配对私有材料；核对15970／473 cwd后正常SIGTERM排空、确认18893无监听，再存stopped dump。两dump均核pg_restore清单，未作本次恢复演练；stopped **447539字节**、SHA256 **`0b031f11120a392118a5bedd20985692aacb0c83af7c8a4c285b05e7c40cf332`**。秘密只在本归档`maintenance-private/`的0700／0600文件，不输出连接或凭据，不复用旧备份覆盖新事实。

停服后显式闭写门，从固定d8以nohup／独立进程会话启动，stdin关闭、日志私有。stopped-before→closed-before→after-start的**80表502行**全部语义指纹保持，只有instance_state的write_generation／writes_enabled机械字段按原规则排除；closed-before→after-start全部80表全列指纹完全相同。配对identity SHA256仍da233bc…612，instance／epoch、现有Owner／绑定／会话／Agent／互动及新写入保持。11匿名GET均200／no-store：health／首页／owner／公开入门／caps／rules／scene及四改动前端资源；资源逐字节匹配固定源，公开worldRevision29／3Avatar完整事实与维护前相同，catalog／Skill revision保持。没有借Owner或Agent凭据作私有验证。

北京时间2026-10-21 **21:31:17.185**开写门并health ready，维护**52.816秒**。实际运行 **`d8ee361597d277d12fbda6fcc9260991a8d5f971`**、PID **58137／PPID1**、固定cwd为上述source；入口仍 **http://127.0.0.1:18893/**。普通启动、备份摘要、三阶段continuity及closed-readiness证据同归`reliability-d8ee361/`。当前恢复继续采用兼容当前catalog的d8或已评估473源码，保留当前PG／identity及全部后续写入，不能回灌旧dump。原8789／connet、PG生命周期、其他服务及公网未动。

根已收到实际ready时间及版本，可恢复原独立UI验证连接稳定性；此处尚无其正式新结果，不宣称现场所有间歇故障关闭。三面板及CORE-UI-BL02容器修复仍由D后继实施，尚未固定／独审／发布，不借本故障包通过提前记视觉完成。

发布后main从4d3以ff-only推进至`03313c56457e4288572d951b324757d3a5520022`（d8代码与本记录）；10个目标路径与当时7199个修改／未跟踪路径无重叠，私有保全后前后7199路径字节／模式／缺失／symlink指纹及原staged patch全部保持。回执在`outputs/world-core/main-reliability-sync-03313c5/receipt.json`。runtime继续独立冻结d8，不因main文档提交变化。

### 7.6 用户撤回v1视觉方向与后继契约等待

用户随后明确否定pixel-panels-v1.0.0的视觉方向：仅图标／边角像素化、整体仍是标准Web表单，不符合完整游戏化／像素化角色编辑要求；新方向需直接选择素材库中的实际人物形象，不能把现有basic＋四色当作产品限制。此前根对设计截图的方向接受仅保留历史，**v1现已撤回，不得称用户通过或继续按该包完成视觉发布**。根重派原设计总监制定角色选择场景及背包／信箱共用像素窗口，WS01制定最小look／appearance identity业务契约；原素材、当前PG、Owner／绑定、三Avatar及所有后续真实写入保留，不重置／seed。

TD立即中断原D并取得明确停止回执：D停止v1固定／送审／整合／发布及视觉代码／测试，没有新增commit；m1-web仍为`codex/world-ui-reliability`／`e9e2fc44`。18个WIP路径全部保留：12个原public文件（home、detail-host、platform-content、icons、panel-layout／transition、scene-renderer、shell、index、owner-manager、owner-panel、owner），三个新public文件（panel-environment、avatar-preview、panels.css），既有ws02-hud断言同步及两个新panel测试。ignored outputs及全部失败记录保留，自有测试进程已结束；没有reset／stash／回退或现服／DB操作。此前两桌面合成故事及公共场景故事只属未发布v1工程，不能作为新方向验收。保存／退出保护、固定视口及可达性改动可评估复用，但仍需纳入新版固定差异独审。

已让原reviewer停止v1后继合同准备，不读WIP或预先接受；d8已上线可靠性及R30／R32结论保持。原A只读评估授权保存→持久化→公开profile／scene，原D只读评估真实look→同一sprite渲染及保留的界面保护，原C只读评估隔离验收链。等待根转交新设计和WS01契约后再实现视觉闭环，作者继续Sol／xhigh；不新增产品字段决定或以旧技术限制替代用户要求。原独立UI的d8连接复验继续，不因方向变化重启。

### 7.7 d8后继现场读取异常的已知范围

根转达原UI在21:35:49.655普通reload后出现新“连接中断／正在恢复／显示上次画面”提示，后继节点自行恢复三角色，未点世界重试；这证明现场曾触发保留与恢复链，不证明请求从此零失败，也不能仅据提示确定429或5xx。TD只读进程及日志元数据：58137／PPID1存活，日志仍仅47字节启动记录，无HTTP持续日志；可访问Chrome库存未见18893页，TD本chat IAB为空，无法访问其他chat原UI页，因此不能归因或排除旧JS页面。未接管／关闭页面、造压、注入故障或读取私有凭据。

原A按根诊断范围做后继有界抽样并停止：北京**22:24:57—22:26:07**，仅八次匿名GET（caps一次、scene七次，约10秒间隔，无并发或重试），**四次200／四次429 rate_limited**；成功scene均worldRevision29／三Avatar。四次429分别为22:25:07.131 req-e92／Retry-After7，22:25:47.175 req-ej9／28，22:25:57.178 req-ejq／18，22:26:07.180 req-ejz／8。没有5xx或网络失败，没有代码／DB／服务改动。普通原件在`m1-api/outputs/world-read-reliability/sample-20261021T142457Z/`，证明后继该窗口现场仍有限流，**消费者／来源未归因，不能倒推21:35原事件**。本轮未扩大配额或自动重启；正式UI最终观察尚待其报告。
