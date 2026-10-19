# WS02 手动真实感知首个固定候选独立代码审查

2026-10-20。Reviewer：稳定会话「M1 后端独立代码审查」（`01a13916-02fe-7e90-8881-972aba227d8d`）。本报告只覆盖首个固定候选的静态检查；作者仍在补建，后继差异须另行复核。

## 1. 结论与固定范围

**本候选暂不接受为完成交付。** 下列 5 项新增发现须原作者修订；T01／T02 及 TD 已派出的其他补建项另列待后继复核，不重复计作本轮新发现。没有把规划通过、作者测试或旧 M1／HUD 的 PASS 转为本候选通过。

- base：`878a0cab60a28027f3b30facaa0860dc56dd2ca3`。
- target：`8a8cd53971b3408526e69d1c506bb54292275e73`；以下源码行号均属于此 Git 对象。
- 固定组合：生产 `696670a6b344c7bff986571008a17e08714c6d5d` → integration `a265913bfdee40d05e723c29b0baefa6f101a5ec`；测试 `b064ca61dab7b3168a03621851e390424a4e2547` → `38351eb08d0a650909b77bf64659eb364528cbf9`；公开接入文档 `0abb6e802150a4f1a57ac6e55d81f219694dec7a` → `92a3cbcef63ed6803a7638c52e2f6700770f43f4`，再含 WS01 两行修订 `9c1e9409eb9b998f02ef94797f9a76bfed6b0ab1` → target。
- 本次只读核对：生产 `apps/platform`／`scripts/ws02-demo-data.ts` 与上述生产作者提交相同；新增测试及两处旧测试修订／QA 脚本与上述测试作者提交相同；三份公开接入文档与 WS01 修订提交相同。三个限定路径比较均退出 0。
- 总差异 22 路径，1,149 行新增／28 行删除；固定 diff 的 `git diff --check` 退出 0。

授权以主目录最新[开发规范](../../../planning/development-guidelines.md)与[会话登记](../../../planning/session-registry.md)为准：本轮已授权必要真实手动 API、目录／指南／更新检查、DB 演示内容和绑定；不扩展前端、排程、公网或 push。业务审查依据主目录 [v1.2 合同](../world-perception-api.md)及[技术评估](../architecture/ws02-technical-evaluation.md)，没有采用 integration 中较旧规划正文中的暂停语句作为当前派单依据。

本次没有运行 JS、typecheck、测试、构建、CLI、浏览器、HTTP、服务或数据库；未打开私密 fixture／identity／token 文件，未操作用户数据或其他端口，只写本报告。以下触发轨迹为源码推导，尚不是实际 HTTP 复现。

## 2. 新增发现

### M2-CR01 · P1 · 私有目标在验权前检查来源状态，故障时可区分存在性

位置：`apps/platform/application/perception-service.ts:36–40`，调用点包括 `detail:143`、`queryAgentRead:192` 和 `confirm:153`。

触发：direct-mail 来源为 `unavailable` 或 `not_enabled`；一名持有效 runtime、但未获投递的 Agent，使用合法上下文分别请求一个存在且正文可用的私信 ref 和一个不存在的同类 ref。不存在的对象在第 36 行返回 404；存在的对象先走第 37 行 `checkSource`，返回 503 `source_unavailable`／409 `channel_not_enabled`，尚未执行第 39 行的本人有效投递检查。使用合法 `human-inspect` 上下文的人类 detail 请求也会进入此顺序。

影响：没有正文读取权的主体仍能借状态／错误码判断私有目标是否存在。来源故障不应解除“不存在与无权统一 404”的边界。此问题与 TD 已派的 grant-generation／分页失效补建不同。

最小修订：先在同事务内证明该目标对当前主体至少具有存在性披露权，再返回来源不可用等可区分状态；无权／不存在保持同一安全错误。补测试覆盖未收件 runtime、主人会话，在 enabled／unavailable／not_enabled 下比较存在与不存在 ref，并核对 query、确认与回执入口共用边界。

### M2-CR02 · P2 · list／detail 接受 budget 却完全忽略

位置：`apps/platform/application/perception-service.ts:129–150`、`183`、`195`。

触发：向合法 list 或 detail 请求增加 `budget:{maxResponseBytes:1}`。这两个分支只验证上下文、页大小或固定正文段长，不解析 budget；最终仍按 65,536 字节的默认上限校验并准备成功内容。`budget` 为错误形状或非法数值时也不会被这些分支拒绝。list 首页固定选集扫描上限仍为 2,000，与调用者下调的扫描／读取预算无关。

影响：公开合同允许宿主按请求下调预算，服务却可返回明显超过请求字节预算的内容、生成续读会话并记录成功；声明的预算不能用于控制实际细读成本。overview 的预算实现不能覆盖另外两条路径。

最小修订：为各读取操作明确可接受的预算字段并统一验证／落实；在提交会话与准备事实前校验实际 UTF-8 信封字节，装不下最小响应返回 `budget_too_small`，不能截断后称 complete。扫描停止须保留正确未完成语义或拒绝，不能跳过对象。补 list／detail 的极小、非法和有效下调预算用例。

### M2-CR03 · P2 · 活动查询可返回超过保留期但尚未批量清除的明细

位置：`apps/platform/application/perception-service.ts:77–80`、`171–177`；默认保留期定义在第 16 行。

触发：存在超过 200 条已过七天保留期的 `perception_access` 记录，其中剩余记录属于当前主人在发生时有权查看、现在也有权查看的 Agent。一次 activity 请求在入口只清除最多 200 条；第 173 行继续读取剩余记录，第 175 行只过滤受众、私密范围和当前目标权限，没有过滤 `recordedAt`。因此仍在表中的过期明细可作为正常历史返回。旧会话内的物化记录同样没有保留期重验。

影响：有限批次清理变成了额外披露窗口；设置的明细保留期不能限制查询。`historyCoverage.complete:false` 也不允许返回已经超期的条目。

最小修订：查询与会话续页独立执行保留期披露屏障，不依赖物理删除及时完成；批次清理可继续有界。过期导致固定页集变化时按稳定分页规则失效／重启，避免过滤后继续沿旧 offset 跳项。补大于清理批次的过期积压及续页跨保留边界用例。

### M2-CR04 · P2 · 准备事实丢失概览范围及观测，无法回看当时提供了什么

