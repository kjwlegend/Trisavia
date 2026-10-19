# M2 演示背包／信箱／动态世界 · 独立代码审查

2026-10-19（Asia/Shanghai）。Reviewer：`M1 后端独立代码审查`，threadId `01a13916-02fe-7e90-8881-972aba227d8d`。本原件只记录本轮固定代码与后继复核，不代改 WS02 业务、WS07 设计或作者实现。

**当前准确代码结论：固定 `cdd2c30aa80ea44776ab0f342742b75f815bc510` 及纯交接文档后继 `0028b2676292284d062de4c43c45e6343890961e` 静态接受，未见剩余确定代码阻断；CR01／02／03静态关闭保持。** 已核作者等价源码同次四故事4/4、无skip日志，执行归作者而非本 reviewer。新版独立普通用户／WS07最后定点仍待回执，尚不记合main／8789交付或全量通过。以下失败及各阶段结论按历史保留。

**第一候选结论：固定 `84cbee5e24f78a8e96ccddf1f4570c76f2c99aff` 暂不接受；发现两项 P2，待原作者修订后复核。** 未运行测试或浏览器，不把源码存在、作者验证或旧管理 V2 PASS 当成本轮用户验收。

**整合补核：固定 `7a0321bf292521086e381bb4b90b102720a0596a` 的16份生产前端与84cbee5完全一致，M2-CR01／02保持open；新增fixture／状态测试源码静态可接受，未据此关闭原问题。** 作者另报进入演示后页面下滚、背包上沿移出视口，修订固定头与实际复验待收，不记作本 reviewer 运行发现。

**最新增量：固定 `54189c7d608ba100768462e595ad692ad33371ef` 的HUD滚动锚定CSS静态可接受；原M2-CR01／02仍未修，并新增M2-CR03测试fixture／断言冲突。组合仍暂不接受，未收到完整新增浏览器执行结果。** 共享QA仍是旧7a0321b，不作为54189c7运行证据。

**后继修订：固定 `f0ae1342a1a99ed4dd578c4314c3431271aead55` 的CR01／02修订静态接受，两项静态关闭；CR03测试冲突仍open，整版接受及实际几何／交互结果尚未收口。** 原候选失败状态和范围按历史保留，不把静态关闭写成本 reviewer 运行验证。

## 固定范围

- base `6cdb47fc02d9901b15b4a1384684e2d1cbf18424` → head `84cbee5e24f78a8e96ccddf1f4570c76f2c99aff`；只读 `/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-web` 的 Git 对象，16份前端文件、521行新增／86行删除，diff --check 无输出。没有以工作树后续状态代替此固定内容，也未切换／编辑作者 worktree。
- 已读全部增量及必要调用方：上下文投影、演示 provider／fixtures、local-state／view-model、背包、信箱、附加详情、shell、世界控件、布局／CSS、safe-area，以及原 scene-renderer、transition、M1 任务保护等。
- 依据 WS07 设计合同 v0.4 第0节；已核对主目录原件 SHA256 `19cd9a33cb7c13f3b4409a8575985bedb0c0df408ff8d56c2c74eacd7997cd40`。真实 M2 后端仍未实施，规划不作为本轮已实现能力。
- 仅静态读对象并写本报告；未运行 JS／typecheck／测试／浏览器／HTTP／服务／账号／邮件／数据库，未操作8789或其他QA。整合、acceptance fixture／typecheck 修订及后续实际桌面证据尚不在本固定差异内。

## M2-CR01 [P2] 详情内重新标为未读后，未读列表不会补回该通知

**固定位置：**`apps/web/public/hud/features/mail.js:36–45,56,67–71`，核心为第44行 patchRows。

**触发：**进入示例信箱，筛选“未读”，打开一条可读通知（如 message-1）。正文成功打开会 markRead，随后 patchRows 把不再符合未读筛选的原行删除。用户仍在详情中点“标为未读”时，状态已正确改回未读，但 patchRows 仅遍历现有 DOM 行并更新／删除，没有按新的 projection 插入缺失行或清理旧空态。关闭详情又只调用 patchRows，该通知仍不在可见列表，直到用户切换筛选或发生完整 render；触发行焦点也无法恢复。

**影响：**正常的“打开未读→手动标未读→关闭”路径显示错误列表，最后一行时还可能继续显示“没有符合条件的通知”，与保存状态不一致，违背手动阅读态与原列表返回约定。此为固定源码路径推导，未冒称本人浏览器复现。

