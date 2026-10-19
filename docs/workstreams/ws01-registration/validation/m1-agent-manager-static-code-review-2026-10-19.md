# 新版 Agent 管理 · 独立静态代码审查

日期：2026-10-19。Reviewer：`M1 后端独立代码审查`，threadId `01a13916-02fe-7e90-8881-972aba227d8d`。本轮仅维护此审查原件，后续修订、UI／测试与整合复核继续追加；此前世界／HUD 报告保留为历史。

**最新准确组合结论：base `fd4bf0d25623bcd281d893ad941b91e5cfbf89ee` → head `436c3a0bdea9148792955bec63c4e7fed73e2a74` 静态接受；相对已审 1471b81 仅四份公开接入文档变化，生产代码／脚本／测试完全相同。** AM-R02／03／04 静态关闭及 AM-D03 确认断链修订保持。作者 Chromium 6/6 仍归等价网页 6b0c968／固定测试 3f5f59b，作者原生三步预检仍归 1471b81／1200×959，不称为对 436c3a0 的重跑。QA 与正在进行的独立 R3 仍固定 1471b81，R3 实际结论待收，不扩大为整轮交付接受。旧 R2 阻断与 R2 1440／1024 布局证据按原轮次保留。各阶段证据与结论如下。

## 固定范围与执行边界

- base：`fd4bf0d25623bcd281d893ad941b91e5cfbf89ee`；head：`9899f01dbf38bbdc03322923290f7cb010363545`。已核对两笔直接提交链：4be9e6fb6da75394a448a08d4c627e57aacef7c2 → 9899f01d。
- 对象来源：`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-api` 的固定 Git 对象。全部增量为 m1-service.ts、foundation-operations.ts、profile-rules.ts、m1-agent.ts 四文件，101 行新增／17 行删除；必要调用方包括认证、目标授权、事务／回执、HTTP 装配、公开投影与 CLI 原操作执行。
- 依据：当前 WS01 功能原件第 2／3／3.1／5.1 节、owner-account-v2 的角色与访问设置、新管理合同 §2.3，以及本轮明确实施授权。文档仍保留的“仅规则／设计”历史状态不阻挡本次已授权实施；未定默认／范围、提议衔接等不得由设计示例推定为授权。
- 仅静态读取及编写本报告；未改实现、切分支、运行测试／构建／类型检查／CLI／浏览器、发送 HTTP、注册账号、发送邮件或操作数据库／迁移。未操作 8789、18892、原资料／identity／instance；作者所报静态检查不记作运行通过。

## 后端局部核对

| 项目 | 固定候选的静态结果 |
| --- | --- |
| 默认公开注册 | m1-service.ts:405–438 在原事务及 registration command 内建立原身份／凭据／绑定与默认公开资料、joined 成员、worldAccess 初值；默认名字和 basic 形象只由公共 Agent ID 派生，不导入私密历史。原 attempt／payload／continuation 校验及命令回执保持，重复续接不重新生成角色或覆盖后续资料。公开接口仍校验有效资料、joined、平台限制并只返回角色白名单。 |
| 直接保存与提议隔离 | 第 681–694 行以当前 published 为基底，仅合并明确 fields／removeFields，不以旧 draft 为公共基底；独立提议保持，不随直接部分保存被采用或删除。仅 draft 与原 published 相同时同步更新 draft；无内容变化返回 changed=false，不反复推进发布版本。proposalPending 是受保护 profile view 的内容差异，不进入匿名投影。 |
| 字段／主体权限 | 原 authenticate、target、expectedVersion 与 expectedPolicyVersion 均在新动作中保留。runtime 只可写自身；新 directSavePermission 拒绝非 agent_autonomous 的 runtime，原模式与提议入口未删改。runtime 明确设置或删除锁定字段均拒绝；businessWrite 仍区分 ownerPaused 与平台限制，主人不通过自己的保存越过平台限制。直接保存不改政策、锁或稳定身份。 |
| 退出／撤回边界 | directSavePermission 第 217 行拒绝非 joined；runtime 也不能凭直接保存恢复已撤回的公开角色。旧成员／提议／发布能力保持，未自动重入或批量公开旧私有记录。主人在 joined 且 published=null 时，明确保存可从安全默认资料构成有效公开角色；不携入旧未确认草稿。完整 UI 的旧 not_joined／left 恢复入口及提示尚未审查。 |
| 世界访问设置 | 第 638–655 行 owner_session 才能写，target 校验实际绑定；runtime 只能读自身，effectiveActions 明示 saveWorldAccess 不允许。间隔是正安全整数秒或 null，缺省旧记录只读投影为 version=1、intervalSeconds=null，不擅定 15 分钟。独立设置版本、冲突与 no-op 处理保留；没有新增调度、唤醒或宿主采用声明，capabilities 的 scheduling／perception 仍为 false。 |
| 公私隔离 | worldAccess 只加入受保护 ownerView／self 和鉴权读取；匿名 publicProfile:396–403 仍显式白名单，不返回间隔、draft、政策、主人邮箱或证明。新路由由 canonical operation 表进入原 HTTP 装配，没有另开无认证设置路径。 |
| 旧持久记录／保数 | 新设置嵌入原 agents JSON，update 合并原 data 并按行版本 CAS；未新增 SQL schema、批量迁移或重置逻辑。旧行缺 worldAccess 不触发数据库写入；修改设置不改 runtime 代次或覆盖原 agent 数据。当前未做真实数据迁移／保数运行验证。 |
| CLI 初始化与续接 | m1-agent.ts:179–229 在首次初始资料命令尚不存在时，要求服务端仍为 platform_default、profile／policy／published 版本均 1、autonomous、joined；主人编辑、政策或提议变化不会被新初始意图覆盖。命令先保存在原私密 state，已有 initialProfile 则只执行同一请求／查原回执，不按新版本重建正文；版本冲突、锁、暂停、限制保持未决原因，finally 刷新。旧 draft／publish／join 续接与手动控制路径保留；本包不把旧 CLI 草稿命令全部改称直接公开保存。 |