位置：`apps/platform/application/perception-service.ts:88–92`、`126`、`196–199`。

触发：同一 Agent 先后只请求 people、只请求 items 的 overview。响应各有本次 observationId、指标／数量及来源覆盖；调用 `record` 时两个请求都没有 targets，记录的 preparedCount、contentVersion、segment 均为 null，也没有类别、指标、数量／口径、范围或覆盖状态。写入的事实仅能说明调用过 `perceptionOverview`。这些数据之后不能从已变动的世界重建。

影响：即使事务中保存了 `data_provided`，该历史仍不能说明服务端当次准备的内容范围，无法兑现 v1.2 §10 与技术评估 §4.2／§5 的准备事实语义。list 的记录也未保存类别、页完成与来源覆盖信息；空列表尤其无法从 targets 推回范围。

最小修订：用受控允许字段保存足以解释本次准备的观测／范围、指标口径与覆盖、页数量及完成状态；保留实际版本／段范围，仍按最严格受众保存／展示。不存原请求／响应正文、凭据或 token，不在查询时拿当前数据补写旧事实。补两种不同概览、空列表和部分覆盖的持久事实断言。

### M2-CR05 · P2 · seed 在核实 DB／identity 配对前打开可迁移、可改恢复代次的 store

位置：`scripts/ws02-demo-data.ts:14–17`；所调用的既有行为见 `apps/platform/infrastructure/relational/sqlite-store.ts:108–122`。

触发：管理员误传同实例但恢复代次不同的旧 identity 文件。seed 只验证该文件的 version／两个字符串，第 16 行即 `openM1Store`；该构造器先迁移数据库，再把 `instance_state.recovery_epoch` 更新为传入值，而不会拒绝同实例的代次不配对。不同实例 identity 也要到迁移提交后才拒绝。`--operator` 缺失／非法同样在打开 store 之后才由 seed 函数拒绝。

影响：一个应只为当前原库新增演示数据的命令，可在配对错误或参数失败时已经改变 schema／恢复代次；原运行连接会被代次栅栏拒绝，原凭据也可能不能再按当前代次使用。本报告没有实际执行这种破坏性轨迹，且不把旧 store 的显式恢复配置能力本身记为本轮新缺陷；新问题是 seed 将其直接当作配对校验使用。

最小修订：在任何可写打开／迁移之前验证全部参数，并只读检查既有 DB 的 instanceId 与 recoveryEpoch 同指定 identity 完全一致；缺失或不匹配直接拒绝，不提供隐含修复。seed 不能借普通打开改代次。补错误实例、同实例错误代次、缺失 operator 时 DB／identity 保持字节／原行值的用例；测试仅用隔离合成库。

## 3. 已知补建项，保留原归属待后继复核

| TD 送审时已明确在修 | 本次处理 |
| --- | --- |
| T01：首次无效完成凭据失败后，同 operationId 改载荷可成功；失败键未固定 | 不另编号；固定源码仍只在成功时写 operations。保留原失败键／同键异载荷验收，不能按事务成功用例代替 |
| T02：notifications scopeKey 混入过滤后的未确认 grant 集，新正文变化变成不可比较 | 不另编号；固定源码第 118–120 行仍有该路径，待修后重审 count 不变／新版本与确认变化 |
| 精确 schema、完整纯 HTTP guide | 固定候选仍是宽松占位 schema／简略 guide，不能记公开合同可用；新增严格目录用例也未通过本轮证据证明 |
| CLI 手动 check-updates、grant-generation／分页权限屏障、管理版本发布 helper | 不从工作中的 API／acceptance 树取新实现，不在本报告预先接受；失权／重授、来源变化、稳定页与恢复代次须后继验证 |
| 实际一次性管理员 seed 发布事件 | 保留待补与新事实审查；本轮 seed 的已有标记不能替代最终事件证据 |
| WS01-ACCESS-R01 与后续 CLI 公开说明 | 9c1e940 的两行修订已含本固定 diff；WS01 原 owner 复核及后继 CLI 文档差异仍待新回执 |

## 4. 本次静态核对中成立的边界

- 认证复用 M1 的凭据有效性、实例恢复代次、owner authVersion／runtimeVersion；consumerId／purpose 不作为身份。world 公开资料从 published 白名单投影，未把私有主人／邮箱／凭据作为人物来源。
- inbox 与 holdings 取实际 runtime 的投递／持有授权；主人管理绑定没有直接取得这些私密读取能力。活动记录保存发生时的主人受众，查询再检查当前绑定与当前公开目标，不能因新绑定自动继承先前历史。这里的静态正向检查不免除 CR01 和待补分页权限屏障。
- 正文 token 由服务端保存同 ref／版本／上下文／grantVersion／到期时间；正常连续分段末段才签完成凭据，读取不自动确认。成功确认先验当前可读性，再优先重放原成功回执，随后才检查新操作完成凭据／版本；同版本不同新键可返回 changed:false。
- 成功确认状态、operations 与 facts 在同一个 `store.transaction` 中；响应构造／字节校验、读取准备事实同事务后才返回。任何抛错沿 store 的回滚路径，不存在本代码提交后异步补成功事实的分支。失败尝试记录不是保证完整的能力，本候选未提供完整失败诊断历史。
- schema5 仅追加六张 perception 表及索引；固定 diff 没有改变 migration1–4 定义／checksum 算法，也没有删除／重建原 M1 表。此为源码检查，不是对用户原库迁移结果的验收。
- seed 仅为缺失稳定 ref 新增内容／关联，不覆盖已有对象内容或重新激活 inactive grant；注册事务仅在显式 seed 激活后为未来 Agent 增加缺失关联。演示记录逐项带 dataMode／source，计划与发生记录分类型，不把公开物品目录等同持有权。
- snapshot／changes／current-items／reader-state 明确未启用；没有新增前端、定时执行、自动 Skill 安装或公网部署。自由 decision 正文保守不保存，不能据 `not_retained` 推出已接收完整申报；此保守选择符合无法可靠判断披露范围时不存正文的规则。

## 5. 作者证据与尚未覆盖的验证

本节只读作者 TAP／测试源及 TD 回执，均不是 reviewer 执行。证据目录：`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-real-perception/`。