**最小修订：**在不重建／缩放列表宿主的前提下，把行集合与完整新 projection 协调，补回恢复符合筛选的通知并移除过期空态；保留排序、标签、筛选、滚动和焦点规则。定点核对未读列表中间项／最后一项的自动已读、详情手动未读及关闭后结果；不可用或失败正文仍不自动已读。

## M2-CR02 [P2] 正常刷新会取消尚未持久化的最后一批滚动位置

**固定位置：**`apps/web/public/hud/features/inventory.js:10–12,57`、`features/mail.js:13–17,107`、`shell.js:49`。

**触发：**演示背包网格／物品详情或信箱列表滚动后，在100ms防抖写入触发前立即正常刷新。shell 的非BFCache pagehide 直接调用 feature.dispose；背包 dispose 取消 scrollTimer／detailTimer，信箱 dispose 取消 scrollTimer，均没有先提交已经捕获的待保存位置。只在 deactivate 等路径保存不足以覆盖直接刷新；信箱关闭详情能提交正文位置，不补列表位置。

**影响：**本次合法滚动仍只在定时器闭包中，localStorage 保留旧位置，重新进入后恢复较旧状态。此问题范围是最后100ms的待保存位置，不是说所有刷新或已读／隐藏记录都丢失；仍违反本轮明确的正常刷新保持约定。

**最小修订：**在 pagehide／dispose 失效 lease 与取消计时器前，刷出仍属于原有效上下文的待保存位置；使用已捕获的 lease／位置或可验证仍挂载的当前视图，不把旧位置改写到新主人／Agent，也不在隐藏／已移除 DOM 上盲读0覆盖记录。定点核对滚动后立即刷新、普通关闭重开，以及范围切换后旧回调不能写入新范围。

## 其余已覆盖及限制

- **隔离／秘密：**scope 由公开 capabilities 的实际 instanceId 与控制器 authenticatedOwner／授权选中 Agent 投影构成，访客有独立浏览器标识；key 包含 origin、主体、Agent、sourceId／sourceVersion，私人／公开 channel 分开。未验证时 scope=null，范围变更提升 revision、清旧列表／详情／撤销，lease 拒绝迟回写新范围。存储只序列化演示标记、引用及界面位置；没有保存密码／邮箱／token／管理链接／真实正文，不清理他人存储。当前 source 是相同公共示例集合，不能把该实现当真实收件授权。
- **持久化／删除：**格式与scope重验、字段白名单和有界引用、存储失败提示、source版本匹配及不存在引用 reconcile 已读；删除只加本范围 hiddenIds，原source未改。撤销保存原阅读态及绝对 expiresAt；连续删除按最后一次延长，刷新后按剩余时限判断，不重新计10秒；不解除示例待处理或推进Agent进度。M2-CR01／02以外的这些路径未发现确定阻断，但尚无本人运行证据。
- **详情与世界：**单附加详情 host、底层列表 inert／pointer-events／aria-hidden、详情＋HUD Tab循环、Esc与来源返回、轮滚阻止穿透、行尾事件不触发行打开均已静态跟踪。世界按钮关闭内容与详情、保留M1表单／pending续接而不退出或提交，未创建静态世界窗；原镜头／场所／探索／暂停节点与监听复用，动画和自有Agent绑定代码未被替换。减少动态／暂停依旧由原renderer控制；新safe-area纳入详情／工具／撤销提示。
- **布局／未测：**六列、64／40px图槽、288px右详情、独立滚动、880px信箱和680px详情及安全区CSS已读；实际1440×900／1280×800几何、焦点、原生按键／事件、动画持续性、刷新／重登／跨主体隔离与迟回需独立桌面证据，未记PASS。手机、真实M2服务、真实注册／邮件／生产写、全量回归均不在本次审查执行范围。

**下一步：**两项反馈回原web作者；只复核修订后的固定增量及随后准确整合／测试差异。原作者与独立模拟者各自验证，不用本报告静态覆盖替代用户闭环。

## 7a0321b 的 fixture／测试增量补核

固定84cbee5→`7a0321bf292521086e381bb4b90b102720a0596a` 共5文件、970行新增／6行删除：两份代码与三份技术／设计文档。实际 `git diff --quiet ... -- apps/web/public` 退出0，生产源没有变化；新增两份代码及必要依赖已全部读取，增量diff --check无输出。三份文档不在本次追加的代码审查结论内，技术评估／设计接受仍归原负责人及其独立审查。

