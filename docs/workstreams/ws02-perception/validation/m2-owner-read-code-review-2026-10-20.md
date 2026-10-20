# WS02 主人只读与真实 HUD 接线独立代码审查

**当前最终结论：接受 `a46d81d → adae355`（生产 d6118ad＋测试 adae355），OWN-CR01—03 关闭，详[第 5 节](#5-r2-固定修订4f788aa--d6118ad)／[第 6 节](#6-r3-最终测试增量与固定组合接受)；下方保留初审历史及各轮独立证据范围。**

2026-10-20。稳定 reviewer：「M1 后端独立代码审查」`01a13916-02fe-7e90-8881-972aba227d8d`。本批新差异不继承原 `878a0cab → d12553a` R5 的通过状态。

## 1. 固定范围与结论

**暂不接受本批固定候选；新增三项发现：OWN-CR01（P1）、OWN-CR02／03（P2）。** 均是固定源码推导，尚未由 reviewer 实际浏览器／HTTP 复现。原作者修订后须给出固定增量，由原 reviewer 复核；独立 acceptance 作者定点另记，不能用本报告代替 UI 验收。

- base：`a46d81df85cd1b1a55775fe54281124f8bfbe34e`。
- 最初组合：A `d5b03405aec8b67d501410d9de887b6aa7237700`＋B `0ce8a39f64fdb1d4dce7be43470256014477b9ea` → `86528274a9175c3a02beba2c8c81c238c4827244`。
- 本报告最终 target：`4f788aab84d9faccfef46e0111bae68382be1d19`，纳入 B 后继 `a462b389f1f2887d6b808d6a81c4501ddc7d97e9`。相对 8652827 仅 platform-content 与 world-read-provider 两文件 6 行新增／5 行删除，含关窗取消／inactive 不自动读详情。
- 最终累计差异 17 路径、697 行新增／51 行删除；固定累计 `git diff --check` 退出 0。后端／脚本／WS02 测试限定路径与 A 相同，web 限定路径与 B 后继相同，比较均退出 0。没有读取浮动工作树实现来扩大 target。

依据主目录最新架构、开发规范、登记，以及 [WS02 差距交接](../development/m2-owner-read-gap-2026-10-20.md)、[WS07 最小设计](../design/m2-owner-data-ui-minimal-design-2026-10-20.md)；HTTP seam 另核对 integration `outputs/ws02-owner-read/implementation-contract-v1.md`。owner 私有读取须逐请求核实当前绑定及来源分层授权；真实／示例分离，人类只读不改 Agent 确认。

本次只读 Git 对象、上述文档、固定测试源和普通工程日志；未执行项目 JS／测试／构建／typecheck／CLI，未运行浏览器、HTTP、服务或数据库，未读真实 DB／identity／私密 fixture／token。没有操作 8789、其他端口或公网，只写本报告并保留其余主树改动。下面行号均为最终 target 4f788aa。

## 2. 新增发现

### OWN-CR01 · P1 · 私有详情失权后仅删除当前行，其他失权缓存仍可见

位置：`apps/web/public/hud/features/platform-content.js:149–155`，尤其第 153 行；`apps/web/public/hud/world-read-provider.js:116`；背包同类调用在 platform-content 第 78 行。会话控制器 `apps/web/public/owner.js:981–986` 只在 401 时触发会话清理，403／404 不改变当前 observationRevision。

触发：主人已载入该 Agent 的通知列表。来源随后撤销整项 owner observation policy，或当前 owner／Agent 绑定撤销，但浏览器原会话仍有效。用户打开任一缓存通知，后端以 404 target_not_accessible 拒绝正文；前端将其归为 denied，关闭详情后只执行 provider.remove(key, record)。remove 仅过滤当前 ref，其余旧 records 原样保留，并标 partial。没有重新检查当前绑定或该私有列表的可观察范围。

影响：通知窗口仍展示同一失权范围内其他旧标题／来源，可能一直保留到用户手动重新打开整个窗口。一个拒绝不能证明只有该 ref 失权；本合同刻意不区分单条不可读与整体绑定／来源撤销，客户端不能由安全 404 推断其他缓存仍获准。背包路径还可能在删除当前行后自动选下一行、再次发出已失权的详情请求，而非先停止该私有范围。

最小修订：私有详情遇到权限／范围拒绝时，先停止并清掉当前私有范围的可见列表、计数与详情，取消后续自动细读；通过新的当前绑定／来源授权与列表读取重新建立可见范围，不能只删一条后继续展示旧集合。若实际只是正文层减少，可在新列表确认 summary 仍获准后恢复“仅摘要”，不能凭旧缓存判断。

必要验证：已载入多条通知／持有后分别撤销绑定和来源 policy，点击一条触发拒绝，断言其余私有标题／详情立即不再显示、没有自动逐项细读或 fixture 回退；明确重新读取后才显示仍获准的摘要／持有。正常 401、切 Agent 及其他主人迟回应另保持隔离，Agent 未确认数不变。

### OWN-CR02 · P2 · 摘要后正文更新会进入无法恢复的“重试旧版本”循环

位置：`apps/web/public/hud/world-read-provider.js:103–108`；`apps/web/public/hud/features/platform-content.js:47`、`:69–78`、`:149–153`。后端首次 detail 的现行语义见 `apps/platform/application/perception-service.ts:193–197`：knownVersion 只校验格式，初次正文返回当前版本，续段才锁同版本链。

触发：列表摘要为 v1，来源在用户点开前已合法发布 v2。provider.detail 将 expectedVersion 初始化为 record.version=1，第 107 行在收到合法 v2 首段时抛 content_changed。详情显示“重试”，回调仍 read(selected)／read(opened)，使用同一个旧 record.version，再次要求 v1；prepare 的目录／说明读取不会更新这个摘要 ref 的内容版本，因此反复拒绝同一个正常 v2 响应。

影响：通知、公开物品、公告／事件在普通并发修订后无法通过详情内的重试恢复，只能另行关闭／重开整个列表。它不是同版本续段被混入新版本的安全拒绝；初次详情本来就允许新于列表切点。

最小修订：区分首段建立版本与后续分段连续性。可按当前有权的首段版本建立新的完整正文读取基线，或先重读该 ref／列表摘要后再发起详情；其余分段仍严格锁住同一 ref／版本／读取会话。content_changed 后必须丢弃旧分段并从当前版本重新决定，重试不能再次固定旧 record.version。

必要验证：真实列表 v1→合法来源更新 v2→首次详情／重试，能够取得且仅显示完整 v2；链中途 v2→v3 必须丢弃旧链并安全恢复，不能混拼。持有引用物品与直接目录两入口都覆盖，不调用 Agent 确认。

### OWN-CR03 · P2 · 续页过期后重试仍发送同一失效 token，范围变化也被误作永久无权

位置：`apps/web/public/hud/world-read-provider.js:7–13`、`:80–97`；`apps/web/public/hud/features/platform-content.js:30–38`。服务端默认页寿命与错误见 `perception-service.ts:18／99`。

触发：主人通知 31 条、前端每页 20 条，首屏读取后停留超过默认五分钟再点“继续载入”。服务端返回 410 page_expired。readPhase 把它当普通 error；more 失败分支保留 previous.records 和 previous.nextPageToken。页脚“重试”按 Boolean(nextPageToken) 再调用 load(key,{more:true})，仍发送已过期 token，之后每次重试都失败。另一个常见失效 409 read_scope_changed 被直接归为 denied，清空后显示“当前账号无权”，又没有重新建立当前枚举的操作；这不等同已证明永久失权。

影响：服务端明确要求重启本次列表枚举的恢复协议没有接到 UI。已授权读者遇到正常页寿命或内容／范围切点变化后，只能猜测关闭重开窗口，界面提供的重试不能完成任务。

最小修订：为 page_expired／read_scope_changed 建立显式枚举失效恢复路径，作废原 nextPageToken 和旧选集，允许用户按原合法选择从无 token 首页重新读取；先重验权限，真正 401／403 的清理边界保留。不要把旧页失败当成功空集、不要无限后台重试，也不要以同一过期 token 充作重试。

必要验证：首屏→隔离时钟越过页 TTL／受控实际页失效→继续载入失败→界面重新读取后完成当前 31 条且无重复／跳项；同一已授权主体的 read_scope_changed 可重新建立当前范围，真正失权则不恢复旧内容。记录部分／完整状态并保持来源标记。

## 3. 本次静态核对中成立的边界

- `readActor` 对 owner inventory／inbox 要求顶层 profiles.agent@1 的 agentRef，并查当前 active 绑定；runtime 不接受指定他人 Agent，world 拒绝 agentRef。会话与 token 指纹包含实际 owner、所选 Agent、绑定行版本／数据、来源 policy／状态；续页和正文重验当前条件，重绑不能复活旧续读权限。
- inbox 权限来自独立来源声明，不由 demo 标志或管理绑定推导。声明核对 sourceId／reference／administrator、冻结的 31 个 registered seed ref 和 current_bound_owner audience；存在／摘要／正文／附件分层检查。Agent-only 新 ref 不因同 source／demo 自动加入；owner 响应不返回 agentReadState／completionToken，不能确认 Agent 消息。
- holdings 返回当前有效关系、数量、状态；未获物品公开读取时降为一般持有记录且不发 itemRef／物品标题，物品正文另按 world 检查。当前测试覆盖这一后端投影；它不免除前端缓存再验证的 OWN-CR01。
- 新声明 helper 是本机显式操作，没有 HTTP capability；精确 operator／source-administrator／operationId、schema5 和 DB／identity 只读配对预检先于可写打开。不 reseed，不改 object／grant／state；已有 inactive policy 不复活，原消息版本／正文、不可读 message-6、撤销投递保持。回执、来源声明和管理员事实同事务，按原键原载荷幂等。
- owner list／detail 的审计 actor 明确为 owner_session，状态 human_data_provided、agentId:null，不记成 Agent 自主读取或确认；响应和人类准备事实同事务。记录不保存正文或凭据。
- catalog 升 schema3 时保留旧 schema2／guide2 文档及 digest，另建 guide+1 和新目录／Skill revision；旧已冻结 descriptor 不按新常量重造，更高 schemaVersion 拒绝降级。固定测试中的旧文档是显式合成 R03 形状，不是对原用户库的迁移实测。
- controller 持有凭据，HUD 只得到受约束 readPerception 回调；实际请求固定 human-inspect 和受控类别，浏览器没有 Agent runtime。observationRevision 随会话／所选对象变化，provider 清上下文、取消在途并忽略迟回；common api 将 AbortSignal 传给 fetch。
- 平台物品／持有／通知／公告／事件与主动“查看界面示例”入口分离，不在错误分支填 fixture。真实面没有人类已读／未读、隐藏／删除／撤销或 Agent 确认按钮；示例保留原独立本地交互。计划／演示发生／真实管理员发布按来源标识，不由画布动画凑事件。
- 8652827→4f788aa 的后继增加 provider.cancel 和取消后拒绝新 invoke，feature deactivate 调用取消，inactive inventory 不自动开启首条详情；这一窄增量静态成立。没有把它扩大为所有关窗／切换／错误组合已实测。世界 HUD 仍 shut 内容窗回动态画布，告示牌只加公开公告／事件入口，未改动画／镜头／暂停逻辑。

## 4. 测试源、作者回执与尚未验收的范围

固定候选含 A 的 `tests/ws02/owner-observation.test.ts` 八组新增测试：31 通知／14 持有和 Agent 27 状态不变；绑定／demo 不授权；跨人类／Agent／consumer、撤绑重绑与 policy 屏障；各层投影；helper 幂等／保全／真实 SQL 事实写失败回滚；CLI 配对预检；旧目录保全／高版本拒绝；实际 owner 信封的 Ajv schema3 校验。原 public-contract 三处版本断言随 schema3 更新，未删原校验流程。其 fixture 是隔离 SQLite＋Fastify app.inject，不能记为普通用户浏览器验收。

TD 送审回执称 A typecheck＋WS02 28/28、B 九项 JS 语法与 provider 合成分页／分段／迟回／403 检查；本 reviewer 未运行这些检查。另只读 integration `outputs/ws02-owner-read/integration-focused-4f788aa.log`，日志末段为 80/80、无 skip；未在本轮核对该日志的完整 command／执行源 metadata，不据文件名将其等同本固定 UI 定点矩阵，更不据此关闭上述三个前端路径。

独立 acceptance 作者的组合候选 desktop 定点测试此时尚未进入该 fixed diff，后继测试提交另审。没有把作者自查、后端 28/28、旧普通 UI 或旧小序 R02／R03 通过当本批新前端通过；也没有读取模拟者报告来替其作 UI 结论。

本次未产生用户 DB／identity／服务／8789 的验证或交付回执；不清缓存／存储、不 reset、不回灌旧库。修复三个发现后给出精确新生产／测试 diff 和匹配证据，再复核；桌面之外的手机、全量回归、真实邮件、其他端口、公网与 push 不扩大。

## 5. R2 固定修订：4f788aa → d6118ad

2026-10-20。**OWN-CR01—03 的原指定问题在本固定增量静态关闭；未发现新增阻断。接受累计 `a46d81df85cd1b1a55775fe54281124f8bfbe34e → d6118adaa9b3972a89881a5cb9ac8273d9d68c1b` 的当前生产代码独审范围。** 独立 acceptance 的新测试提交尚未纳入该 target，待其固定 diff 另审；不提前记七个浏览器故事／三个 provider 检查通过，也不把生产独审写成已部署或整批 UI 验收通过。

### 5.1 固定对象

- 本轮 base：`4f788aab84d9faccfef46e0111bae68382be1d19`；target：`d6118adaa9b3972a89881a5cb9ac8273d9d68c1b`，合入原 B 修订 `8e9e463354d3154d0fbc881029d3b13c0a9830c9`。
- 仅 `platform-content.js`／`world-read-provider.js` 两路径，30 行新增／16 行删除；最终 web 限定路径与原 B 修订相同，比较退出 0；累计 base a46d81d→target 的 `git diff --check` 退出 0。后端、声明 helper、schema／catalog 和本报告 R1 已核对的测试源没有新增差异。
- 仍只读 Git 对象及普通材料，不执行测试、浏览器、HTTP、服务、CLI 或数据库，不读私密 fixture／identity／真实库，只追加本报告。

### 5.2 原发现复核

以下行号均为 d6118ad。

| 编号 | 修订及静态结论 |
| --- | --- |
| OWN-CR01 私有拒绝后残留其他缓存 | provider `:118–129` 统一承接 detail 与 list 的拒绝；私有 denied／session／resync 清 holdings＋notifications（session 清全部面），丢 records／token，递增各自 epoch 并取消在途 list。`:85／93` 和 `:103–108` 验当前 epoch，较晚返回的旧 list／detail 不可回填或继续旧正文链。platform-content `:115／166` 收到空集合后清选择、详情／附加窗；不再执行逐行 remove 或自动选择下一失权行。公开范围保留原独立状态。**原问题静态关闭** |
| OWN-CR02 旧摘要版本重试循环 | provider 第 9 行将 content_changed 归 resync，经 reject 清旧集合／选中／正文上下文；UI 第 `32／35` 行显示“内容已变化，请重新载入当前列表”与“重新载入”。空集合的反馈回调重新 load(key)，不是 read(旧 record)；新 list 的 summary.version 才成为下一次详情版本基线。链中途变化也不复用旧片段。**原问题静态关闭**；未改为盲接任意不同版本 |
| OWN-CR03 续页失效不能恢复 | page_expired／read_scope_changed 同样归 resync，不走保留 old nextPageToken 的普通 partial 分支；reject 用 blank 清 records／页 token。用户明确重新载入时走无 token 首页，不再反复重放过期 token，也不把 read_scope_changed 一概显示为永久无权；真正 denied／session 清理仍保留。**原问题静态关闭** |

原 4f788aa 的三个错误轨迹保留在本报告前文，不重写为当时已经修好。新实现以 provider 状态失效作为统一入口，UI 的迟回／细读取消仍配合自身 generation；不靠 fixture、增加授权、Agent 确认或后台轮询实现恢复。

### 5.3 其他执行者回执与待补证据

TD 新转达的 independent acceptance 基线在 4f788aa 实际复现 **0/3**：旧 summary 重试卡住、过期页重试卡住、撤销观察后 20 条旧行仅删到 19 条。它独立支持原三个问题；本 reviewer 没有运行或代写该浏览器结果，具体测试源／日志待固定后审。B 提供合成恢复与拒绝迟回检查的回执，也不替代 independent browser 结果。

TD 另报 4f788aa 的 typecheck、80 项 WS02／site／CLI（无 skip）、九项 JS 语法；以及在原库只读副本上试演 ready→来源声明→同键重放→ready：除 catalog／access 外 18 表 hash 不变、56 个旧 catalog row 除 current 外保持、旧文档／digest 与配对 identity 保持、31 声明。这里只按 TD 的**副本工程回执**归属，不转作本 reviewer 数据库操作、真实原库迁移或 8789 已切换的证据；没有读取该副本的私密内容。

截至本节，新的七个 browser 故事和三个 provider 检查正在 d6118ad 上运行，尚无已送审测试提交及本 reviewer 读取的最终结果；保留待补，不预写通过。新测试代码与若有后续生产差异必须按各自固定增量复核。独立普通 UI 继续单独验收，不阻塞用户已授权工程；本报告不新增人类登录／阅读批准或其他人为门槛。

## 6. R3 最终测试增量与固定组合接受

2026-10-20。**接受累计固定 `a46d81df85cd1b1a55775fe54281124f8bfbe34e → adae355cd2922883b46b27659aa7da09b34882e8` 的本批独立代码审查；组合为生产 d6118ad＋测试 adae355。OWN-CR01—03 在原指定范围关闭，测试增量未发现新增阻断，当前没有未结编号发现。** 普通独立 UI、原库 fresh 备份／切换和 8789 实际交付仍由相应执行者另记；本结论不预写这些动作已经完成，不新增人类批准门槛。

### 6.1 固定增量与证据匹配

- target `adae355cd2922883b46b27659aa7da09b34882e8` 的 parent 是 `d6118adaa9b3972a89881a5cb9ac8273d9d68c1b`。仅新增 `tests/site/owner-platform-read.test.ts`（123 行）、`tests/e2e/ws02-owner-read.node.ts`（261 行）、`tests/e2e/helpers/ws02-owner-read-fixture.ts`（134 行），合计 518 行，无生产更改。
- 限定 apps／scripts／docs／package.json／package-lock.json 与 d6118ad 比较退出 0；累计 a46d81d→adae355 的 `git diff --check` 退出 0。
- 已读 acceptance `outputs/ws02-owner-read/candidate-d6118ad/verification.json`。executionHead 为 d6118ad，productionCandidate 同一提交，apiRaw=d5b0340、webRaw=8e9e463；testCommit 为后续 adae355。三个 Git 对象测试文件的 SHA256 均与该 metadata 的 executedTestFilesMatchCommittedBytes／testFiles 对应，不伪称执行时已在后继测试 HEAD。
- 所读 focused-final.log 的 SHA256 为 `b917fd5331ead38cc253c80d5b78229c2ee00b21f89e9f69fe0ea5a886fa5960`，typecheck-final.log 为 `29258ce800cefea054659d07ce9d6e79377a9c84d3dde528c3b78053a8e5bb8b`，与 metadata 一致。typecheck 日志是 npm→tsc --noEmit，退出 0 来自 metadata；本 reviewer 没有执行它们。

### 6.2 测试真实性、隔离与清理

七个 browser 故事调用真实 app.listen 的自有 127.0.0.1／port0 服务，加载实际网页与脚本。每故事使用新建 synthetic SQLite、配对 identity、新注册的 owner／Agent 以及全新 headless browser context；底层 `privateDirectory` 0700、证明 fixture 0600，不持久化密码，不复用用户 profile、QA 库、固定端口或用户凭据。运行使用 Node v24.16.0 和 metadata 指定的 Chrome for Testing chromium-1243 独立 headless binary，不是操作现有用户浏览器会话。

新 helper 先在此隔离库中显式 seed／声明 owner observation，再通过受审管理 helper 写入随机、该库独有的物品／通知／公告／计划标题及长通知正文。UI 浏览器记录自己的请求／响应；与 reference 集合的比较经过正常 owner API，reference 使用 app.inject，**UI 的内容成功路径本身是真实浏览器 HTTP**。独有标记可区分服务数据与静态 fixture；长通知实际跨多个服务分段，最终正文逐字匹配，不以成功 API 替身填 UI。

受控 page.route 仅在声明的故障／迟回故事中：延迟 route.fetch 得到的真实响应；中止网络；将 M1 结果查询改为 503，配合未提交的资料保存请求制造结果未知。没有用合成 200 列表／正文冒充成功读取；源停用、观察撤销、空持有及页过期通过该故事自己的隔离库变更成立，未修改用户库／系统时钟。指针／滚轮工具先核对可见及视口边界，再 native mouse／wheel；读取 scrollTop 只用于断言，不注入滚动位置或 force 点击。

基础 fixture 在注册 cleanup 后才监听，finally 链关闭自有 browser、app 并仅删除自身 mkdtemp 目录；每个临时 openM1Store 均在 finally close。延迟响应测试的 finally 释放 deferred、解除 route，响应读取 Promise 在 hook 中收敛；没有留下固定端口 listener。未启用 trace／视频／截图，也没有把 fixture 的 token 放 URL。新 helper 的结束断言覆盖浏览器未使用 runtime、未调用 agent-read-state／reader-state，以及 owner 成功响应没有 Agent 进度／完成凭据。以上是测试源与 metadata 的静态／作者证据核对，不是本 reviewer 执行清理。

三个 provider 检查直接 import **生产 createWorldReadProvider**，只模拟受限 controller transport／session 边界，检查 partial 与 denied／no-Agent、关窗取消／旧主体迟回、同版本分段与换版本／主体拒绝；不把它们计作额外真实 HTTP 权限测试。权限判断另由前述后端源测试与 browser 实际服务验证。每个 provider 在 finally dispose。

### 6.3 作者最终结果与保留的失败历史

| 证据／范围 | 本次核对结论 |
| --- | --- |
| focused-final.log＋verification.json | 同次 10/10、fail 0、skip 0；其中 **7 个 browser 故事＋3 个生产 provider 检查**。命令 node --test --test-concurrency=1 指向两个固定测试入口，typecheck exit0；不是全量回归 |
| 正常 owner 数据 | 实际 14 个持有关系、31 个获准通知（30 正文可读＋1 仅摘要），列表 ID 与 reference 对齐；独有标题／长正文由 UI HTTP 呈现，分段同版本。读取前后测试 fixture 的 perception_states 全表相同；本 browser fixture 未先建立“27”场景，不能把这一断言改称浏览器验证了原小序 27。27 的保全仍归原 A API 测试及 TD 副本回执 |
| 桌面公开／状态／世界 | 1440×900 与 1280×800 定点；无 Agent 的 owner 可看公开目录／公告／事件，明确 demo／计划／发生／平台发布；真实无权／未启用／不可用／空／网络错误不自动装入示例。显式示例往返独立；切 Agent／换账号／关窗的真实迟回不回填，画布自有角色动画、镜头／暂停偏好及 M1 dirty／unknown 命令保持。仅承认源码断言覆盖的组合，不扩张为桌面全矩阵 |
| 原三个发现的实际恢复 | 最后三个 browser 故事分别验证旧摘要后新版本→明确重载当前摘要→正确新正文；过期续页→重载请求无旧 token→继续取得31条；撤观察后单条拒绝→整组旧私有标题清空。原 4f788aa 的 review-baseline.log 0/3 保留，不重写为通过；d6118ad 对应三项最终恢复 3/3 |
| 初跑与测试修订 | candidate-4f788aa/desktop-first.log 2/4 的原失败保留；最终恢复 demo-items 为 enabled 后才单独注入网络失败，并对 M1 World 检查保留 dirty 输入而非要求必有离开弹窗。candidate-d6118ad/focused-first.log 9/10 的默认首条详情在途与管理员更新竞态保留；最终先等已读完、选另一条，再更新目标并点击旧摘要，确保实际触发所审恢复路径。最终仍要求重载、v3 knownVersion 和逐字新正文，未把旧失败行为改为接受 |

本次没有执行上述测试或操作真实 DB／identity／服务。作者专门 acceptance 与普通独立 UI 模拟分别归属；7＋3 通过不等于总指挥后续普通 UI 任务已通过。新差异未改变生产 d6118ad 的静态接受，后续若修改任何生产／测试代码仍按固定增量复核。

全量回归、手机、真实邮件、真人账号写入、其他端口、公网／push 与调度未扩大。原服务未由本 reviewer 切换，原库／缓存／存储未清除，未回灌旧备份；实际 fresh 备份、来源声明和本地交付结果等待 TD 正式回执。