## 后续固定组合须补核

首包审查时尚无测试文件增量或测试通过回执；下列验证范围原样保留，补充覆盖见下一节，不能以静态结论预记未测场景 PASS：

- 注册事务失败／同次重试、公开 GET、旧记录未被强制公开，以及 direct save 的无变化／冲突／可选字段删除。
- pending proposal 与未提交锁字段不被直接保存带入；owner／runtime、模式、字段锁、暂停／平台限制、跨 Agent 和无认证矩阵。
- worldAccess 私有读写、独立版本、旧行默认、保存后持久化与运行凭据换发时数据保留；设置值不成为已调度／已采用事实。
- CLI 初始资料丢响应后主人修改，再续接原命令；原命令未提交／已提交、政策／提议改变均不重建或覆盖主人资料。
- 新 880px UI 切页／切 Agent、未保存、结果未知、旧未公开／退出状态及提议确认，与上述后端权限和事实对齐；完整注册／关联／恢复／运行文件原保护不因整合受损。

**本固定后端局部静态可接受；无实际修订阻断需派回作者。最终完整候选的代码、测试及 UI／集成新增差异仍须另行覆盖，当前不允许用此局部结论替代全版接受或本地交付验收。**

## 补充测试／fixture 与兼容证据：8ac8581

已解析固定 integration `8ac85818259a25a36b82845f30a260d556d3e0ef`，并逐项比较上述四个生产文件，与主审 9899f01d 完全一致。本节仅补审固定 tests/integration/agent-manager.test.ts（188 行）、scripts/agent-manager-qa-fixture.ts（121 行）与技术总监证据，不接受其中设计文件为已实现 UI，也不改变后端主审 SHA。

- **测试意义：**八条测试通过真实 buildApp／HTTP injection 调用生产实现，断言默认角色与注册精确回执、直接保存／删除／无变化／无效输入、两种非 autonomous 模式拒绝直接保存、提议与 owner 部分保存隔离、同值锁字段及删除拒绝、暂停与跨主体拒绝、丢响应后原回执／冲突隔离、私有间隔精确秒值／清除／无调度及 close/reopen 持久化、平台限制与历史 left／not_joined／撤回状态。测试从公共 GET 核对实际角色，排除仅返回“成功”却没有公开生效；历史恢复必须显式执行原能力，不自动采用旧提议。
- **覆盖限制：**这八条未运行参考 CLI 的初始资料／丢响应续接，也未挂新版 DOM 或模拟未知结果下导航。注册测试验证并发同次幂等与可见结果，没有通过故障注入覆盖事务每一步回滚。第 149 行的“不回填”检查对象是新建但尚未设置间隔的记录；真正缺 worldAccess 的旧行主要由已读默认逻辑与兼容副本证据补充，不能将其写成八条测试已逐项验证全部旧数据路径。
- **fixture 边界：**测试使用 mkdtemp、合成 identity 及独立内存／临时库，负面成员状态注入只用于隔离测试。独立 QA 生成器要求新建 0700 输出目录，以显式 experience 配置指向其自身新库／identity；通过真实注册／邀请／保存接口建立合成数据，私密请求与材料写入 0600 文件，stdout 仅列合成 ID。未见自动继承用户库、真实邮件密钥或改写原账号的路径；本 reviewer 未读取生成的 private fixture 内容。
- **收到的执行回执：**技术总监报告该固定版本 tests/integration/agent-manager.test.ts **8/8**。本 reviewer 只读断言与 fixture，未执行或复跑，未推定其他测试通过。
- **兼容预检证据：**已读 outputs/m1-agent-manager/qa-20261019T033745Z/compatibility-preflight/evidence.json 与 open-copy.mjs。记录表明原库一致副本以候选和旧 514 打开／ready／关闭后，schema4、14 表行数／指纹与 identity 保持，未启动监听或提交账号请求；另在含新 worldAccess JSON 的合成副本上用旧 514 打开后指纹保持。证据中的 API commit 7b9b88af 与主审三份后端文件内容相同，CLI 增量不在该开库预检中。此为技术总监产出的副本兼容记录，不是本人操作，也不是最终切换备份或新版写入／全流程回退验收。

**补核结论：后端局部静态接受保持，测试／fixture 增量未发现新的确定阻断。当前证据状态已由“未收到测试”更新为“收到作者 8/8 和兼容副本记录”，未扩大为本人运行验证、完整 UI 接受或整版交付通过。** 本次仅更新同一审查原件，未改实现／服务／数据库或发消息给其他执行会话。