- `scripts/agent-manager-qa-fixture.ts`：仅将参数取值逐项收窄并显式return fail，以及把动态buildApp结果绑定到局部activeApp，再传inject／close；没有改变参数允许集、错误拒绝、新0700目录、0600私密输出、显式独立experience库／identity、fixture业务流程或finally关闭。此为既有typecheck问题的最小修订，静态未见新增运行／数据风险；本 reviewer 未执行typecheck或fixture。
- `tests/site/hud-local-state.test.ts`：新增246行、7条状态层定点测试，实际导入生产store／context bridge／provider；用内存storage、session测试替身、注入时钟和fetch／延迟Promise核对重建恢复、origin／instance／owner／Agent／source与访客隔离、旧lease拒绝、异常存储降级、数据不变／秘密不被投影、绝对撤销期限、原阅读态恢复和引用reconcile。断言包括不调用clear／remove、保留无关存储和scope返回后不复活旧generation，具有对应的状态外部结果。
- **覆盖边界：**该7条没有挂载真实mail／inventory DOM，不验证patchRows补行、pagehide防抖刷出、浏览器scroll/focus、尺寸或动画；session输入是测试替身，不等于运行验证真实主人认证。没有收到本固定测试的执行日志，本 reviewer也未运行，不预记通过。M2-CR01／02不因这些测试源码而关闭。

**追加结论：两份新增代码静态接受，无新增确定缺陷；准确组合7a0321b仍因原两项P2未修订而暂不接受。** 作者报告的约227px页面下滚另待固定修订及原作者／独立模拟者证据；不读取未提交修改冒充已审。全程未操作QA／浏览器／服务／真实用户或数据库。

## 54189c7 的CSS与七份浏览器测试增量

固定7a0321b→`54189c7d608ba100768462e595ad692ad33371ef`；运行代码仅hud.css两行新增／一行删除，与作者96743e2完全一致，mail／inventory／shell等JS未变。七份测试与acceptance1d212c5完全一致：entry.spec、helpers/hud-ui、helpers/ws02-hud-fixture、hud-demo.spec、hud.spec、world-viewport.spec、ws02-hud.node；已读全部增量及必要依赖。其余12份是既有负责人审查的规划文档，本节不重复其业务／架构审查。固定diff --check无输出。

**CSS局部静态接受：**仅在`.hud-root`增加`overflow-anchor:none`，将HUD子树排除页面滚动锚定；没有给html／body禁滚、没有调用scrollTo复位、没有隐藏溢出或取消焦点样式／语义。该属性不替代焦点可见性处理；实际进入演示是否仍下滚、内部滚动与键盘聚焦在目标尺寸是否正确，须新版本实际证据，不能拿旧QA或单一CSS推断通过。

### M2-CR03 [P2] 长列fixture增加21条待处理项，却断言筛选结果只有1条

**固定位置：**`tests/e2e/ws02-hud.node.ts:68–75,149–163`。longExamples以`data.messages[1]`（原message-2，status为待处理且available=true）复制20条scroll-message，未覆盖status。mail故事在打开／手动未读循环后，这20条仍未读，加原message-2共21条符合“未读＋待处理”；第159行开启待处理后，第160行却断言所有`[data-message-open]`只有1个，后续又对该集合press Enter并期望变空／恢复唯一行。即使CR01／02产品修复、执行到此处，仍会因fixture与断言矛盾失败，不能将此失败归产品筛选。

**修订：**明确长列表辅助条目的业务状态；若唯一待处理路径旨在使用原message-2，可把新增滚动样本设为仅供知晓，并保留唯一项／自动移行／手动恢复／焦点和空态断言。不要简单放宽为“至少一条”或跳过该段，掩盖真正的筛选与补行检查。本 reviewer 未运行该失败场景，这是固定fixture与筛选逻辑的静态推导。

**其他测试与隔离：**新ws02Fixture使用每例新0700临时目录、独立experience库／identity、随机loopback和真实buildApp／Chromium，不继承用户或共享QA；账号样本由真实合成API建立，秘密仅私密文件／内存并监测URL泄露，after嵌套finally关闭自有浏览器、app并删除自建目录。新4条浏览器故事从真实控件操作，公开示例route只加长虚构内容，不改认证／业务响应；检查两尺寸几何、原生wheel、详情惯性／焦点／读删／撤销、刷新／主体隔离、M1脏输入与原未知命令、动态自有角色与相机／暂停／减少动态。读取DOM、公开场景状态及scroll事件探针不直接改产品状态，也没有force点击、改CSS或强制页面回顶绕过演示下滚。CR01新增中间／末项／唯一项补回断言具有针对性；CR02在滚动后检查不足100ms再请求刷新，但真实pagehide与定时器先后仍应结合实际结果判断，不能仅凭测试文字认定已覆盖。