| 证据 | 实际范围与限制 |
| --- | --- |
| `core-696670a-first.tap` | 原首跑 9 项：5 pass／4 fail／0 skip；失败含 T01、T02 及后来修订的两处测试。没有将其改记为全绿 |
| `core-696670a-test-corrections.tap` | 两个修订后的定点：30→27 与真实 SQLite operations／facts 写失败回滚，2/2、无 skip；只证明这两项作者运行 |
| `affected-696670a-fixture-updated.tap` | 受影响 M1 API、config/app、storage/sqlite-store、recovery-migration 四文件 34/34、无 skip；旧 setup fixture 改为真实邮箱体验码注册流程，原权限／恢复等断言仍在 |
| `tests/ws02/*` 固定源 | 现有 10 组测试，使用隔离临时库与 Fastify `app.inject`，不是网络 listener 的真实 HTTP／独立 Agent 运行。源码包含 schema4 合成迁移、幂等 seed／新注册、分段／跨 Agent、活动私密过滤、写故障与严格目录断言；没有 skip 或把 T01／T02 改为接受错误行为 |
| typecheck／内存 smoke | TD 回执称 typecheck 通过、67 对象／31 投递（30 可读可确认＋1 不可用）。所读 typecheck 日志为空，不能独立从该文件确认退出状态；未读私密 manifest／原库，未自己重复 smoke |

首跑迁移检查的是从合成 schema4 数据复制出的旧库，不能宣称用户原库及配对 identity 已迁移验收。当前新增严格目录测试不在首跑九项中；两项定点也不是当前十项同次全跑。没有全量回归、真实账户／邮件、UI、手机、其他端口或公网的新通过结论。

后继至少需要：原作者逐项修复本报告与已知补建项；固定最终生产／测试／公开文档组合及 diff；原 reviewer 复核新增／修订差异；作者提供与最终候选匹配的定点证据，覆盖私有存在性、预算、保留积压、历史观测、seed 配对保护和稳定分页权限。独立“小序”手动 HTTP 结果由原会话另行提供，不能用本报告或 `app.inject` 替代。原 8789／原数据／备份／其他端口保持原登记，本报告不产生部署或迁移回执。

## 6. R2 固定增量独审：8a8cd539 → 4fe7506

2026-10-20，继续由同一稳定 reviewer 纯静态检查。**本节不是最终交付接受；M2-CR01—05 全部保持开放，另新增 M2-CR06—08。** 不以新增十项全绿覆盖原问题，也不读取作者正在续修的浮动树。

### 6.1 组合与核对

- 本轮 base：`8a8cd53971b3408526e69d1c506bb54292275e73`；target：`4fe75068185753ded7e973aacb96ac3084249ce2`；累计基线仍为 `878a0cab60a28027f3b30facaa0860dc56dd2ca3`。
- 新生产原 `9e3e947eeaf8dbf7af8fedd9e4b6e18073095eb0` → integration `779ec4f`；新测试原 `bc923cc20bb8bf0d2fbe6df4518076bce61ef6db` → `7c7b97b12974ae6addaa5b105ecfcf37301b773f`；CLI 文案原 `6583af27241312f24f5543a9b66183d25d71e7d3` → target。
- 限定生产 `apps/platform`／`scripts/m1-agent.ts`／seed 脚本、测试 `tests/agent/cli.test.ts`／`tests/ws02`、三份公开接入文档，各自与上述作者提交比较均退出 0。增量 12 路径、399 行新增／72 行删除；增量 `git diff --check` 退出 0。
- 本轮仍未运行程序、测试、HTTP、服务或数据库，未读取私密 fixture／identity／token，只追加本报告。以下新触发均是固定源码推导。

### 6.2 M2-CR06 · P2 · 缺失文档的合法 JSON 缓存仍会被判为完整且 unchanged

位置（以下均为 `4fe7506`）：`scripts/m1-agent.ts:423–425`，完整引用收集在 `438–442`。

触发：已保存缓存的身份、complete:true 和两个 revision 保持不变，但 `documents` 变成空数组，或移除某个目录仍引用的 guide／schema；也可移除 directory 而保留 documents。第 424 行仅逐项验证“仍在数组中的文档”的 digest，不证明目录存在、条目集合完整、引用可解析或所需文档齐全；第 425 行直接按 revision 相等返回 unchanged，不再发现缺项。

影响：文案承诺损坏缓存须保全并报告、只有完整目录及所需精确文档才能成为完整基准，但该路径会把明确缺失的本地说明称作未变更的完整基准。正常原子写入不能替代下次读取时的结构／引用校验。

最小修订：在 unchanged 快路前复用与新缓存相同的结构和引用完备性检查，核对目录集合、唯一键、精确文档 ID／版本及所有所需引用，缺失或冲突报告 `discovery_cache_invalid` 并保全原文件。补空 documents、缺一份 guide／schema、缺 directory、重复／错绑文档的私有缓存用例，同时断言不续交未决业务。不是要求访问服务器偷偷补写坏缓存。

### 6.3 M2-CR07 · P2 · 收尾能力检查遗漏实例身份，可提交已切换实例的旧基准

位置：`scripts/m1-agent.ts:452–454`；初始身份屏障在 `518–519`，分页／文档检查在 `432`／`447`。

触发：初始 capabilities、self、目录和文档均来自原实例 A；最后一次 capabilities 前同 origin 切换到实例 B，其 catalogRevision／skillCatalogRevision 恰与 A 相同，例如两个实例均使用固定 `catalog-demo-1`／`skills-demo-1`。收尾代码只取 perceptionApi 并比较两个 revision，丢掉了外层 instanceId／apiVersion 和当前协议声明，随后原子保存并报告 updated。

影响：恰好在可检测的收尾读中已知道来源改变，却仍把原实例的资料登记为当前完整更新。revision 不是跨实例身份；前面各页的实例校验不能替代最后一次能力响应的同实例校验。

最小修订：收尾对完整 capabilities 重验原 instanceId、apiVersion、感知协议／发现绑定及版本，再允许替换缓存；不匹配保留原基准、报身份／协议错误，不重新注册。补末次 capabilities 同 revision 换实例和协议改变的隔离 transport 用例，保持业务命令／交接不变。

### 6.4 M2-CR08 · P2 · 新发布来源故障会错误阻断不依赖它的计划指标列表

位置：`apps/platform/domains/perception/protocol.ts:10`；`apps/platform/application/perception-service.ts:119–126`、`138–145`。