## 整版 UI／测试组合复核：0602979

固定 base `fd4bf0d25623bcd281d893ad941b91e5cfbf89ee` → head `06029799a405e8cf6531e12cd728591f464c842a`；20 文件、1399 行新增／107 行删除。新增生产 UI 11 文件、286 行新增／89 行删除，与作者固定 `ce1e8d7ae608ab826166d66d062fed7e993b5dbe` 的 public 内容完全一致。后端四文件、API 测试和 fixture 与已读 8ac8581 一致；设计两文件与指定依据 `6a6879172ed19951ba40389bc5666719e1635e3c` 一致，不作为运行产品验收。

已读上述 11 个 public 文件的全部增量与必要调用方，以及新增 CLI 测试。原后端差异未重复重审；旧 HUD 接受不直接套用新管理工作区。

### AM-R01 [P1] 核心分组导航与固定动作栏未按管理布局呈现

**位置：**本 target `apps/web/public/owner-manager.css:7–17`、`owner-manager.js:10–17`；必要全局样式 site.css 的 nav 规则。

原模拟者在 1440×900 正常登录后的[固定候选截图](../../../../outputs/user-simulation/agent-manager-20261019/01-alpha-manager-overview.png)显示：左栏只有居中的当前对象块，分组导航不在可见区且产生横向滚条；主操作栏未按固定形态呈现。本 reviewer 只查看该已提供图像，未操作浏览器。

静态上 manager-sidebar 使用 nav 元素，局部样式未覆盖全局 `nav{display:flex;gap:25px;align-items:center}`，导航组继续横向排布，与设计的 176px 纵向组导航冲突。固定高度链与主区滚动／页脚的实际问题亦由同一截图揭示，不能仅因节点存在而记可用。核心页面与提交入口不可按可见设计完成，属于阻断。该项已由总指挥派技术总监／原 web 作者修订；本报告不重复代改。

### AM-R02 [P2] 保存权限／暂停修改在未知后刷新，正文丢失且无法导出退出

**位置：**`owner-manager-commands.js:3`；`owner.js:59–61,302–305,388–392,757–771,782–789`，动作入口为 `622,624`。

新管理白名单覆盖 saveProfile／saveWorldAccess／saveDraft／publishProfile／join，却遗漏新权限页的 profilePolicy 与 participation。两动作仍由 command 写入 pending，但 pendingInput 不保存它们的版本、mode／lockedFields 或 paused；正文只在内存 pendingPayload。

**静态触发：**主人保存字段控制（或确认暂停／恢复修改）后，请求未到服务器便断网，POST 与自动回执查询均无结果；刷新后 pending 还在，pendingPayload 已无。resume 只为白名单／特定认证动作重建正文；原 receipt 返回 404，checkResult 没有正文可重试，也不允许重建同一请求。与此同时 pendingExportable 对这两动作返回 false，保存进度退出入口隐藏，导航／新操作被锁。正常刷新、重开、继续确认或登录均不能使从未提交的原命令完成。

**影响：**完整管理权限页的日常操作可将该标签页卡在无法完成／导出退出的未知状态，不能要求用户清除受保护存储解决。虽然旧动作名称保留，这次新工作区与管理续接白名单仍须覆盖它们，不能以旧通过状态代替本合同的未知结果保护。

**建议：**将这两类管理命令加入明确的输入／固定路径／方法／回执结果白名单，提交前持久保存原版本与意图；刷新／导入后只续接同一 owner／Agent／operationId／正文。沿用认证失效、迟回、目标检查与导出保护，不从导入文件信任任意路径，不重新生成操作。定点验证“未提交断网→刷新→原回执 404→同一命令续交”和“已提交丢响应→原回执恢复”，并检查导出／同账号重新登录续接。

### AM-R03 [P2] 确认采用提议会静默清掉同页未保存的权限改动

**位置：**`owner.js:110–111,618,340–342,588–592`；`owner-manager.js:20,24` 的权限页与页脚组合。

**静态触发：**已有待确认提议的 Agent 进入权限控制，主人修改模式或字段锁但尚未点“保存资料控制”；`publish-profile` 仅按限制与提议完整性判断禁用，没有检查 policy-form dirty。主人点击“确认采用提议”，确认文案只授权替换当前对外资料，随后 publishProfile 按当前服务器版本提交。成功后 committed 对当前目标执行 loadAgents(resetProfile=true)，renderAgent 将 mode／locks 等全部表单重置为服务端旧政策并重新记基线，未保存的权限意图被清除，没有放弃修改提示。

**影响：**同页独立动作绕过未保存保护。确认采用资料提议不等于同意丢弃正在编辑的字段控制；后端权限仍以旧政策正确执行，但用户输入丢失且可能误以为新政策也已保存。

**建议：**采用提议前要求先保存或显式处理该页 dirty，或只更新本动作确认的资料并保留无关政策表单／基线；不得把提议确认当作默认放弃权限输入。同步检查历史恢复的独立动作是否有同类全表 reset。定点验证取消确认、确认采用后权限输入保留／明确放弃，以及无脏输入的正常采用。

## 组合测试与其余覆盖