旧spec增量主要适配世界无窗返回、菜单中的原控件、单附加详情和新版示例标识／筛选；没有删去不可读正文、无来源动作、无未授权发送／业务写入、相机保持等核心断言。hud.spec的避让由“仅在右侧留白”改为上下或左右任一不相交，符合底部HUD布局。旧spec仍保留基线的个人演示等前提，不据几处入口适配宣布全部遗留套件通过；也不将这些旧前提列为本轮新增产品缺陷。

**结论：CSS与新helper隔离未见确定阻断；七文件测试增量除M2-CR03外未发现新的确定缺陷。54189c7仍待CR01／02产品修订、CR03测试修正及实际定点结果。** 总指挥转报WS07已复现CR01，支持原finding；本 reviewer未读取其现场原件或冒领运行。作者完整新增测试未跑完，未记录任何通过率；没有访问旧7a QA或运行测试／浏览器／HTTP／服务／账号／DB。

## f0ae134：CR01／02固定修订复核

固定54189c7→`f0ae1342a1a99ed4dd578c4314c3431271aead55`，4文件、54行新增／29行删除；已读完整增量及必要新调用链，diff --check无输出。三份生产JS对应原web dcabff6＋f85d152修订，public内容与f85d152一致；测试一行HTMLElement收窄对应ce888c6。未审未提交内容，未访问仍固定旧7a的QA。

- **M2-CR01静态关闭。**mail.js:44–70把createRow／updateRow／emptyList分离，按完整projection保留仍可见行、移除过期行／空态、按来源顺序插入缺行，再更新选中／阅读态并恢复当前滚动。未读中打开后自动移行，详情手动未读可重新插回中间／末项；唯一项恢复时旧空态及“显示全部”也被移除。父list／宿主不重建，仍由原关闭回调恢复保存位置与原行／邻行／标题焦点。行open／read／delete现从当前view重新取entry及index，并检查原lease／channel，避免补行后的旧索引／旧阅读态；行尾stopPropagation保持。自动已读、不可读／失败不自动标记及详情只读源边界没有改动。
- **M2-CR02静态关闭。**inventory.js:10–15和mail.js:13–20显式保存pending位置及捕获时的lease，邮件另保留channel／messageId。flush先取出并清空pending，再用原lease写入；普通可见视图记位才读取DOM，隐藏／失效视图不盲写0。shell.js:22–28以初始noop避免同步订阅读取尚未初始化features，再在store.setContext提升revision之前flush旧范围；pagehide无论是否BFCache先flush，dispose在store失效前也flush。范围提升后各feature取消计时并清pending；旧回调若晚到仍受store.isCurrent(key＋revision)拒绝，回到同scope也不复活旧generation，没有把旧top换成新lease写到新主体。直接刷新前不足100ms的原反例因而有明确提交路径。
- **新增差异：**ws02-hud.node.ts:128用`node instanceof HTMLElement && node.inert`收窄，不降低原本应为true的inert断言。没有其他测试语义变化；CR03的长待处理fixture／唯一项断言冲突保持，不能预记修复。

**本修订生产增量静态接受，未发现新的确定阻断；CR01／02仅静态关闭，CR03仍待原acceptance修订。** 作者转报7条状态测试、typecheck、diff检查通过仅记作者回执，本 reviewer未读本固定版完整浏览器执行报告也未执行。页面下滚／尺寸、补行／焦点、立即刷新及范围切换等原生交互仍待固定新候选的作者和独立模拟者实际证据；当前不给整轮运行或最终合入接受。

## e31b785：CR03与其余测试增量复核

固定f0ae134→`e31b78558c7c082f46153ebb9f4173c7c9eda649`，仅`tests/e2e/ws02-hud.node.ts`一文件、22行新增／5行删除，与作者74c9adf最终文件相同；完整增量已读，diff --check无输出。对apps／scripts／package.json／lock的diff --quiet实际退出0，生产字节未变，CR01／02静态关闭范围保持。