触发：demo-events 为 enabled，platform-publications 为 unavailable／not_enabled；请求 events 的 plans 指标。目录声明 plans.sourceIds 只有 demo-events，因此 overview 可准确返回两条计划、status:available，并给出 plans 的 listEntry。list 却在第 140 行无条件检查整个 category.sourceIds，包含新增 platform-publications，导致 plans 列表返回 503／409，尚未进入只选 plans 的候选逻辑。

影响：同一指标的概览与列表使用不同来源依赖口径；一个无关来源失效就使已经证明可读的计划内容不可遍历。这个问题由本增量为 events 增加第二来源后产生，不是要求吞掉实际所选来源的失败。

最小修订：选择 metricId 时按该指标声明的 sourceIds 验证来源／冻结来源集合；未指定指标时仍按整个类别。摘要候选也须属于实际选定来源集合。补 platform-publications 故障下 plans 概览／列表仍一致成功，occurrences 或整个 events 因实际缺源明确不可用、不称完整的组合用例。

### 6.5 原已知项与新增实现的静态判断

| 项目 | 本固定增量结论 |
| --- | --- |
| M2-CR01—05 | 全部开放；不在此轮重复原触发轨迹。已读作者边界基线 0/2，确认 CR01／02 仍实际失败；其余仍待精确修复提交与覆盖证据 |
| T01 指定的错误完成凭据／原键轨迹 | 第 168–175 行将确定的 completion／content-version 拒绝保存为 operations 原错误结果；事务提交后再转成 HTTP 错误。原载荷先查回执、异载荷冲突；M1 receipt 也按当前读取权返回原错误。该指定轨迹静态关闭，并有作者对应测试通过；不扩大为任意鉴权前／格式错误或服务失败都保留回执 |
| T02 原确认过滤与 scopeKey 混合 | authorization 改为全部已扫描授权行（含 active／版本）的指纹，不再取过滤后的未确认候选；scopeKey 不随确认投影变化，contentRevision 另含候选对象版本与状态。原指定问题静态关闭，作者新正文版本比较用例通过；仍不把未知／不完整概览称可比较 |
| 分页权限 | 私有 list 保存已选 ref 的 grantVersion，续页重验，撤权／重授不能复用该已选项旧 grant；activity 发现当前过滤改变则整页失效，避免旧 offset 跳项。尚未给出本轮新增专门分页屏障运行证据；未选中授权集合变化、来源撤回／恢复等组合仍应随最终固定候选覆盖，不记全部已验 |
| schema／纯 HTTP guide | 新 operation 输入及主要信封／输出已有字段、required 和 additionalProperties:false；guide 已给实际方法、请求模板、连续正文、确认与停止／恢复说明。类型 summary／detail schema 仍是宽松基础字段；discovery／activity 的嵌套记录也较宽，未见实际响应对全部 schema 的校验。digest 的算法／规范序列化没有公开定义，非 Node 宿主仍无法仅凭 guide 独立复算；应由原 owner／作者补清此部分，不据输入字段断言称全部精确合同已完成 |
| CLI 权限与保存 | check-updates 在 pendingMutation／manualControl／initialize／handoff 分支之前返回；只走 GET，不续交未决业务、不换交接。正常首次 onboard 在保存身份及交接后继续发现，发现异常单报 unknown。新缓存仅在分页、精确文档 digest 与尾 revision 通过后调用原 0600／fsync／rename 保存；失败保留原完整文件。完整性与尾身份仍受 CR06／07 限制 |
| 一次性发布发生记录 | seed 用稳定 publication ref 的仅缺失插入，记录真实管理员／提交时间、dataMode:platform；publishedRefs 仅取当次公开 seed 对象，不含 inbox。正常重复 seed 不替换原事件或改写为 Agent 行为。新 manifest 将 seedObjects 与动态公开 profiles 分开，含作品／道具、持有／投递引用 |
| 两个本机管理 helper | 固定 OPERATIONS／路由未登记 helper；runtime／owner 目录没有发布／编辑权限，源码仅导出本机 library。管理命令以 actorId＋operationId 保存 payloadHash／原结果，同事务编辑及新增旧版 source history、回执和管理员事实；不能把普通 runtime／owner token 当管理权限。当前测试使用的是旧 publishPerceptionCatalog 测试 helper，未见这两个新入口自身幂等、CAS、source history／写故障的运行覆盖 |
| TD 提前派修的 publisher revision 问题 | 保持原归属与开放：publishPerceptionGuide 在 revision 不变而 guideVersion 增加时可变更真实声明却不改两种 revision。第 37–40 行和 catalog 第 38 行仍允许该路径；不另重报新号。最终须拒绝静默变更，并保留精确同键原载荷回执优先 |

### 6.6 作者证据及复核边界

仍只读取 `m1-acceptance/outputs/ws02-real-perception/` 中的作者证据，不是 reviewer 执行：

- `ws02-9e3e947-first.tap`：10/10、无 fail／skip，包含 T01、T02、严格 operation 输入字段与角色目录检查；这是 Fastify app.inject／真实隔离 SQLite 的作者测试。
- `affected-9e3e947.tap`：原受影响四文件 34/34、无 fail／skip。
- `cli-9e3e947-fixture-updated.tap`：12/12、无 fail／skip；新测试下载独立脚本，在真实临时 loopback listener／proxy 上调用，正常目录成功来自实际服务，故障由受控代理注入。其断言保留注册／初始直接保存／交接三种丢响应、主人提议所需的真实 prepare／publish，以及发现半途／guide 失败不覆盖旧缓存、check-updates 不续交 pending。
- `boundaries-9e3e947-baseline.tap`：0/2、两项失败、无 skip；私有故障预期 404 实际 503，读取预算预期 422 实际 200。它们继续证明原 CR01／02，不能被前述 10/10 或 12/12 覆盖。
- `typecheck-9e3e947-final.log` 仍为空文件；exit0 依据 TD 回执，本 reviewer 未运行或从空日志独立推断退出状态。CLI 首轮失败记录由作者保留，本轮不重写历史失败。

本增量没有 CR06／07 缓存／收尾身份、CR08 多来源指标故障及新本机管理 helper 的实际定点证据；没有独立“小序”运行的新验收结论。后继仍须给固定完整修订及匹配测试，原 reviewer 复核；不得据本节记最终可交付、已迁移用户原库或已更新 8789／公网。