- 新 CLI 测试直接下载并运行参考客户端，使用独立临时库与 loopback 动态端口、显式 experience 和空真实邮件配置。代理丢弃已提交的首次 profile 响应，检查同一命令／证明与回执续接；随后验证主人后改、首次读取前主人修改、首次读取后的版本竞争均不重建初始操作或覆盖主人资料。该新增单条测试有明确外部断言，补充了前节 CLI 覆盖空缺；不是将整个旧 CLI 测试组重跑。
- 技术总监报告 API **8/8** 与新增 CLI **1 条**通过，QA18892 的 **14 项只读 HTTP 就绪／101 源文件匹配**；本 reviewer 未执行、未把这些回执记为浏览器或完整 UI 通过。没有新增测试覆盖 AM-R02／03 的真实控制器／刷新／DOM 组合。
- 页脚复用原按钮并保留 form 关联，未重建认证表单或迁移凭据所有权；导航、切 Agent 与多数文件准备检查回到原 controller，提议采用保留显式确认。新管理输入、文件导入与结果检查使用固定动作／目标白名单，公开显示仍以已保存资料为源，名字／简介／提议通过 textContent 渲染。原认证／绑定／找回与运行文件保护未发现本次另有确定越权，但 AM-R02／03 的流程缺口仍阻断。

**整版最终结论：`06029799a405e8cf6531e12cd728591f464c842a` 暂不接受合入，待原作者修订 AM-R01／02／03 后由本 reviewer 对新的固定增量复核。** 本次只更新本轮同一原件，未改代码或运行测试／浏览器，未操作真实账号、邮件、服务或数据库；普通用户模拟和设计复验保持独立。

## 三项修订及 R2 组合复核：00ea9ac

固定作者增量 ce1e8d7 → `b5dc9c1064429f4e2d9ea805b93338cbd245475d`，6 文件、24 行新增／13 行删除；已核对其连续四笔修订。整合增量 `06029799a405e8cf6531e12cd728591f464c842a` → `00ea9ac6fe249f613f52daaafbcb01eff4e8d4fe` 的六个生产文件与作者对象完全一致，另有 12 行设计阻断记录，共 7 文件、36 行新增／13 行删除；没有其他整合生产差异。

- **AM-R01：**manager-sidebar 显式纵向 flex／stretch／gap=0，覆盖全局 nav 排布；管理网格补 minmax(0,1fr) 行、高度／宽度约束与零间距，子组不挤缩。静态上修订针对已定位原因。已实际查看原模拟者的 [R2 概览 1440 图](../../../../outputs/user-simulation/agent-manager-20261019/r2-01-alpha-overview-1440.png)与 [R2 资料页 1440 图](../../../../outputs/user-simulation/agent-manager-20261019/r2-02-profile-entry-1440.png)：左侧完整分组、当前对象、关闭和固定主操作区可见，原横向排布／页脚被裁切问题在这两张图中不再出现。图像来自原模拟者的 00ea9ac 运行记录，本 reviewer 只查看文件，没有浏览器操作；不扩大为 1024、全部页面、滚动后或保存流程通过。
- **真实资料入口：**去除概览的“查看个人面板示例”及对应 HUD 切换监听；保留当前 Agent 的真实预览／资料编辑页脚路径，继续由 requestNavigate → 原控制器保护。没有引入新示例身份或绕开目标检查。
- **AM-R02 静态关闭：**managerActions 已纳入 profilePolicy／participation；managerInput 校验正版本、原三种模式、唯一受支持字段锁或 boolean paused，并拒绝多余键。managerRequest 固定 owner 目标路径与 PUT；回执核对 owner scope、operationId、targetId、实际 mode／locks 或 ownerPaused 及版本。原 pendingInput／导出／parseOwnerBackup／resume 共用该白名单，刷新或导入后重建原正文和目标，不从文件取任意路径，不生成新 operationId。既有未知／认证失效保护保持；新增成功文案只在结果核对及重读后输出。
- **AM-R03 静态关闭：**采用提议及历史恢复在 controls 禁用和实际 handler 两层检查 dirty，并显示保存／明确放弃的提示；不会再未经处理执行独立动作后触发全表 reset。取消／保留输入与新导航确认逻辑保持，正常无 dirty 的原动作仍使用原固定目标与版本。

**本生产增量静态可接受，未发现新的确定阻断。** 本节不将待执行的五条控制器测试预记通过；待其固定提交／回执补核，独立用户与设计复验按实际证据范围收口。本次仅追加同一报告，未改实现或运行测试／浏览器／服务／数据库。

## R2 新运行阻断与静态跟踪：仍固定 00ea9ac

本节在上一节局部静态修订结论后追加；新运行结果使该候选的整轮接受继续阻断。已查看原模拟者提供的 [AM-D02 保存后图像](../../../../outputs/user-simulation/agent-manager-20261019/r2-03-profile-save-no-result.png)、[1024 布局图像](../../../../outputs/user-simulation/agent-manager-20261019/r2-04-profile-layout-1024.png)及 [AM-D03 离开确认图像](../../../../outputs/user-simulation/agent-manager-20261019/r2-05-dirty-page-confirm.png)。截图只证明所示状态；点击顺序、等待时间与结果由原模拟者报告，本 reviewer 未操作浏览器或自行记录事件／网络。

### AM-R04 [P1] 同页表单变更同步会卸下并重挂正在操作的主按钮