- **CR03静态关闭：**longExamples的20条长通知显式覆盖status为“仅供知晓”，原message-2仍是唯一可用待处理项。原唯一项计数、打开移行、手动未读补回、空态消除及焦点断言均保留，没有改成宽松计数或跳过逻辑，原fixture／断言矛盾已闭合。
- **演示入口鼠标路径：**等待原面板open后，读取并断言入口完整位于viewport，再以page.mouse.click其真实中心点击；没有force、回顶、样式／滚动／业务状态注入。它移除了locator.click隐式scrollIntoView这一测试驱动附加步骤，仍以进入示例及后续shellFits实测几何断言结果，点击若被遮挡或产品自身跳页不会自动被修正。不能据此单独推定原生Tab／focus路径无问题，这些路径仍需相应证据。
- **其余增量：**shellFits只对可缺席的诊断节点输出present:false，窗口安全区与关闭／溢出断言不变；Agent切换用只读MutationObserver记录真实可见标签变为受控fixture另一名字的时间，替代“整段切换并返回后才计时”，仍要求实际变化在100ms内。没有人为改时钟、调用控制器切状态或放宽为任意时长，隔离／旧scope恢复断言保持；计时能否可靠触达目标窗口取决于实际执行，未预记成功。

**该固定测试增量静态接受，无新增确定缺陷；CR03仅静态关闭。** 总指挥提供作者4故事当前2/4、另两条仍诊断的进度，不能写成完整通过；本 reviewer未运行测试／浏览器或查QA。QA已由技术总监转报固定f0ae134，生产等价不等于该服务运行了e31测试或四故事通过。完整实际结果及原独立用户／设计复验仍按固定版本与实际范围收口。

## 4820a8e：临时列表收缩与测试入口定点复核

固定e31b785→`4820a8e7b37d02cc156ae2e7f991c001504b0fbf`，3文件、18行新增／7行删除；全部增量与必要调用链已读，diff --check无输出。生产mail.js与作者c30d676相同，两测试与作者a39fb64相同。其他生产内容未变；未读工作树未提交修订或操作共享QA。

- **mail局部静态接受：**第16–18／65行在详情打开、底层list不可交互期间不从临时缩短后的DOM重记列表位置，也不将其scroll事件当用户操作；patchRows取原范围已保存top。原openMessage在打开前仍flush／记下真实位置，完整projection补回末行后可恢复原高top；最终列表仍较短时由浏览器按范围钳制。详情关闭后的正常列表滚动继续捕获，channel／lease、pending刷出、正文位置、原焦点恢复与rowAction冒泡保护保持。该逻辑针对作者报告的1636→1564问题，未改读／隐藏／撤销或业务状态；数值报告归作者，不冒领本人复现。
- **登录helper：**等待真实面板open、断言按钮纵向可见，以boundingBox中心原生鼠标点击，之后仍等待真实登录POST 200、管理可见／busy解除及同ownerId。没有force、scrollTo、密码／session注入或认证成功mock。横向若不可点击仍会缺失真实成功响应而失败，未用该改动宣称登录全矩阵通过。
- **邮件测试：**新增before／afterRead／afterUnread／afterClose范围、焦点及仅演示命名空间中的private滚动数值诊断；不读认证vault、真实正文或打印存储key。来源顺序、恢复原行焦点、返回位置误差小于3px的原有效标准保持，既未人为恢复scrollTop，也未按已观察到的错误放宽误差。

**固定4820a8e静态接受，无新增实质问题；原CR01／02／03静态关闭保持。** 类型检查通过只记作者回执，四条浏览器故事仍在本固定组合复验，未收完整通过报告；共享QA仍f0ae134，两位实测者旧候选的中间／最后行补回证据不覆盖本次新增7行mail差异。该差异及新候选几何／原生交互须按后续定点实际回执收口。本 reviewer未运行测试、浏览器、HTTP、服务或数据库。

## 6948788：主动返回世界滚入画布

固定4820a8e→`69487888f6ca8887454e1bac3aafec3edd99b37e`，仅shell.js一行替换（1增／1删），与作者3de1234相同，diff --check无输出。已读goWorld、唯一HUD世界按钮调用、shut、M1接线及原场所关闭上下文。