## 7. R3 固定增量独审：4fe7506 → 4066795

2026-10-20，同一 reviewer 继续纯静态复核。**CR01—05 的原指定问题静态关闭；原 publisher“沿用当前 revision 改 guide”路径已阻止，但新增历史 revision 复用问题 M2-CR09（P2）。CR06—08 继续开放，整批仍未接受为最终交付。** 静态关闭不表示 reviewer 实际运行测试或用户库迁移通过。

### 7.1 固定组合与执行边界

- base：`4fe75068185753ded7e973aacb96ac3084249ce2`；target：`4066795021792d7e3a592a7b5c975df3a528dfc0`；累计基线不变。
- integration 生产 `048e4945c99dd23ce7aec93f45e7e46a50d4264e`，原 API `e1fed249c287f1f21b7be3985d41186ea9eeb7b6`；测试 target，原 acceptance `4b23aaeccb6c8142ff9b6d501216e7c422690bee`。限定 `apps/platform`／seed 脚本与生产作者提交、`tests/ws02` 与测试作者提交，比较分别退出 0。
- 六路径增量 371 行新增／20 行删除，固定 diff 的 `git diff --check` 退出 0；没有改 CLI 实现、协议类别声明或开放新 HTTP 管理入口。
- 只读固定 Git 对象、原报告与作者 TAP／普通日志，未运行程序、测试、服务、HTTP、CLI 或数据库，未读私密 fixture／identity／token；只追加本报告。

### 7.2 CR01—05 逐项复核

以下行号为 `4066795`；关闭范围是各发现原先列出的触发与责任，不是所有性能／并发／授权组合的全量验收。

| 原问题 | 修订与静态结论 | 作者对应测试源 |
| --- | --- | --- |
| CR01：私有存在性先泄漏来源故障 | `perception-service.ts:29–42` 先验证公开角色或实际 inbox grant／目标归属，再披露来源状态；未知／无权／撤回保持安全 404。query／确认／历史回执共用当前读取检查，主人专用限制仍在。**静态关闭** | `boundaries.test.ts:7–70` 遍历三种来源状态、兄弟／异主 runtime／owner、已知与不存在 ref、确认与回执，以及公开角色撤回 |
| CR02：list／detail 忽略 budget | `:144–179` 校验预算并用 meteredRead 对 list 的扫描／后续读取计量，缓存本次已读行；满额或无法证明选集完成拒绝，续页不把 budget_too_small 吞为权限错误。`:182–191` 校验 detail 预算／准备时间；最终响应按请求 UTF-8 字节上限校验，同事务失败回滚新会话／准备事实。**原问题静态关闭**。detail 采用已指定单对象、无集合扫描的口径，1 个内容对象的正预算合法；这不证明全部 SQLite 内部物理读取或查询计划的性能上限 | `boundaries.test.ts:72–113` 包含两操作 1 字节拒绝、列表首页／续页扫描 1 拒绝、非法形状／数值、1ms 准备超时、正常预算成功及失败不提交会话／准备事实；单对象 detail 的 maxScannedRows:1 明确保留成功 |
| CR03：批量清理积压越过保留期披露 | `:225–226` 在查询与固定页续读逐项检查 recordedAt 的保留下界和 cut 上界；过滤发生变化整页失效，物理清理仍有界。**静态关闭** | `boundaries.test.ts:115–144` 留下超过一批的过期记录仍不披露，续页跨过保留期返回 read_scope_changed，不用旧 offset 跳项 |
| CR04：准备事实缺少当次观测 | `:91–105` 保存允许字段的 preparedObservation：概览指标／数量／范围／来源覆盖，列表类别／所选口径／空页／对象版本，详情版本／段／完成状态；不复制正文或续读／完成凭据，仍与响应准备同事务。**静态关闭** | `boundaries.test.ts:146–210` 比较两类概览、未检查指标、空持有页、分段详情及安全字段；后续公开角色变化不改写先前内部观测 |
| CR05：seed 配对检查前已可写打开 | `scripts/ws02-demo-data.ts:11–27` 先校验 operator／路径／既有文件及 identity 形状，再只读检查 DB instanceId／recoveryEpoch 完全配对，最后才可写打开。**原误传参数轨迹静态关闭**；未扩张为并发恢复切换或真实原库迁移验收 | `admin-and-seed.test.ts:46–86` 使用合成 schema4 库，错实例／错代次／缺失及非法 operator 均拒绝，并断言 DB 字节、旧表行、迁移历史和 paired identity 保持、无 manifest |

纠正证据口径：旧 `boundaries-9e3e947-baseline.tap` 的预算反例是 **list 续页 maxScannedRows:1 仍返回 200**，不是 detail 1 字节返回 200；R1 的“两个操作忽略字节预算”判断属于更早的 `8a8cd539`。两版问题和证据各守固定对象，不互相挪用。

原 publisher 当前 revision 防护见 `perception-catalog.ts:41–46`：同当前 revision 改 guideVersion／明确文本现在返回 version_conflict；原操作原载荷重试仍先由管理 command 的历史回执返回，不受后来 current revision 变化影响。这个原指定轨迹静态关闭；不能据此宣布 revision 身份在整个历史上不可复用，见下项。

### 7.3 M2-CR09 · P2 · 历史 catalog revision 可被复用，旧完整缓存会漏掉新 guide

位置：`apps/platform/application/perception-catalog.ts:41–48`，经本机 `perception-admin.ts:34–40` 发布；客户端判断路径仍为 `scripts/m1-agent.ts:425`。

触发轨迹（源码推导，未实际执行）：先用新操作发布 revision A／guideVersion 2，并让客户端可靠保存该完整目录；再发布 B／guideVersion 3，原客户端在此期间不检查；第三个新操作以 expectedCatalogRevision:B 发布 **A／guideVersion 4**。第 43 行只比较当前 B，A 与 B 不同便绕过同 revision 防护；版本 4 没有回退，精确版本文档也可以新建。第 48 行将 catalogRevision 恢复为 A、skillCatalogRevision 恢复为 skills-A。原客户端保存的 A／skills-A 因而与当前能力声明相等，直接返回 unchanged，仍持有版本 2 的说明。