**位置：**固定对象的 `apps/web/public/owner-manager.js:17,29–35,46`、`owner-panel.js:36–47`，经 `home.js:13` 与 `owner.js:22,65–103,959` 连接。

`updateFooter()` 每次均把全部 primary 按钮 `stash.append(button)` 移进 `hidden=true` 的容器，再 `footer.replaceChildren(note)`，最后重新挂回当前页的原按钮。`show(page)` 对同一页也无条件执行该动作。表单的 `input`／`change` → onChange → notifyPresentation／controls → emitState → presentation.sync → manager.show 因此每次都会暂时卸下当前主按钮；没有页面切换也如此。保留同一个对象及 `form` 属性不能消除该 DOM 搬移。

**与实测的关系：**原模拟者报告 AM-D02：修改有效名字并清空可选兴趣后，鼠标单击可用的“保存资料”，等待约 10 秒仍无新反馈／公开资料或 HUD 变化，输入保留；此前 R1 先 Tab 到保存再点击曾成功。这两条路径应分别保留。鼠标从仍聚焦的编辑框按下按钮，会涉及输入框失焦产生的 change 同步，当前源码恰会在这条路径搬移目标按钮，存在破坏原生指针点击完成的明确风险。按钮搬移是本次已确认的源码事实；尚无原作者的事件／请求跟踪证明该风险是 AM-D02 的唯一原因，不能由这张事后截图推定没有请求或没有服务端提交。

**要求：**同页状态／校验更新必须保持当前可见 submitter 持续挂载，只在确有页面／确认视图切换时调整归属，或做不拆当前节点的页脚协调。继续保留原表单归属、禁用条件、目标／版本和 command 提交路径；不要用 pointerdown 直接写入或自动提交绕过正常确认。原作者须核对鼠标按下→blur／change→mouseup／click→submit→同一请求／回执链，连同 AM-D02 排除其他忙碌／网络／反馈原因。修订后由原模拟者从聚焦的有效输入框直接鼠标点击保存，核对公开资料、当前 HUD、输入状态与失败反馈；Tab 路径独立复验。新增控制器单测即使通过，也不代替此原生交互路径。

### AM-D03：明确放弃未导航，当前原因待定位

原模拟者报告：有未保存名字／清空兴趣时，点“世界访问”出现确认；“继续原任务”保留输入正常。再次进入确认并点“放弃修改并离开”后，仍回资料页且输入保留，未切到世界访问；正常点击“读取最新”也无新反馈。该结果继续阻断；所附确认截图本身未记录后续点击结果。

固定源码中 `navigateManager` 第 894–900 行只做一次 dirty 确认，成功且 `sameConfirmation` 仍有效后应 `renderAgent(true)` 重置表单／rememberForm，再 `presentation.navigate(next)`；没有发现再次递归检查同一脏基线的直接路径。`owner-panel.js:44,57–60` 的 finishConfirmation 理应先结束确认再 resolve。当前没有充分静态证据确定是确认未返回 true、快照因上下文变化被拒绝、事件／异常中断或其他原因，不新增未经证实的根因结论，也不建议移除 sameConfirmation 安全检查。原作者须在这个实际路径给出诊断与固定修订；“读取最新”是否同因须分别确认。

### 本轮收口状态

- AM-R01：新增 1024 图像中导航与固定主操作栏可见；原模拟者报告该可见性范围通过。与已读 1440 两图共同支持布局修复，不扩大为全部页面、焦点或动作通过。
- AM-R02／03：此前静态关闭保持；新增五条控制器测试尚未收到固定提交／执行回执，不预记通过。
- **00ea9ac 整轮暂不接受：AM-D02／03 未消除，AM-R04 需要原作者修订并复核新的固定差异。** 本次只更新本报告，未运行测试／浏览器／服务／账号／邮件／数据库操作，也未向其他会话发送消息。

## R2 交互修订提前增量复核：6b0c968

固定作者 base `b5dc9c1064429f4e2d9ea805b93338cbd245475d` → `02bd28053d10d1664fb0b44e8f345f1f97d7ca1b` → head `6b0c968417efe054a57d09ecec394f2849608a68`。已核对直接提交链和 m1-web clean；仅 `apps/web/public/owner-manager.js` 一文件，7 行新增／5 行删除；已读完整增量和必要的 manager／presentation／controller／markup 接线。固定差异的 `git diff --check` 无输出。本节尚非整合组合复核。

### AM-R04 静态关闭，AM-D02 仍待原生交互复验

`owner-manager.js:18,29–37,54` 新增 footerPage 缓存：同一 currentPage 的 input／change／controls／sync 只更新状态，不再移走并重挂当前按钮。实际切页仍将原 primary 放入根节点内的隐藏 stash，再挂当前页按钮；确认结束显式清空缓存，确保恢复相同页面时重新挂回操作区。原节点、form 关联、submit handler 及控制器的有效输入／权限／pending 禁用条件均保持，没有增加 pointerdown 提交或隐式保存。因此前节已确认的同页按钮搬移缺陷静态关闭；鼠标点击是否成功、是否只提交一次及公开／HUD 反馈仍须在固定组合原生复验，不由静态修订推定 AM-D02 已运行关闭。