**局部静态接受：**shell.js:37在用户主动世界点击的原hud:open→shut(false)→worldState之后，对既有`#world-layout`执行scrollIntoView（start／nearest／instant），随后仍focus世界按钮且preventScroll。goWorld未暴露为状态订阅回调，其他worldState、context／session更新不调用此滚动，不锁定说明页滚动或反复回顶。原内容／详情transition退场与记位保持；M1沿原shut收起而不清表单、vault、pending或文件准备，未新增提交／取消／切目标，重开仍走原owner／resume保护，不冒称此处新增了dirty确认。新行不调用scene相机／zoom／fit／reset／暂停或媒体偏好，instant也未引入平滑滚动；原动画／当前Agent与场所关闭语义保持。

WS07转报的VR02是从了解与接入下滚后返回世界仍在底部、背包top=-412；作者转报修订后top=88且camera／zoom不变，均归相应实际执行者，本 reviewer未运行或读取现场原件。本单行针对该入口缺口，**准确6948788静态接受，无新增确定问题**；VR02是否fixed/verified及新版mail／四故事结果仍须新QA定点回执，旧候选证据不替代。没有操作浏览器、测试、HTTP、服务、真实用户或数据库。

## cdd2c30／0028b26：最终测试增量与作者运行证据

固定6948788→`cdd2c30aa80ea44776ab0f342742b75f815bc510`仅ws02-hud.node.ts，80行新增／24行删除；104行完整差异已读，diff --check无输出，与作者b161165的最终文件相同。生产public与原web3de1234精确相同。`0028b2676292284d062de4c43c45e6343890961e`相对cdd2c30只追加原作者交接10行，已读；apps／scripts／tests／package.json／lock的diff --quiet退出0。进一步比对作者b161165的整棵代码／测试树，唯一差异是其shell.js仍少世界滚入一行；该生产文件以3de1234为准，已匹配0028。排除这一个生产文件后其余代码／测试／依赖diff --quiet退出0。因此准确绑定的是“生产3de1234＋测试b161165”组合，不是b161165单独的完整生产树。

**测试增量静态接受，无新增finding。**pointer对完整可见边界先断言，再真实mouse.click；hoverReadingRegion只移动鼠标，revealByWheel在原内部滚动区用最多16次真实滚轮并断言scrollTop实际改变，不直接设置top或调用scrollIntoView／force。未达目标会失败，遮挡导致动作未完成也仍受原业务／页面断言检查。邮件读删／刷新改走上述真实可见控件，原唯一待处理、原顺序／焦点、位置误差<3px及原键续接等有效标准保持，并增加后台document scrollY应为0的断言。DOM读取、scroll／MutationObserver及scrollend只记测试证据，不改产品状态。

VR02新增实际路径为：1280×800等待真实相机尺寸稳定→原更多菜单“了解与接入”→确认页面下滚>200→在说明区域真实wheel，等待scrollend并确认仍在下部→可见HUD世界按钮→断言document为0、world-layout.y=0、内容／详情隐藏、相机x/y/scale误差<0.001、当前Agent与暂停状态不变→主动进入背包并检查共享安全区、标题／关闭可达。这里的归零只能由生产世界按钮产生，没有测试scrollTo、reset或强制滚动掩盖原缺口。

**作者执行证据已读：**原交接「WS02 HUD作者定点验证·3de1234」及acceptance的[最终TAP](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-hud/browser-3de1234-four-stories-final.tap)。明确生产3de1234＋测试b161165，Node24.16.0／既定Chromium，命令`node --test --test-reporter=tap tests/e2e/ws02-hud.node.ts`，同次4 tests／pass4／fail、cancelled、skipped、todo均0，19.341秒。实际诊断：中间项982保持；末项1629→临时clamp1564→未读／关闭恢复1629且原行聚焦；说明页737→wheel后617→世界0。每例自有随机loopback／新合成库和context，原helper隔离／清理已静态覆盖；本 reviewer未复查进程或重跑，不把日志单独当运行资源指纹。

另已读[纯状态7/7原日志](/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-acceptance/outputs/ws02-hud/local-state-373ee44.tap)：原测试9c06222／生产373ee44，保留其旧基准，不能拼成最终UI同版重跑。交接的tsc --noEmit exit0只记作者回执；旧spec、手机、全量、真实邮件／模型回复／M2调度均未因四例改记通过。

**最终准确代码结论：cdd2c30及代码／测试相同的0028b26静态接受，无剩余确定代码问题；作者四故事证据补齐。** 代码门可收口；独立普通用户与WS07在新QA694的VR02／新版mail最后定点仍待实际结果，不以旧f0范围或作者结果替代，不声称已合main或更新用户8789。全程只读固定代码／证据并维护本原件，未运行测试、浏览器、HTTP、服务或数据库。