影响：即使当前 revision 每次看起来变化，离线跨过中间版本的 Agent 仍会错过真实的新声明；revision 不能同时命名两个不同目录／Skill 基准。这与已阻止的“沿用当前 revision”属于不同轨迹，不能靠 exact operationId 回执处理，因为这里使用的是三个合法新操作。

最小修订：在公共发布事务中为 revision 建立不可变声明绑定／历史使用约束，或由服务端分配不会复用的发布 revision。已被用于其他声明的 revision 不能再指向新 guide；精确同键重放仍优先返回原回执，不因 current 改变而重新执行。保护应落在共同发布入口，不能只补 CLI。增加 A2 → B3 → A4 拒绝／不改 current、原 A 原载荷重放成功，以及旧 A 缓存不误报 unchanged 的隔离测试。

### 7.4 作者证据与剩余范围

- 已读 `outputs/ws02-real-perception/ws02-e1fed24-first.tap`：14/16、2 fail、无 skip；非法 budget 形状原误期待 422、实际 400，保留失败记录；activity 测试最初使用的稳定 ID 排序假设也保留原失败。
- 已读 `ws02-e1fed24-final.tap`：16/16、无 fail／skip。最终源码明确对非法对象形状期待现有 400／invalid_request；用带固定时间前缀的近到期 ID 保证枚举顺序，仍保留积压实际存在、当前不披露及续页失效断言，没有把错误行为改为通过。六组新测试分别对应 publisher／管理编辑、seed preflight、私有存在性、预算、保留期和准备事实。
- 管理 helper 新测试已覆盖精确原载荷幂等、异载荷冲突、旧 guide 可读、编辑版本变化、单次管理员事实及未暴露 HTTP 权限；未据此声称 source history 内容与全部写故障／容量组合均已验证。
- `typecheck-e1fed24-first.log`／`typecheck-e1fed24-final.log` 均为空；typecheck exit0 仍仅依据 TD 回执。本 reviewer 没有执行 typecheck 或测试。16/16 属隔离 SQLite／app.inject 作者证据，不是实际原库／独立“小序”HTTP／UI 验收。
- **当前开放：CR06、CR07、CR08、CR09。** CR06—08 的修订未进入本固定差异；公开 digest 定义／动态 schema 校验及管理 helper 深入测试仍待后继。原 T01／T02 指定轨迹的 R2 静态关闭保持，后继新增差异仍须复核，不继承未覆盖的通过状态。

本节不产生最终整批可交付结论，不运行或更新 8789，不证明用户原库已迁移，也不扩大其他端口、公网、真实邮件、前端或手机范围。

## 8. R4 固定增量独审：4066795 → 0bf33df

2026-10-20，同一 reviewer 继续纯静态复核。**CR06—08 的原指定问题静态关闭；本增量未新增发现。CR09 继续开放，动态 digest／schema 及对应真实信封验证尚未进入本固定差异，整批仍未接受最终交付。**

### 8.1 固定组合与边界

- base：`4066795021792d7e3a592a7b5c975df3a528dfc0`；target：`0bf33dfa9936d925d5423686bc52ea5f2056ce23`，累计基线保持。
- 生产 integration `0f6d83531acd19401aad9ca7c966a520fb0561be`，原 API `05d68820dffa79e60aea6ed42eb4039d1a7b4c4f`；测试 target，原 acceptance `0c06e36ce921d5166b1c799b6653aec4c559bc80`。限定 `apps/platform`／`scripts/m1-agent.ts` 与生产作者提交、`tests/ws02`／`tests/agent/cli.test.ts` 与测试作者提交，比较分别退出 0。
- 五路径增量 179 行新增／20 行删除，固定 `git diff --check` 退出 0。没有修改 publisher 的历史 revision 约束，因此不覆盖 CR09。
- 本轮只读固定对象与作者日志，未运行程序、测试、HTTP、服务、CLI 或数据库，未读私密 fixture／identity／token；只追加本报告。下表关闭仍为静态结论，作者运行证据另列。

### 8.2 CR06—08 逐项复核

以下行号均为 `0bf33df`。

| 原问题 | 修订与静态结论 | 作者对应测试 |
| --- | --- | --- |
| CR06：缺失缓存说明仍 unchanged | `scripts/m1-agent.ts:413–443` 检查目录集合／唯一键和跨集合引用，从模块、类型、操作、Skill、来源收集精确 guide／schema，校验文档 kind／ID／version、内部文档身份、digest 与精确覆盖；`:462` 在 unchanged 快路前调用，`:487` 在新缓存写入前复用。缺失、重复或错绑文档拒绝且保全文件，不偷偷重取修复。**原指定问题静态关闭**，不把这套结构检查当完整动态 schema 验证 | 扩展 CLI manual 故事包含七种损坏：无 directory、目录集合全空、空 documents、缺 guide、缺 schema、重复文档、错绑 ID；均期待 discovery_cache_invalid，原文件字节保留、无新 discovery、未决业务与证明保持 |
| CR07：尾 capabilities 漏检实例／协议 | `scripts/m1-agent.ts:445–449` 统一重验原 instanceId、apiVersion、perception、protocolVersion、GET 发现绑定及非空 revision；`:485–488` 先检查完整尾响应和两种 revision，才替换缓存。**静态关闭** | 六个尾响应探针分别改变实例、API 版本、感知启用标记、协议 major、发现方法和发现路径；均在真实目录与精确文档读取后才注入，期待对应安全错误并保留旧完整缓存 |
| CR08：无关来源阻断 plans 列表 | `perception-service.ts:171–181` 按 metric 的 sourceIds 验证／过滤候选，并绑定 query、来源状态和 session 的 permissionSourceIds；`:20`、`:88–90` 只对该固定选择的来源状态计算续页权限指纹。无关发布来源失效不阻断 plans 首页或原页续读；未指定 metric／occurrences 仍检查其真实依赖。**静态关闭** | `tests/ws02/contracts.test.ts:6–31` 对 platform-publications 的 unavailable／not_enabled 分别验证 plans 概览 2 条、原稳定页可续、完整列表 2 条且只列 demo-events 来源；occurrences／整个 events 明确 503／409，无假空或假完整 |