资料页不再新造第二个刷新按钮；第 25 行把原 `#reload-profile` 移入标题区，只清除已空的旧 button-row。该节点仍在原 root 内，保留 `type=button`，原 `owner.js:874` 继续为它绑定 `refresh(false)`。没有残留第二条资料刷新入口，也没有新导航、表单提交或重置输入；refresh 保留输入、读取代次／busy／认证／pending 检查和结果反馈保持。records／invite 原刷新 callback 未改。

### AM-D03 原因补定位与修订静态接受

此前“尚未定位”结论在本次必要上下文跟踪后补充如下：旧 manager.confirm 直接 `footer.replaceChildren(...)`，会把当前页 primary 原控件移出 root，虽然 primary Map 仍持有对象。`owner-panel.js:60` 在 Promise executor 中设置 resolveConfirmation 及按钮 handler 后同步调用 onChange，沿 home → notifyPresentation → controls；资料页的 `owner.js:108` 无条件查询 `#save-profile`，此时返回 null 并在 `.disabled` 赋值处抛错，使确认 Promise 提前拒绝。之后点击“继续原任务”仍可关闭确认；点击“放弃修改并离开”即使 finishConfirmation 调用 resolve(true)，已拒绝的 Promise 也不能继续 `navigateManager` 的 reset／导航。这解释了为何静态上没有递归 dirty 检查，运行却回到原输入；此处是固定源码推导，未声称本人执行或记录浏览器异常。

第 53 行修订在替换页脚前，将其中的 primary 移入仍属于 root 的 stash；控制器查询因此保持有效。确认期间仍保留 resolveConfirmation／manager.confirming 与 interactionLocked；结束时先恢复原按钮和界面，再 controls 并 resolve。取消不重置输入；同意后仍由原 controller 执行 sameConfirmation，再 renderAgent(true)／rememberForm 和原导航，没有删除目标、会话或读取代次校验。该断链的修订静态可接受。

已沿 primary 的 profile／appearance／world-access／policy／runtime／invite／security 七个原节点检查保存、暂停／恢复、采用提议、历史恢复、撤销运行访问、文件准备和退出确认相关引用：新逻辑仅改变显示归属，七节点在普通页、确认页和结束阶段均继续保存在 root 中；未替换原 listener／form ID，也未触碰文件准备对象、凭据、pending 正文或回执续接。appearance／policy／world-access 的 dirty 离开确认同样受此保留逻辑覆盖。runtime／invite 准备及保存确认、账户／认证等原页面内容仍保存在 pages／content；没有从确认结果自动签发、发放或越过原确认条件。本增量未发现其他新的确定阻断。

**本作者固定增量静态接受；AM-R04 静态关闭，AM-D03 静态原因与修订已覆盖。** 原 AM-D03 中“读取最新无反馈”是否完全由同次异常状态造成，仍不能仅凭该修订推定；须与明确放弃路径分别验证。限定六例控制器测试正在由 acceptance 执行的消息只记待收证据，尚未读固定测试 diff／执行回执；作者鼠标预检、固定组合和独立 R3 也未到，不记任何运行 PASS。本次只修改本审查原件，未运行测试／浏览器／服务／账户／邮件／数据库，未发消息给其他会话。

## 限定六例真实浏览器测试补核：3f5f59b

固定提交 `3f5f59b7795e4d68860ea49a3a6deb3718e94dd2` 相对 parent `dcc3478d8db98f8c158f8fb3de0a5e8296968726` 仅增加 `tests/e2e/agent-manager-regressions.node.ts`，211 行，无生产修改；已逐行读新增源码及其必要 fixture／private helper。该固定对象全部 `apps/web/public` 与已审作者 `6b0c968` 相同，后端四份主审文件与 `9899f01d` 相同；固定差异的 diff --check 无输出。acceptance 工作树另有原交接文档编辑，本 reviewer 只读其作者执行说明，未修改或混入该固定测试提交。

### 测试实际覆盖

1. **AM-R02 四例：**profilePolicy、participation 各测请求未提交与已提交丢响应。通过真实网页登录／管理入口及真实生产 controller 发 PUT，浏览器 route 仅在指定命令和回执处注入故障；提交前从 sessionStorage 核对完整原意图／operationId／owner scope／Agent，直接读生产 API 证明两种故障的实际提交差异。刷新后检查原正文、未达请求的原回执 404；从可见按钮下载进度并明确退出，正常重登获得不同 session，再从可见入口导入。未提交动作确认续交，已提交动作取原回执；断言原目标／正文／键不变、提交次数分别为 2／1、新 session 未被旧文件替换、最终业务状态和回执相符，并出现 success 反馈。
2. **AM-R03 一例：**建立真实 proposal_required 提议后，从权限页修改 mode／bio 锁，核对采用按钮禁用及提示；取消离开保留输入且未发布；明确放弃后重新进权限页，核对旧 mode／锁已恢复。再分别取消、确认采用，断言只有一次发布，公开资料实际更新且政策没有顺带变更。此例同时覆盖权限页的确认 Promise、取消与放弃路径；没有把资料页→世界访问或“读取最新”单独作为断言。
3. **AM-D02 一例：**真实登录进入资料页，fixture 原有非空兴趣；修改名字并清空兴趣后，不先 Tab／blur 或 dispatch DOM click，以保存按钮真实 boundingBox 调用 page.mouse.click。核对实际 PUT 200 且只发一次、正文包含删除兴趣，匿名 API 为同一 Agent／新名字／原 blue 形象且兴趣字段已删除，管理对象栏与表单显示新内容，owner／session 保持。该例明确覆盖本次指针路径；没有断言全局底部 HUD／地图姓名或页面刷新按钮。