新增本机 helper 测试 `admin-and-seed.test.ts:88–121` 使用实际 SQLite trigger：编辑时管理员事实写失败、发布时管理回执写失败，均比对 source／history／catalog／access 全部快照不变；移除故障后同键成功且精确重放、单条管理员事实。另核对旧 object_history 内容等于原 source.data、陈旧 CAS、改载荷同键和陈旧 expectedCatalogRevision 拒绝。固定生产仍仅导出本机 library，不向 runtime／owner 增加发布 HTTP 权限。这里只接受这两处实际故障注入和对应断言范围，不扩张为所有表／容量／崩溃组合已经测试。

### 8.3 作者证据及其实际运行方式

只读 `m1-acceptance/outputs/ws02-real-perception/`：

- `ws02-05d6882-first.tap`：HTTP/service/admin 测试 18/18、无 fail／skip，包含新增 plans 来源故障隔离与管理事务故障测试；属于隔离 SQLite／app.inject 的作者证据。
- `cli-05d6882-r2-first.tap` 保留 manual 单故事失败，`cli-05d6882-r2-diagnostic.tap` 明确显示 actual:rate_limited。不能把未到达期望尾检查的限流结果算作该安全分类通过；产品原 240/min 限流没有放宽。
- `cli-05d6882-r2-audited.tap`：扩展 manual 单故事 1/1、无 fail／skip；不是全部 12 个 CLI 故事重跑。七种缓存损坏及六种尾探针的测试源码与预期仍在，没有把受控拒绝改为成功。
- 最终六个尾探针各自在原自有私有 DB／identity 上正常关闭、重开新的 port0 backend，proxy／客户端 state／旧完整 cache 保持。逐 probe 日志均记录 backendRestart 1…6，每次 2 个 capabilities、1 个 self、1 个 discovery、5 个 guide、34 个 schema，actualCode 与 expectedCode 一致。此为有界独立 transport 探针，**不称一个持续 backend 进程完成全部链路**，也不证明吞吐或限流长期通过。
- 测试只恢复自己故意损坏的缓存 fixture；产品路径仍拒绝并保全坏缓存。读取更新不重注册、不换交接、不续交 pending，不提交 perception 写入，最后仍校验原公开角色与唯一注册。
- `typecheck-05d6882.log` 为空；typecheck exit0 只依据 TD 回执，本 reviewer 未执行。本轮没有独立“小序”真实 HTTP 或用户原库迁移的新验收。

当前记录：CR01—08 的各轮指定轨迹静态关闭；**CR09 开放**。动态 digest 算法／schema 版本与真实请求响应信封的后继实现、测试和静态复核未完成，不因 R4 的 18/18 或单故事 1/1 提前接受。保持原 8789、用户数据、备份、其他端口、公网及全部未测范围；本报告无运行／部署副作用。

## 9. R5 固定增量独审：0bf33df → d12553a

2026-10-20，同一稳定 reviewer 完成纯静态复核。**接受累计固定范围 `878a0cab60a28027f3b30facaa0860dc56dd2ca3 → d12553a0d962751e8551926341441917b5ced7e7` 的本轮代码独审。CR01—09 及 T01／T02 的指定问题均已静态关闭，公开 digest／schema2 的原补建项已有实现与匹配作者证据，本增量无新增阻断发现。** 这是固定源码／测试／已审公开接入文档组合的代码独审接受，不是独立“小序”黑盒 HTTP、用户库迁移、8789 更新或整批产品交付完成的回执；在既有授权与交付流程内继续相应验证，不新增人类审批门槛。

### 9.1 固定组合与本次操作

- 本轮 base：`0bf33dfa9936d925d5423686bc52ea5f2056ce23`；target：`d12553a0d962751e8551926341441917b5ced7e7`。
- 生产 integration `2b7e4b776200448d47aafd4d7bedb3f719638d40`，原 API `bc95f7d5c9afa1a1245de11b065e3cd9c095de83`；测试 target，原 acceptance `17e02f452f1d40d9a167d6ab4ae90f9de7ac55d2`。限定生产／CLI／seed 与原生产提交、`tests/ws02`／CLI 测试与原测试提交，分别比较退出 0。三份 `docs/access/v1/{entry,http-api,local-setup}.md` 相对 R4 无差异，限定比较退出 0；不把未改文案另记一轮 WS01 审核。
- 九路径增量 247 行新增／33 行删除，固定增量 `git diff --check` 退出 0。
- 本次仍只读 Git 对象、源码／普通 smoke 脚本、TAP／spec 日志和验证 metadata，使用文件摘要核对证据；未执行项目 JS、测试、CLI、构建、typecheck、HTTP、服务或数据库，未打开私密 fixture／identity／token／用户 DB。只追加本报告。

### 9.2 最后开放项与新增实现

以下行号属于 `d12553a`。

| 范围 | 静态判断与接受界限 |
| --- | --- |
| CR09：历史 revision 复用 | `perception-catalog.ts:48–56` 将 revision 绑定不可变声明摘要，包含协议、guide／schema 版本和文档 digest、类型／类别／操作与 Skill revision；声明不同即 version_conflict，并有 10,000 条硬容量。共同 publish 在 `:67／75` 记当前与新声明；新库初始化、旧库当前升级和 seed 转换也登记。A→B→A 新 guide 在同事务内拒绝，无半个文档／回执／事实；管理 command 的原键回执仍先于 current CAS。**指定问题静态关闭** |
| revision 记录起点 | 从能力建立后的新库初始化、旧库当时 current、后续 publish／seed 转换开始记录；没有伪造能力建立前已非 current、从未留下 descriptor 的任意历史。不能称追溯恢复了这些旧声明。TD 明确本轮受保护用户库仍是 schema4、没有已交付 WS02 历史，此限制不构成本次实际交付基线的旧缓存缺口 |
| 公开 digest | `protocol.ts:41–44` 和 service 的文档响应提供 canonicalDocument，声明 digestAlgorithm:sha256-utf8-hex；`schemas.ts:70` 明确定义先核对 JSON 结构相同，再对原字符串 UTF-8 字节计算 SHA256 hex，不添加 BOM／换行、不重序列化／locale 排序，并有 Python 示例。CLI 使用返回字符串验证结构／digest，旧本地缓存仍可沿既有摘要格式读取。普通 HTTP 宿主不必阅读 CLI 源码猜规范 |
| schema2 | `schemas.ts:3／16–66` 为 operation 的请求／成功／错误信封、目录、指标／范围、活动准备记录及各正文类型提供受控字段、required 与 additionalProperties:false；类型 schema 分 profiles／holding／item／place／plan／occurrence／mail 等说明实际字段。目录、摘要与详情引用统一 schemaVersion 2，包含 errorSchema，CLI 将其纳入精确文档集合。资料字段上限另与既有 `profile-rules.ts` 核对一致；未改 M1 资料／权限实现 |
| 文档升级及不可变 | `perception-catalog.ts:8–25／27–45` 新库是 guide1／schema2，不虚构 schema1。既有 schema1 的 document／digest 行不覆盖；保留原 guide 文本另建 guide+1／schema2，并联动目录／Skill revision。已有精确版本行不被新代码的 HTTP_GUIDE 内容替换；新 descriptor 检查与旧文档保全在同一初始化／发布事务。源码静态检查与下述旧版合成库 smoke 分别成立，不等于用户原库升级已完成 |
| 其余关闭项 | 本增量没有恢复 CR01—08 的原错误顺序／忽略预算／过期披露／不完整准备事实／seed 配对错误／缓存缺项／尾身份漏检／多来源指标混用。原 T01／T02 静态关闭保持。未引入管理 HTTP 路由、调度、后台检查、新前端或公网能力 |

CR09 新用例 `admin-and-seed.test.ts:123–141` 使用三个合法新操作：A、B、以更高 guide 版本复用 A；检查拒绝前后 catalog／access 快照相同、current 保持 B，原 A 精确操作仍取原回执。没有靠回退 guideVersion 或修改旧操作载荷来回避原问题。

### 9.3 公开合同与旧文档的作者证据

- `tests/ws02/public-contract.test.ts` 从实际服务的 discovery 取得 schema 引用，再经文档 HTTP 路由取得 schema；用已锁定依赖 Ajv 2020 校验实际收到的请求／成功／错误信封及 summary／detail，不在测试中重造另一份 schema。验证含文档端点自身响应，连续正文、确认与受权活动查询，以及 401／400／404／422／409 错误。它使用 Fastify app.inject 与真实隔离 SQLite，**不是 TCP listener 或独立 Agent 黑盒调用**。
- 已读 `ws02-bc95f7d-final.tap`：20/20、无 fail／skip；诊断为 **186 次 schema 校验、9 种 detail type、35 份经 HTTP 路由取得并独立 hash 的文档**。JSON.parse(canonicalDocument) 与 document 用深相等比较，digest 对原字符串直接 SHA256；后续发布仍能取得既有旧精确版本。
- `ws02-bc95f7d-first.tap` 19/20 的原失败保留：测试向全新库错误要求 schema1，实际 404；最终改为保全本次真正取得的 schema2／guide1，而非制造新库旧文档。旧 schema1 保全另由真实旧文档合成 smoke 覆盖，不能拿这次修订宣称验证了不存在的旧版本。
- 已读 API 的 `outputs/ws02-real-perception/api-bc95f7d/document-upgrade-smoke.mjs`／`.log`，未执行：脚本在临时目录加载固定 e1fed24 的旧 catalog 实现，形成 42 份实际旧 guide／schema 行；使用新实现初始化后逐行 JSON 比较 document／digest／版本不变，新 schema2／guide2 与 revision 联动存在。另检查 A→B→A 原子拒绝与原回执保留。log 记 status:passed、42 行保全、无 listener／用户库。它是作者合成 smoke，非真实用户库验收；TD 所述 API 239 响应 smoke 不另转记为独审运行或独立 Agent 结果。

### 9.4 固定候选的补充工程验证

本 reviewer 只读以下 metadata 和对应现存日志；所读日志 SHA256 与 metadata 一致。测试、安装、监听与关闭均由相应作者／TD 执行。

| 证据 | 实际范围 |
| --- | --- |
| acceptance `outputs/ws02-real-perception/final-17e02f4/checks.json` | productionRawCommit 为 bc95f7d，testContentCommit 为 17e02f4。WS02 20/20 实际运行 HEAD 是 3a09678，metadata 明确该同字节测试随后提交为 17e02f4，并保存文件 SHA／退出证据，不伪称当时已在后继 HEAD。受影响 34/34、完整 CLI 12/12、typecheck／diffcheck 均实际 HEAD17e02f4，exitCode 0、无 skip；后两项空日志的退出码现在有 metadata，不从空文件自行推断 |
| TD `archive-validation-d12553a-20261019T170546Z/verification.json` | sourceCommit=d12553a，sourceIsGitArchive=true，286 个受跟踪文件核对由 TD 回执／metadata 记录。独立 npm ci --ignore-scripts、typecheck、WS02 20/20、affected-and-cli 合并 46/46、archive-startup 各 exitCode 0；已读 Node spec-reporter 的计数及相应日志 hash。计数为后处理现存日志，没有为报告格式另跑命令 |
| TD archive-startup 脚本／log | 在空私有库初始化 schema5／20 表，显式 seed68 个 seedObjects、重复 seed 计数不变，无 Agent 的初始化情景；检查 integrity、同一测试 identity 字节保持。使用自有 loopback port0 检查 health／实时 capabilities，以及四份 MD 和下载 CLI 的 HTTP 200、no-store、实际字节等于 archive 文件；finally 关闭 listener。不得把这个空库启动测试说成原用户数据迁移或原 Agent 流程通过 |

CLI 12/12 属下载客户端的作者工程验证；其扩展 manual 故事沿 R4 的有界 transport 探针方式，六尾探针各重启同私有 DB／identity 的自有 backend，不改记为一个持续进程完成全部探针。TD archive 验证增强了固定受跟踪产物的工程证据，仍不能替代原“小序”会话从公开入口开展的独立实际 HTTP 验收。

### 9.5 当前接受状态与未测范围

本固定组合的独立代码审查没有仍开放的编号发现；CR01—09、T01／T02 及公开合同补建按本报告各轮具体范围关闭。此前各失败／修订／定点与新同字节证据保留，不重写为历史全绿。

后续依既有授权继续固定产物的独立 Agent HTTP、原库一致备份／必要迁移、合 main 与本地交付；其实际完成与失败由对应执行者另记。本报告未操作服务或用户写入，不构成这些动作已经发生的证据。全量回归、真人账号提交、真实邮件、UI／移动端、其他端口及公网没有扩大；不清用户数据／缓存／存储，不回灌旧库，不把未测记通过。