### 执行证据与范围

已读作者实际 [最终 TAP 日志](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/m1-agent-manager/ui-regressions-6b0c968.tap)：6 tests、pass 6、fail/cancelled/skipped/todo 均为 0，总时长约 8.05 秒。作者回执及其交接说明为网页 6b0c968、上述 API 基准运行该固定测试，临时服务／浏览器已关闭，没有重跑旧套件。TAP 本身没有内嵌源码 SHA，版本关联依据作者回执与本次固定对象的内容比对，不声称由日志单独证明资源字节，也不声称本人执行。

旧 first／second／third 与 participation diagnostic／footer-fix 日志保留。已读 [确认页失败诊断](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/m1-agent-manager/ui-participation-footer-fix.tap)：真实 participation 确认进入 owner-panel Promise executor 后，owner.js:110 的 disabled 查询抛 TypeError，未发 PUT。这为前节“原按钮移除导致确认断链”的源码推导增加作者运行证据；它是修订前失败，不能抹为原版本通过，也不能声称本人捕获。

每例用生产 buildApp、独立随机 loopback、真实 Chromium／1440×900 context 和每次新建的 0700 临时数据库／identity 目录；显式 experience 配置不读取用户服务或真实邮件配置，未指定伪时钟。合成账号／邀请／Agent 由真实 API 预置，之后 UI 主路径经过正常登录和控件；fixture/password／private helper 采取私密文件及不落密码检查，测试 after 中关闭浏览器和 app 并删除其自行生成的临时目录。pageerror、非预期 console／网络／HTTP 错误及私密 URL 受监测，原错误不会被静默忽略；没有更改生产容错、真实账号、用户资料或既有 QA 环境。源码具备清理逻辑且作者声明完成清理，本 reviewer 未另查运行进程。

**测试增量静态接受；作者限定真实浏览器 6/6 证据已补齐。** AM-R02／03／04 的本次补核未发现新阻断。该套件不替代完整布局、资料页放弃到世界访问、资料刷新反馈、全局 HUD、作者正常鼠标三步预检或独立 R3。固定整合组合与后续实际验收仍按各自证据收口；本次只更新同一报告，未执行测试或操作浏览器／服务／数据库，也未向其他会话发送消息。

## 准确整合组合收敛：1471b81

固定 base `fd4bf0d25623bcd281d893ad941b91e5cfbf89ee` → head `1471b8132496f275df31dfa2f4afb1dc57277b4b`，全差异 21 文件、1635 行新增／107 行删除；已核对 integration 实际目录、clean 和直接提交链。相对此前组合 `00ea9ac6fe249f613f52daaafbcb01eff4e8d4fe` 只有以下两个文件，共 218 行新增／5 行删除：

| 准确整合差异 | 已审来源及比对结果 |
| --- | --- |
| `apps/web/public/owner-manager.js`，整合两笔 b716bec → 1946703 | 内容与作者 head `6b0c968417efe054a57d09ecec394f2849608a68` 完全一致。全部 public 文件亦与该作者对象一致，没有额外整合实现差异。 |
| `tests/e2e/agent-manager-regressions.node.ts`，整合 1471b81 | 内容与固定作者测试 `3f5f59b7795e4d68860ea49a3a6deb3718e94dd2` 完全一致。 |

后端四份主审文件仍与 `9899f01d` 完全一致；API 测试、CLI 测试及 fixture 与此前已审 0602979 没有变化。原 00ea9ac 的其他生产／设计差异保持，整合没有新增未覆盖的生产变更。base→1471b81 的 diff --check 无输出。

**该准确组合的静态及测试源码审查接受，未发现新的确定阻断。** AM-R02／03／04 的静态关闭收敛至此 head；AM-D03 的确认断链修订也已在此组合覆盖。上述作者 Chromium 6/6 发生于等价网页／后端与固定测试源，作为已核对的既有执行证据；没有由本 reviewer 或作者对 1471b81 重跑的回执，不改写为新一轮测试通过。

总指挥提供 QA18892／PID92640／source-1471b81 的运行定位，仅登记为提供的资源信息，本 reviewer 没有访问该服务或核查 PID。作者正常鼠标三步预检及随后独立 R3 尚无通过回执；资料页→世界访问、读取最新、全局 HUD 及本轮完整桌面闭环仍按实际复验范围收口。公开 `docs/access/v1` 原主流程正在由实际负责人定向修订，尚不在本 head 的新增差异内，须待新的准确 head 另补文档审查；不预接受未提交文本，也不因仅文档追加而冒称代码测试重新运行。本次仍只更新本报告，未改实现、运行测试／浏览器／HTTP／服务／账号／邮件／数据库或向其他会话发送消息。

## 作者原生三步预检回执补记：1471b81

总指挥转交原 web 作者实际回执：固定 1471b81／隔离18892，TaskSpace50，实际 viewport **1200×959**。作者对合成乙单次鼠标保存简介成功且公开展示同步；脏兴趣“继续编辑”保留、明确放弃还原并切到世界访问；访问间隔单次保存为 **120 秒**。合成甲没有提交修改。该空间已退出并 finish。以上仅登记作者转交回执，本 reviewer 未读取该空间事件／截图或执行浏览器，不将其改记为本人或独立模拟者通过，也不据此声称读取最新／全局 HUD／所有页面已完整覆盖。

独立原模拟者 R3 已正式开始，1440 主闭环结论尚未收到。R2 既有 1024 图像及对应可见性结果保留原轮次，不写为 1471b81 重新测试。准确组合静态接受保持；最终收口仍待独立 R3 实际结论与最后接入文档的固定差异。

## 公开接入文档固定增量复核：436c3a0

固定 `1471b8132496f275df31dfa2f4afb1dc57277b4b` → `436c3a0bdea9148792955bec63c4e7fed73e2a74`，直接 parent 链；仅 `docs/access/v1/{entry,http-api,local-setup,prompt}.md` 四份，53 行新增／34 行删除。已读全部增量与必要上下文，并与已实现 API／CLI 及规范操作表静态比对。integration clean；增量 diff --check 无输出。apps、scripts、tests 无差异，不新增代码运行结论。

**原 WS01 稿来源核对：**已读主目录 `outputs/ws01-access-sync-20261019.patch` 的固定来源／范围与原文件 SHA256；四个原哈希与 1471b81 的相应 Git 对象逐一一致。acceptance 纯文档提交 8d56a16 与 436c3a0 的这四个最终对象完全相同；未代作者应用 patch 或修改文档。代码语义依据仍为先前已审 API 4be9e6f 与 CLI 9899f01，436c3a0 的生产内容保持相同。

| 核对主题 | 固定文档与源码对应结论 |
| --- | --- |
| 默认公开与能力探测 | 普通流程改为注册即获得默认公开角色及 joined、读取当前角色后按授权直接保存，不再将 publish／join 设为新注册必做步骤；platform_default 不等于主人确认。先核对真实 capabilities／operations，不凭公开文档推断实例已更新，对应 m1-service 的 defaultPublicRole、profileSave、worldAccessPreference 与实际默认注册事务。 |
| 普通 saveProfile | 正确列出 canonical PUT、runtime／owner session、expectedVersion＋expectedPolicyVersion 及各自 agent／owner 回执 scope。以当前 published 为基底，省略保留、仅显式删除 bio／interests、不采用或删除独立提议；无变化与实际变化、publishedVersion、saveEffect 的说明符合实现。两类调用者均须 joined，runtime 另须公开版本、自主模式及未锁字段；目标、暂停与平台限制仍由原权限检查。role_not_public 不触发自动发布／重入或重注册。 |
| 提议与旧显式操作 | saveDraft 不自动公开，非自主 runtime 不能通过 saveProfile 绕过主人确认；publish／unpublish／join／leave 仅按明确权限处理，撤回、退出和撤销运行访问未混为一项。未授予 Agent 人类账号／恢复权限，没有以“注册即公开”批量公开旧草稿或恢复旧成员状态。 |
| 世界访问偏好 | GET 限自身 runtime 或绑定 owner session，PUT 限绑定 owner session；action／路径／scope 与 foundation-operations 一致。初始 version=1／null，显式 null 清空或正安全整数秒；expectedVersion 取独立偏好版本，变化递增、no-op 保持并各记回执。说明私有、主人目标及平台限制、自身 runtime 无写权；不替未定默认／范围／未来 Agent 自调权限定案，不将 null 解释为停止工具。排程／感知／互动仍 false，不承诺唤醒、执行或本地采用。 |
| 参考 CLI 边界 | initialize 只对尚未改动的平台默认资料准备 initialProfile／saveProfile，旧 draft／publish／join commands 与 pending 仍续原操作；后改或显式管理不被初始意图覆盖。显式 profile-update／profile-clear 正确标成 saveDraft，只改草稿；普通直接保存另用 HTTP。未虚构 world-access CLI 命令或总结字段。原完整键／正文／预存证明、manualControl 及未知结果不能换请求的边界保持。 |
| 原 URL 与秘密／续接保护 | site-routes 仍从这四份原件提供 `/agent/entry.md`、`http-api.md`、`local-setup.md`、`prompt.md`，下载 CLI 与 `/owner#handoff`／assistance 原入口不变。保留可信同源／HTTPS、秘密先保存复读、scope＋action＋operationId 精确续接、结果未知不重建身份、不泄露秘密或索取主人凭据／邮箱验证码、体验不冒充真实邮箱验证等要求。 |

**文档增量静态接受，未发现阻断；完整准确组合静态结论收敛至 436c3a0。** 此次仅文档追加，不要求也不声称浏览器／六例测试已重新运行。作者三步 TaskSpace50 的既有通过只归其 1471b81 实际范围，独立 R3 仍在 1471b81 上进行；本 reviewer 未接管或访问 QA18892。待原模拟者实际结论后，按同代码与文档差异的真实证据归属最终收口。本次只更新本独立报告，未改接入原件或实现，未运行浏览器／测试／服务／HTTP／数据库，也未给总指挥或其他会话另发消息。
