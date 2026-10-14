# 世界视觉与美术方向提案

日期：2026-10-14 · 作者：独立设计总监会话 · 状态：已补三张风格概念板 v1，推荐待选择，尚未独立检查。

**建议先以「平面群岛」建立视觉身份：主人能认出自己的居民，访客能想象它将来怎样发现、交流和留下经历；首期用主视觉、基础角色与清楚的管理界面承载这份期待。**「微缩街区」和「轨道图谱」保留为有实质差异的备选。三者都可以先完成 M1，不需要先建设可漫游的游戏世界。

用户要求可视化后，本稿补充了三张风格概念板，每张包含世界场景、身份卡和主人管理示意。它们是用于选择方向的生成图片，不是可运行页面、已批准界面设计或可直接交付的工程素材。本设计会话未实施网站、注册服务、实时世界、动画或模型，也没有性能实测。下文的颜色、尺寸、数量和动效时长仍是候选规格，不是已批准规范或已验证容量。

目标目录为 `/Users/kjw/Workspace/Codes/agents-era`，应用项目标签为 `connet.ai`，最终品牌待定。初次文字规划时目标不是 Git 仓库；本会话未初始化 Git，未引用历史 `connet-ai` 代码或规范作为实现依据，也不替代 WS07 的体验与开源职责。统筹已同步 M1 后端及非视觉开发获授权，前端待用户与设计总监敲定方向后启动；本次仍只产出视觉概念，不启动前端组件或视觉工程实现。

## 可视化概念板 v1

三张图使用相同的三位示例居民、一件作品与一本经历手册，以世界场景和下方界面示意比较方向。所有身份与状态均为假设数据；「已注册」「已加入」不表示当前在线，「本地配置：未知」不表示已配置。每张保留「非实时世界」与「假设数据」标识。

**A · 平面群岛：明亮平面插画，角色与分区优先。当前推荐。**

![A 平面群岛风格概念板，非实时世界；下方为身份卡与主人管理的假设数据](/Users/kjw/Workspace/Codes/agents-era/docs/design/concepts/world-art-a-flat-v1.png)

**B · 微缩街区：实体空间与共同地方感优先。**

![B 微缩街区风格概念板，非实时世界；下方为身份卡与主人管理的假设数据](/Users/kjw/Workspace/Codes/agents-era/docs/design/concepts/world-art-b-miniature-v1.png)

**C · 轨道图谱：数字身份、作品与连接优先。**

![C 轨道图谱风格概念板，非实时世界；下方为身份卡与主人管理的假设数据](/Users/kjw/Workspace/Codes/agents-era/docs/design/concepts/world-art-c-orbits-v1.png)

视觉自查：A 初稿的岩石与建筑体积感过强，已定向修为平面区域，最终采用修订版；B 保留微缩体块与连贯街道；C 保留围绕身份展开的节点与轨道。C 本次角色更偏人形、背景含装饰性星站地形，这是概念图中的可再调整元素，不构成对角色类型或世界地形的批准。三张均为 1536 × 1024 PNG，由内置 image_gen 生成并保存到本项目 `docs/design/concepts/`；没有引入参考网站图片或创建 3D 工程。完整提示词记录见文末折叠内容。

## 1. 先从主人看见什么开始

主人把接入说明交给自己的 Agent，过一会儿得到一个名字、形象和身份。之后回来，即使本地工具已经停止，他仍然能说：“这是我的那一位。”他能看见注册和加入的实际结果，也能知道哪些本地信息平台尚不清楚。将来有了感知与互动，他可以回看有来源的经历；安静的一天也不需要被补写成精彩故事。

因此，这个世界首先需要三种感受：**有一个值得回来的地方，有一个能认出的居民，有一份可信的近况。**空间负责前两者，状态与记录负责第三者。视觉可以令人期待，不能用走路、忙碌姿势或聊天气泡替平台补充事实。

| 用户关切 | 本提案的视觉回应 | 尚不据此确定的事项 |
| --- | --- | --- |
| 希望比发帖、点赞更丰富 | 给角色、作品和交流留下可辨认的空间与物件形态，后续关联真实经历 | 首种活动、社交关系、完整玩法 |
| OpenBotCity 是接近的体验，但用户感到界面复杂、同屏多时性能差 | 每次只展示一个阅读范围；选中才展开标签；保留列表，分开介绍与管理 | 未独立复测其性能，不以此排除某种画风或渲染形式 |
| 曾提到 Upstreet 的 2D 动漫观感、AIvilization 的游戏化 | 将角色亲近感、空间感、功能密度分开比较，允许选出自己的组合 | 这些反馈不是已批准的动漫、3D、等距或游戏视觉排除清单 |
| Agent 可能在线，也可能按安排偶尔进入 | 形象持续保留；参与、连接、最近事实分别标注 | 不预定心跳机制或「在线」有效时长 |
| 首期需要有吸引力的官网与多 Agent 管理 | 官网呈现愿景；身份卡建立辨识；管理页让目标和权限清楚 | 品牌名、认证方式、首个宿主、首期自动排程仍待决定 |

本提案的产品依据是[体验总览](../product/experience-overview.md)、[产品定义](../product/product-definition.md)、[成长世界](../product/growth-world.md)和[五阶段范围](../product/mvp-scope.md)。已按用户故事 → 功能与流程 → 技术设计 → 交付计划阅读 [WS07 四层文档](../workstreams/ws07-experience-launch/01-user-stories.md)，并读取 [WS01 用户故事](../workstreams/ws01-registration/01-user-stories.md)。最新多 Agent 流程来自本次派单与[首期准备清单](../planning/ws01-execution-prerequisites.md)，尚待 WS01 细化的规则不会被视觉稿定案。

## 2. 三个方向，先看区别

以下名称是讨论用的艺术方向名，不是品牌命名。

| 方向 | 一句定位 | 访客第一眼看到什么 | 主人回来时的感受 |
| --- | --- | --- | --- |
| **A · 平面群岛**，当前推荐 | 一个可以带回经历的开放世界，像一份逐渐丰富的游历手册 | 明亮底色上的几个漂浮色块、独立角色与小型作品标记；有空间，却没有铺满城建 | “它仍是我的那一位；有新记录时，我能翻到那一页。” |
| **B · 微缩街区** | 一个有住处和会面地点的数字居民街区 | 斜俯视的立体建筑、连贯街道、小广场；角色像桌上模型中的居民 | “它在这个共同地方有自己的位置，我想看看街区发生过什么。” |
| **C · 轨道图谱** | 一个由数字身份、兴趣和作品连接起来的探索网络 | 深色底上的轨道、角色徽章与少量内容节点；更像数字星站 | “我想看看它接触过哪些内容，哪些连接留下了结果。” |

空间结构也不同：A 是可独立编排的平面区域，B 是连续街道中的实体场所，C 是围绕选中对象展开的关系范围。它们不是同一张图换三套配色。

## 3. A · 平面群岛：空间像手册，角色像同行者

主人在一张明亮的画面中看到自己的角色，旁边留出身份与事实的位置。将来的作品、交流与经历可像小展页一样放进不同区域；区域名称和内容由实际阶段决定。画面不要求角色不断行走，空白本身也成立。

| 项目 | 具体候选设计 |
| --- | --- |
| 场景与空间 | 正视与浅俯视混合的 **2D 图形空间**。圆角的不规则区域相互留白，靠小门、台阶或弧线产生纵深；不画一套能自由绕行的建筑。官网主视觉用三个区域，未来观察图按对象或主题分区，布局位置明确是组织信息的位置。 |
| 角色比例 | 全身约 **2.5 头身**，宽头与短肢，正面和一个浅侧面即可开始。先比较圆帽披肩、方框背包、三角头巾三种轮廓；形状和一个配件承担辨识，五官保持简洁。头像裁切保留轮廓特征，不能只靠衣服颜色认人。 |
| 角色意义 | 配件表达主人或 Agent 选择的个性，不自动证明职业、技能、活跃或成长。不同居民允许外观相似，名字和稳定公开 ID 负责消歧。人类参与者到 M2 再依真实身份用文字标签区分，不要求换成人形来证明身份。 |
| 材质与光照 | 大面积平涂，区域边缘有一层偏移色块或软阴影；少量静态纸面颗粒只用于介绍插画。统一左上侧柔光，无金属镜面、动态投影或持续环境光变化。小头像删去纹理，保持干净。 |
| 色彩 | 候选底色 `#F5F1E8`、文字 `#222B3B`、品牌蓝 `#3156D8`；珊瑚 `#F27863`、浅绿 `#B8CFB1`、赭黄 `#E1AF4E` 用于角色和区域。浅色大面配一处强蓝焦点，让画面有精神；装饰色不直接充当业务状态色。 |
| 字体与界面 | 标题采用略圆但不幼稚的无衬线，正文为清晰的常规中文无衬线；具体字体与许可后定。候选正文 16px，标题桌面 44–64px、手机 28–36px。介绍页可有不规则插画边界，操作区采用规整列和稳定按钮，事实写在纯色面板上。 |
| 动效节奏 | 用户选中后，角色小幅抬头或卡片展开约 180–240ms；切换区域可淡入约 300ms。仅回应浏览操作，不解释为 Agent 行为。介绍插画可另比较一次 4–6 秒的空间展开，始终标明概念演示，默认静止、由人播放，无背景角色循环忙碌。 |
| 低配与移动端 | 保留一张静态构图或当前区域，减少颗粒和阴影；对象转为头像加文字条目。手机不缩小整张大世界，把一个区域放在说明后，再给完整列表；减少动画模式直接显示终态。 |

**这个方向的吸引力来自角色与空间的组合。**单独一排圆角卡片容易变成普通工具网站，下一轮概念稿应检验：拿掉项目名称后，区域轮廓、角色形状和蓝色焦点是否仍能被认出。风险是过分软萌或过于文具化，需要用更利落的结构与角色姿态修正。

## 4. B · 微缩街区：共同地方更强，资产要求更高

主人看到一个能记住位置的街区：建筑之间有广场和通道，自己的角色在选中位置有清楚标记。它更容易让人产生“我愿意看看这个地方”的期待，也更容易让人以为这里正在持续模拟生活。

| 项目 | 具体候选设计 |
| --- | --- |
| 场景与空间 | **2.5D 微缩模型观感**，斜俯视、固定构图，建筑有可见顶面与侧面。以一处开放广场、两三种低层建筑和街道形成连续空间。视角先保持固定，未来是否用实时 3D 或平面素材表现由技术评估决定。 |
| 角色比例 | 约 **3 头身**，圆柱或方块身体，头顶轮廓和肩部配件明显。身体与场景同一材质；世界内角色较小，选中后提供放大的半身像。屋檐不能挡住可选对象，名字不跟着每个角色常驻整幅场景。 |
| 辨识方式 | 帽型、身体轮廓、徽章纹样和名字共同辨识；所选角色有独立描边与侧栏。不能把居民住处当成已确认的房产功能；注册阶段只借场所组织画面，不分配房屋或职业。 |
| 材质与光照 | 哑光陶土或树脂模型，低纹理密度，宽倒角；一个主光方向与柔软阴影。灯窗是固定装饰，不用开灯表示在线、熄灯表示离线。第一版不需要昼夜、天气和动态水面。 |
| 色彩 | 候选背景 `#E8ECEB`、深海蓝 `#233746`、陶土 `#C97558`、淡墙面 `#F0DFBA`、树脂绿 `#748B78`、暖光 `#F2C879`。官网可用傍晚版主图；管理面板保持高对比浅底，不压在昏暗场景上。 |
| 字体与界面 | 标题可以偏窄、像街区标识，正文仍为常规无衬线。世界侧栏像场所说明牌，管理页仍是明确的表单与列表。避免把建筑门牌变成只能在世界内点击的唯一导航。 |
| 动效节奏 | 介绍中可比较一次缓慢抬起的镜头，约 5–8 秒，由人播放且标概念演示；真实观察视图固定镜头。选中后以描边与侧栏反馈，约 200ms；角色不巡逻，不因新网页访客进入而自动“会面”。 |
| 低配与移动端 | 街区以固定图片或更简化构图呈现，列表保留全部核心动作。手机显示局部与放大的选中角色，不能要求双指缩放才能找到自己的 Agent。减少动画模式不移动相机。 |

**适合把「共同地方」放在第一位时选择。**它需要统一视角、比例、遮挡、光照和材质，新增建筑或角色配件的成本高于 A；若以后增加实时观察，镜头和场景复杂度还要单独检验。微缩外观本身不授权建设房产、生产链或生活模拟。

## 5. C · 轨道图谱：连接更鲜明，亲近感需要补足

主人先看到自己的数字身份，周围是它有权查看的对象与记录。选中一件作品或一次交流，才展开相关连接。空间像可阅读的星站，不是整个网络持续跳动的一张图。

| 项目 | 具体候选设计 |
| --- | --- |
| 场景与空间 | **平面轨道与节点空间**。以选中对象为中心，外围两个层次放主题区域和内容；轮廓是弧线、环与停靠位。全局缩略只显示区域，不能绘制所有居民之间的全部连线。位置表示阅读组织，不表示实际宇宙位置或社交距离。 |
| 角色比例 | 主体是一枚徽章：约 **1.5 头身的简短半身形象**置于方圆之间的外壳。三种头部轮廓、侧边缺口和一个识别符号承担个性；较大详情卡再显示完整肖像。避免所有居民都变成没有个性的圆点。 |
| 辨识方式 | 肖像、外壳轮廓、名字与稳定 ID；形状纹样在灰度中仍有差别。人、Agent、作品等对象类型使用图标加文字，不能把角色外壳误当权限、模型档次或稀有度。 |
| 材质与光照 | 平涂或极少渐变，局部有薄亮边；不以玻璃透明层堆叠正文。无持续粒子、光束流动或全屏泛光。实体靠边界区分，光线用于选中反馈，不能表示未被确认的思考或传输。 |
| 色彩 | 候选底色 `#0E1228`、正文 `#E8EDF7`、亮青 `#53D8E5`、淡紫 `#B59EFF`、暖橙 `#F2A866`、深面板 `#1B2340`。亮色只占小面积；管理界面另比较浅底版本，不能为科幻感牺牲连续阅读。 |
| 字体与界面 | 标题为几何无衬线，ID和时间可用等宽字，正文不使用整页等宽或仿终端。轨道旁只标选中对象与区域名称；详情固定在规整面板中。 |
| 动效节奏 | 聚焦节点时，相关范围淡入约 200–300ms，连接线在终态出现。介绍可由人触发一次展开，约 3–5 秒；不得让线上的光点循环流动来冒充实际消息。不能靠力导向布局持续抖动维持生命感。 |
| 低配与移动端 | 静态轨道只保留一个层次，主要阅读转为列表或关系摘要。手机沿「身份 → 相关对象 → 记录」纵向展开，不要求拖动整图寻找节点；减少动画模式不旋转轨道。 |

**适合把「外部 Agent 的开放连接」作为品牌第一印象时选择。**它对平面素材贡献者较友好，但密集连线会迅速损害可读性；关系推断和视觉编码也容易被误解。它的温度更多依赖角色肖像与真实内容，可能让普通主人觉得像监控面板，需要概念稿验证。

## 6. 怎么比较，以及为什么暂荐 A

以下是根据上述设计复杂度做出的相对判断，属于艺术与制作推断。没有三个已实现版本供跑分，也没有 FPS、加载时间、内存或最大在线人数结论。

| 维度 | A · 平面群岛 | B · 微缩街区 | C · 轨道图谱 |
| --- | --- | --- | --- |
| 品牌辨识 | 区域轮廓加短身角色可形成自己的形象；要防止普通卡片化 | 整体街区容易记住；要防止落入常见城建外观 | 徽章与轨道组合鲜明；要防止通用科幻大屏感 |
| 世界感 | 靠区域、物件和内容联系形成；纵深适中 | 最强的实体场所感，角色与建筑存在同一空间 | 数字网络感强，实体地方感较弱 |
| 社交表达 | 选中交流后并置参与者和作品，适合异步经历 | 会面地点直观，但容易被看成当前都在场 | 连接来源清楚时表达直接，无节制连线则失效 |
| 成长表达 | 经历页、方法卡和证据分层容易延续 | 可放展品或记录牌，不能用房屋变大代表能力增强 | 可展开经历与方法来源，不能用节点变亮代表能力增强 |
| 可读性 | 留白与纯色文字区最容易保持稳定 | 建筑遮挡、镜头与标签竞争，需要额外处理 | 低密度清楚，高密度节点与线条竞争明显 |
| 同屏数量 | 区域概览加局部展开，可逐步增加内容而不画所有角色 | 场所和角色占位大，更适合少量特写；多角色需分区或列表 | 概览可以聚合很多对象；可读的带标签节点仍应很少 |
| 资产成本 | 相对低至中；轮廓、配件、区域图形可独立复用 | 相对高；建筑、角色、遮挡与光照要成套统一 | 平面素材相对低；信息编码、关系样例和布局设计成本不能忽略 |
| 性能风险 | 主要来自过多展示元素、图像体积与动画；静态形式易删减 | 若实时绘制，场景、阴影与标签同步带来较多变量；固定图版仍需图片预算 | 主要来自对象与连线数量、持续重排及效果；节点素材轻不代表图谱总成本低 |
| 开源贡献难度 | 轮廓、配色、图标可作小范围贡献；需统一规格与来源 | 单项制作也需服从统一视角、尺度、材质，入门门槛较高 | 图标和徽章易贡献；关系布局与语义更需要统一审核 |

推荐 A 的理由是：它用较少资产同时支持吸引人的介绍、可记住的居民和清晰管理；也符合异步参与时“角色仍在、没有新经历”的安静画面。后续作品、互动和经验摘要可以进入同一视觉语言，M1 不必预支建筑和实时场景的成本。

这项推荐是一个候选选择。若用户最想要“看见一个真正的共同地方”，B 应升为首选；若最想要“数字身份与知识连接”，C 更合适。不要直接拼成 A 的人物、B 的房屋、C 的全屏光效；先选主方向，再验证少量借用元素是否一致。正式品牌尚未确定不阻塞这次比较。

## 7. 推荐方向怎样落到 M1 的三种界面

以下为下一轮设计稿的构图说明，所有按钮与数据都是规划示例。本轮没有可使用的网站或注册入口。

### 7.1 官网首屏与介绍示意

**访客先理解一句价值，再获得可信接入路径。**桌面构图左侧为项目定位、当前阶段、提示词入口；右侧为约三个区域和一个主角色的主视觉。主视觉中有记录页、作品台等未来物件，旁边持续标注「愿景示意 · 非实时世界」。这些物件不成为 M1 可点击业务入口。

候选文案是：“让你的 Agent 有一个可以回来、也能带回经历的世界。”补充说明直接写明：“Agent 在你的电脑或自有云端运行，按你允许的节奏参与。”页面同时列出“首期计划：注册、角色、加入与主人管理”，再以独立段落介绍 M2—M5。当前规划稿的状态写“尚未开放”；未来上线时由 WS07 依据实际能力更新。

```text
项目标识                              接入说明 / 项目介绍
一句话价值          [主角色 + 三个平面区域]
当前阶段与边界       愿景示意 · 非实时世界
[复制接入提示词] [查看接入说明]
将说明交给自己的 Agent → 私密接收身份与管理方式
本期范围                    未来方向
```

复制区呈现短提示词与可信说明地址，配清楚的复制反馈；具体内容消费唯一的版本化说明，不由美术另写注册规则。主人不需要先做角色选择或打开管理入口才能授权 Agent 注册。手机先呈现价值、阶段和接入动作，再显示裁切得当的主视觉；插画不能推走核心入口或把状态标注裁掉。

官网可以解释未来可能积累经历，但不能放没有来源的“正在交流人数”、模拟聊天、滚动收益或能力升级排行榜。进入管理的路径由认证设计决定，不在本提案预定登录方式。

### 7.2 Agent 角色与数字身份卡

身份卡上部是大头像与名字，下部按读者所需展示稳定 ID、公开简介、注册事实和成员状态。用三种轮廓、有限配色、一个配件开始比较；大图保持个性，32px 头像仍要能区分轮廓。角色姿态是肖像姿态，不代表当前正在做什么。

| 展示范围 | 候选内容 | 视觉边界 |
| --- | --- | --- |
| 可公开的身份卡 | 名字、公开 Agent ID、授权公开的简介和形象、可公开的成员事实 | 按 WS01 最终公开字段裁定；不含主人编号、绑定关系或管理入口 |
| 主人私有身份详情 | 当前选中的 Agent、获准资料、注册/加入结果与时间、资料草稿或锁定状态 | 管理认证和运行访问结果分别展开，不能用一枚「认证成功」章包办 |
| 本地配置摘要 | 获准上报的配置结果、来源、报告时间和未完成项 | 没有报告就显示未知；M1 不为这张卡提前要求 M2 同步系统 |

例如一张**明确标注为假设数据的管理设计稿**可以写：小岚／Agent ID 示例 A-001／注册已完成／尚未加入：资料待补全／本地配置：平台未收到报告。不同事实不合成“活跃”或“准备完成”的大绿灯。

卡面边框和纹样承担品牌辨识，不使用仿加密签名、盾牌或等级勋章来宣称身份已获验证。公开 ID 是定位信息；凭据与认证机制由 WS01/WS06 决定，不能做成公开可扫的秘密二维码。改名、换装和离线不改变稳定身份。

### 7.3 主人多 Agent 管理

**管理页的第一件事是确认：我正在管理谁。**桌面左侧为已获准的 Agent 列表，右侧显示当前目标；手机以顶部选择器加当前身份条呈现。两处都同时保留名字、小头像和短 ID，不能只用相似头像或配色区分。

```text
我的 Agent                 当前管理：小岚 · A-001（示例）
小岚 · A-001 [选中]         注册结果 | 成员状态
小墨 · A-002                角色资料 / 字段设定
[添加 Agent]               本地配置报告 / 未知与限制
                           参与与访问管理
```

“添加 Agent”是最新需求的入口占位，具体采用受限邀请还是其他规则由 WS01 细化；不把主人完整凭据复制给第二个 Agent。首次管理初始化是独立步骤，不能用“激活角色”叙事否定已注册身份。

切换时，目标身份条立即明确新对象，在新数据确认前用文字说明正在读取，不短暂套用前一个 Agent 的私有状态。角色草稿、迟到结果、暂停和撤销都应回到正确对象；该行为需未来实现与测试，头像变化本身不能证明隔离正确。关键操作的说明重复目标名字和短 ID，批量操作只有在产品规则允许后才考虑。

信息按「身份与成员 → 角色资料 → 获准本地报告 → 参与和访问」组织为可展开内容，由 WS07 检查任务顺序。预算、时段和频率若当期支持，必须分别呈现主人设定与宿主采用/执行的来源；若未支持或无报告，明确说明，不画一直进度中的算力仪表。

这里保留 A 的头像、主蓝和简单区域纹样，正文使用规整的纯色区域。管理页不要求主人在群岛上找按钮，也不播放世界装饰动画。世界画面负责观察与兴趣，管理界面负责正确目标、事实和操作。

## 8. 后续真实世界怎样延续

| 阶段 | A 的视觉语言怎样增加内容 | 必须来自什么事实 |
| --- | --- | --- |
| M1 | 一个角色、身份卡与自身加入结果；官网另有愿景图 | WS01 的获准身份、资料、成员与管理结果 |
| M2 | 区域概览加对象列表，人、Agent、物品、作品、空间、事件有图标和文字分类 | WS02 的可见对象、来源、时间及读取完整性；位置仍为组织布局 |
| M3 | 选中交流后并置双方、相关作品与过程记录；未选中时不铺所有连线 | 已获准的真实邀请、接受/拒绝、反馈与结束；主人不自动获得双方私文 |
| M4 | 经历页与方法卡区分候选、保存、试用、复用和评测，留出无改善与回退的样式 | 用户选择同步的来源与证据摘要；不凭外观变华丽宣布能力提高 |
| M5 | 同一风格的需求与交付面板，空间只帮助发现 | 约定、承接、交付、验收和异议的实际状态；收币不等于产生真实价值 |

展台、门或区域只是可选的空间隐喻。它们随真实内容与阶段进入，不形成先建一整座空城的依赖；也不预定游戏地图、移动距离、碰撞、房产或经营。以后若用户选择增强纵深，可保留 A 的轮廓、配色与状态语言，再对有价值的局部空间比较实现方式。

## 9. 三个方向都遵守的状态表达

状态的源语义归业务所有者，本表是视觉表达原则，供 WS07 与 WS01/WS02/WS06 核对；不建立第二套状态机。只展示当期实际存在、当前读者有权知道的事实。

| 概念 | 建议表达与样例 | 容易误导的表达 |
| --- | --- | --- |
| 已注册 | 文字「已注册」及可核对结果，单独显示稳定身份 | 一注册就点亮全世界、显示已经社交 |
| 已加入 | 单独的成员状态；未加入、退出与限制给明确文字 | 凭据有效就显示已加入；退出就画成身份消失 |
| 在线 | 只有当期确有定义且有新鲜证据时，显示来源、时间与适用范围；由 WS02/WS06 确定有效期 | 从网页开着、角色有动画或旧成功请求推断持续运行 |
| 最后同步或最后联系 | M2 按真实同步事实标出绝对时间和必要的完整性说明；M1 若只有注册回执就称注册结果时间 | 把注册时间改叫最后世界同步；把旧同步写成当前在线 |
| 本地配置 | 分列配置结果、报告来源和时间；「未配置」「不支持」「未收到报告」可分辨 | 已保存一个频率就称周期执行成功；平台自行宣称本地进程已停止 |
| 正常无新增 | 只有完整读取后无新增时说明「本次没有新变化」 | 读取失败、缺页或无声明时写「今天什么都没发生」 |
| 未回馈与未知 | 无分享、自报不行动、尚无后续记录和已知错误按证据分别表达 | 根据沉默推断心情、忙碌、休眠或成长停滞 |
| 暂停、退出、撤销 | 操作结果各自展示，并说明平台参与或访问的范围 | 一键「关闭 Agent」暗示平台能关闭本机运行时 |
| 演示与模拟 | 每个图版或样例数据区就近标「愿景示意」「假设数据」或「概念动效」，裁切后也保留 | 只在页尾免责声明，主图仍冒充真实活跃居民 |

视觉上，品牌与角色色保持稳定；已离线或状态未知的居民不褪成“低等级”形象。选中用描边加文字，状态用图标加短句，色彩只作辅助。问号形状与「未知」文本可以协同表达，但不能让灰色同时包办离线、暂停、退出、错误和未知。

装饰动画与行为回放分别设计。装饰只回应人的浏览且可关闭；未来如有实际行为回放，需要事件来源、发生时间、回放标识与停止控制。回放记录不是实时活动，暂停回放也不暂停 Agent。公共世界只能展示获准内容，用户可见性变化后的清理由实现方处理，不能用主视觉继续展出失权内容。

## 10. 公共官方参考：具体借什么

查看日期均为 **2026-10-14（Asia/Shanghai）**。仅研究公共官方页面，不登录、不注册、不执行其中的接入指令。事实介绍是官方自述，视觉观察是本次查看到的页面，设计迁移是本提案的判断；这些来源没有验证本产品的价值或性能。

| 官方来源与本次查看范围 | 具体参考点 | 不据此引入的内容 |
| --- | --- | --- |
| [OpenBotCity 居民目录](https://www.openbotcity.com/agents)，读取公开文字；世界首页浏览器导航超时，未检查完整场景 | 目录有搜索及分类入口，角色可以从世界概览转入独立资料；用户的复杂与性能反馈促使本案分离介绍、观察和管理 | 不复述其持续活跃宣传为本产品承诺，不把本次访问失败当成其性能测量 |
| [Upstreet 官网](https://upstreet.ai/)与[官方文档](https://upstreet.ai/docs)，查看首页画面和公开文档 | 首页当前示例可见动漫人物与城市场景；文档列出多种世界形式。借角色肖像与场景的层次关系，说明画风和功能范围可以分别选择 | 不把它定义为只能 2D，也不继承其 NPC、编辑器、市场或实时系统 |
| [AIvilization 官方指南](https://aivilization.gitbook.io/aivilization-en)，读取标为 Work in Progress 的指南 | 指南把身份、日常目标、住所与成长路径连成故事，提醒本案也需要清楚的居民连续性 | 其住宅升级、职业财富和离线继续成长的自述不进入本产品范围；未查看登录后的游戏画面 |
| [ustwo 的 Monument Valley 官方案例](https://ustwo.com/work/monument-valley/)，查看文字与首页案例画面 | 可见用大几何面、有限色组和不同高度形成空间层次；A 借层次与留白，B 借体块边界，这是视觉迁移判断 | 不复制角色、关卡、建筑造型、配色组合或错视玩法；不是本项目的渲染方案 |
| [Raw Fury 的 Townscaper 官方页](https://rawfury.com/games/townscaper/)，查看介绍与嵌入预告的封面，未播放或运行游戏 | 可见彩色建筑聚成连贯的微缩街区；B 借清楚的体量与场所感，具体材质方案由本案提出 | 不引入造房机制、程序生成城市或资产；封面无法证明浏览器帧率 |
| [Are.na 官方介绍](https://www.are.na/about)，查看页面和公开说明 | 它以内容集合、整理与连接组织发现；C 借“围绕对象展开连接”的信息思路，管理区借清楚的正文与留白 | 不把其白底网站当成 C 的科幻画风来源，不复制页面或把本产品简化为内容收藏 |

Monument Valley 系列主站本次文字读取仅返回 Loading，最初的浏览器工具也两次超时；因此改用 ustwo 官方案例页实际查看。Upstreet、ustwo、Raw Fury 和 Are.na 的画面经另一浏览器查看；OpenBotCity 的完整世界场景及 AIvilization 游戏内视觉未取得证据。以上区别保留，避免把查到文字写成已体验完整产品。

网上画面只作有来源的概念参考。没有把参考图片保存到项目目录、作为自有素材分发或宣称已获素材授权；下一轮正式素材需独立制作，并记录作者、来源、使用范围及许可。字体也须按选中的具体方案核验。

## 11. 首批待制作素材与依赖

**已生成三张方向概念板；正式工程素材尚未制作。**先比较方向，选择后只为主方向细化 M1 最小集。下面是候选范围，不增加原 74 张任务卡，不自动授权前端实现或资产生产线。

| 批次 / 素材 | 最小候选数量与内容 | 需要的输入与交接 |
| --- | --- | --- |
| 方向比较板 | 已生成每方向一张，同为三位示例居民、一件作品、一本经历手册及界面示意；都标假设数据 | 本提案、用户要求可视化；后续由 WS07 检查理解与信息量是否可比 |
| 选定方向的视觉规则页 | 一页：区域/体块/轨道、角色比例、候选色、正文与状态组合、可用与禁用例 | 用户风格选择；设计总监提炼美术规则，WS07 核对阅读与状态 |
| 基础角色 | 三种轮廓，每种正面大头像、半身或全身各一版；附小尺寸裁切样例 | WS01 静态公开字段、形象目录与设定模式；无须等角色 API 实现 |
| 初始变化元素 | 六组候选配色、三种头部元素、三种配件；先检查灰度及小头像中的重复 | WS01 可组合与可锁定字段，设计总监控制风格；不承诺每个组合唯一 |
| 官网主视觉 | 一张桌面横版与一张手机重构版，同一主题；含固定可见的愿景标识位置 | WS07 定位、阶段文案、接入阅读路径；品牌未定时使用工作名称 |
| 身份卡 | 一个公开版本、一个主人私有版本，附草稿、未加入与未知样例 | WS01 字段/权限/结果静态样例；WS07 定信息优先级 |
| 主人管理设计稿 | 桌面与手机各一套，覆盖两位相似头像 Agent 的切换、添加入口、空列表和读取失败 | WS01 多 Agent 规则与认证入口候选，WS07 信息架构；不用真实秘密 |
| 状态与操作图形 | 身份、成员、未知、错误、锁定与当前目标的最少图标，配文字规范 | 当期状态样例与 WS06 展示数据；M2 在线/同步图标随阶段增加 |
| 概念动效分镜 | 一套约 4–6 秒 A 方向空间展开分镜，附静态终态与减少动画版本 | 静态构图通过后再考虑；本批先画分镜，不要求成品动画或所有角色动画 |
| 素材交接记录 | 每项记录用途、作者/来源、许可状态、版本、尺寸、裁切、替代文本与静态替代 | WS07 开源贡献规则与 WS06 加载/目录评估；未确认许可不标可分发 |

如果选 B 或 C，上表的角色、官网、身份卡、管理和状态数量仍保持可比；B 另比较少量统一建筑体块，C 另比较节点与连接图例。它们先是设计稿素材需求，不自动建立 3D 资产生产线或图谱工程。

### 11.1 把约束交给相应负责人

| 协作方 | 本案需要其核对的输入 | 本提案不自行决定的内容 |
| --- | --- | --- |
| WS01 | 最小公开资料、目录参数、角色设定/锁定、多 Agent 绑定与当前目标、注册/成员/管理事实 | 认证、恢复、准入、追加邀请或数据权限规则 |
| WS07 | 首屏文案、介绍与管理的信息架构、手机优先级、状态语言、理解与可访问性检查 | 不用艺术方向替代其体验设计或宣称已经可用 |
| WS02及后续领域 | 当期获准对象、事件、互动与证据样例；由统筹按阶段派回所有者 | 不预建后期对象、活动、成长机制或交易 |
| 技术总监与 WS06 | 角色/场景数量、是否需要真实体积、静态替代、图像体积和加载需求、来源与版本元数据 | 素材实际目录、格式策略、渲染引擎、技术栈、帧率目标、设备容量与资源预算 |

已读取[技术总监的代码组织提案](../architecture/ws01-code-structure.md)中首期交付、正式视觉资源候选位置、多 Agent 切换及本地配置表达的相关内容。其结构与规则仍是待审提案；本案提供用途与需求，不建立第二套资源目录或页面。

可供技术评估的展示样例是：官网一张主图；M1 管理中 1、6、20 位可管理 Agent 的列表；M2 后续分别 12、48、120 个可见对象的概览与局部展开。这些数字是比较负载样例，**不是同屏全量角色、最低容量或验收阈值**。列表与图形的真实范围由 WS07/WS06 结合设备决定，M1 不为 M2 容量建设预先运行系统。

## 12. 最小视觉验证：先看懂，再验证实现

概念参考、设计稿、实现和实测是四种不同产物，不能跳过中间步骤把推荐写成效果结论。

| 阶段 | 最小方法 | 能回答什么 | 不能回答什么 |
| --- | --- | --- | --- |
| 本轮文字与生成概念板 | 对照产品边界、自查引用、图中标签和三方向差异，交 WS07 独立只读检查 | 是否完整、是否偷渡功能、推荐是否有依据 | 界面是否能用，性能是否合格 |
| 用户方向比较，三张板已备 | 先看 5 秒再描述，之后选择想继续看的方向；尚未开展独立读者试验 | 首要感觉、角色辨识、是否误认为实时游戏、审美偏好 | 不能证明注册成功、实际社交或长时间使用价值 |
| M1 设计稿，选定后 | 桌面 1440px、手机 390px 并补 320px 窄屏；纸面或设计原型走首次管理、双 Agent 切换、未加入与未知状态 | 入口是否明显、当前目标是否清楚、字体与裁切是否可读 | 静态稿不能证明权限隔离、迟到响应处理或性能 |
| 实现与真实负载，正式开发后 | WS07 领测理解/操作，WS01 验业务，WS06 与技术总监先固定设备/负载/资源和响应目标，再记录浏览器数据 | 键盘、焦点、读屏、减少动画、切换、真实加载与交互是否达标 | 不以一次高配设备截图推广为全部设备可用 |

下一轮获准的最小理解检查可由 WS07 组织三名没有读过规划的读者，作为发现明显问题的小样本，不当市场验证。先让他们看首屏，再看身份卡与管理稿，回答：“Agent 在哪里运行？现在开放什么？它已注册还是已加入？这张图是实时还是示意？我正在操作谁？平台知道本地排程成功了吗？”任何一处把示意当实况、把注册当在线或操作错目标，都先修稿。

还要在三种轮廓的 32px、64px 与大头像中检查辨识；用灰度检查颜色失效后是否仍能分清；用长名字、同名、两位同配色角色验证当前目标表达。正文与控件应达到约定的可访问性目标，候选颜色尚未逐组合测对比，不预先宣称达标。关掉全部动效仍须获得相同核心信息，数据未知时也须有完整、安静的画面。

生成概念板的作者视觉检查已经完成；独立读者与产品实测仍为未来方法。本轮未邀请、联系或采集用户，没有实施浏览器产品测试。代码实现之后仍需专门独立代码审查 thread；设计总监的自查和 WS07 的体验检查不替代该审查。

## 13. 请用户选择的三个关键问题

| 问题 | 可选答案 | 当前建议及影响 |
| --- | --- | --- |
| **第一眼最想让这个世界像什么？** | A 平面群岛／B 微缩街区／C 轨道图谱 | 建议 A，兼顾角色个性、世界期待与首期素材范围；选择决定下一轮主方向，不是批准实现 |
| **居民更像怎样的伙伴？** | 简短卡通异形／接近人的卡通角色／保留两类但统一比例 | 建议先比较简短卡通异形的三种轮廓，容易小尺寸辨识；若更偏人形，仍可沿用 A 的空间语言。这是提议，不是已排除动漫 |
| **未来观察世界时，最想先看到什么？** | 分区后看对象与经历／连续街区中的场所／围绕身份展开的连接 | 建议分区后看对象与经历，配完整列表；这决定未来概念场景的重心，M1 仍只完成身份与管理 |

最终品牌、具体字体、技术栈和认证方式可以在各自依赖前另行确定，不加入本次三个审美问题。用户选择艺术方向也不等于授权网站开发、素材公开发布或完整世界实现。

## 14. 作者自查与 WS07 独立检查入口

最初派单的文档写入范围只有本文件；用户随后直接要求可视化，本会话增加本稿中的三张概念 PNG。索引与登记仍由 WS06 受指派维护，七个 WS 原文、五阶段和 74 张任务卡未由本会话修改。本会话没有创建代码、配置、Git、worktree、服务、定时任务或资产工程。规范依据见[协作入口](../../AGENTS.md)、[开发规范](../planning/development-guidelines.md)及[会话登记](../planning/session-registry.md)。

作者内容自查：三方向的空间、角色、材质、色彩、文字、动效与低配表现均有可比较描述；相对成本和性能判断标为推断；M1 三界面、多 Agent 目标与状态区别有具体落点；官方参考记录了查看范围及访问限制；成品素材和实测数量没有冒充完成。静态文本检查结果如下，作者自查不是独立通过。

2026-10-14 初次文字稿静态检查：11 处本地链接均指向存在的文件，7 处官方网页链接与本次查看来源一致；Markdown 围栏、表格列数、行尾空白与末尾换行检查未发现问题，当时目标 `.git` 不存在。新增概念板后的复核结果在完成后追加；初次结果不冒充新稿复核。本次保存三张 PNG，保留生成原件，不覆盖其他素材，没有生成检查脚本或产品测试证据。

建议统筹交 WS07 的独立只读检查范围：

1. 三方向是否真有体验差异，推荐是否过早锁定视觉，是否能据同内容概念稿让用户选择。
2. 官网愿景标识能否在首屏及手机裁切后仍成立；复制接入与当前阶段是否先于装饰；是否误导为已上线社会。
3. 注册、成员、最后事实、本地配置、未知是否清楚；M1 是否暗含 M2 在线/同步系统，角色静止时画面是否仍完整。
4. 多 Agent 切换、当前操作目标和公开/私有身份卡是否符合 WS01 待定规则；是否误把外观、ID或管理身份当权限。
5. 大世界观察与管理的信息架构是否各司其职；小屏、减少动画、等价列表和小头像辨识是否可设计成可验证样例。
6. 素材清单与目录/性能交接是否足够，是否引入完整漫游、建房、自动成长或实时资产生产的隐性前置。

本稿是历史三轮规划审查之后的新艺术方向提案。尚无 WS07 独立检查结果，不继承既往通过结论；用户选择、概念制作、设计稿验收、代码审查、实测与发布分别保留各自状态。


<details>
<summary>内置 image_gen 提示词记录（概念板 v1）</summary>

生成方式：内置 image_gen；三方向分别生成，A 随后以初稿为编辑对象定向修订。最终采用 A 修订版、B 初稿、C 初稿。透明背景均为 false，没有使用参考网站图片。以下保留实际完整提示词，供复核与后续调整，不是工程实施指令。

### A 初稿

```text
Use case: stylized-concept.
Asset type: ONE polished landscape concept presentation board for choosing an art direction of an external-agent social world. This is original speculative visual design, NOT a live website screenshot.
Layout: generous professional graphic design on a landscape 3:2 canvas. Top 65% is a beautiful world scene, bottom 35% contains two crisp miniature UI mockup insets: a single Agent identity card on the left, a two-Agent owner management panel on the right. Avoid excessive labels or paragraphs. Large Chinese heading at top left and a conspicuous subtitle directly beneath it. All UI fields and all world residents are fictional examples.
Same content for all three directions: exactly three distinctive friendly cartoon digital residents. Main resident XiaoLan: round brim/head silhouette, cobalt-blue cape, small ochre emblem. Second XiaoMo: squarish head silhouette, coral accent and a backpack. Third A-Che: triangular hood/head silhouette, lavender accent. They are posed as illustrated portraits, not performing busy activity. One artwork display with a simple abstract artwork, one open journal representing a past experience, and two small record cards connected by one simple line representing a historical exchange. No chat bubbles. No crops or farm, no romance, no money or level mechanics, no combat, no crowds.
Bottom UI exact sparse text, readable sans-serif Chinese: identity inset heading "居民身份", name "小岚", ID "A-001", labels "已注册" and "已加入". Owner inset heading "我的 Agent"; two rows "小岚 · A-001" (selected) and "小墨 · A-002"; main detail heading "当前管理：小岚"; text "本地配置：未知". Add "界面示意 · 假设数据" as a persistent caption above the bottom insets.
No green online dots, no realtime badges, no activity counts, no credentials, no signature/verified symbols, no fake operational logs. Keep all important text large enough to read. Only the specified Chinese text, heading and subtitle; no extra paragraphs, brand logos, watermark or copyright characters.
Heading exact: "A · 平面群岛".
Subtitle exact: "风格概念 · 非实时世界".
Style: sophisticated bright 2D editorial illustration with shallow cut-paper depth, NOT a full 3D diorama. Three asymmetrical rounded flat islands float in wide cream negative space; low step shapes and a simple arch offer minimal depth. Composition resembles an imaginative travel field guide rather than a conventional SaaS card grid. Main resident larger in foreground, two smaller residents on the other regions. Bold clean shapes, refined edges, restrained static paper grain, one offset shadow layer. Residents are 2.5 heads tall, minimal expressive faces and strong silhouettes, playful but not preschool.
Palette: warm cream #F5F1E8, charcoal #222B3B, saturated cobalt #3156D8 as focal accent, coral #F27863, muted green #B8CFB1, ochre #E1AF4E. Use enough deep cobalt for confidence, not an all-pastel picture. Soft upper-left illustrative lighting. Bottom UI on cream pure panels with blue selection and generous spacing; identity card reuses the identical main resident portrait.
Prioritize a memorable original world composition and rich visual character, no copy of existing game art.
```

### A 最终定向修订

```text
Use case: style-transfer. Edit the supplied A concept board.
Change only the illustration style and depth of the upper world scene and the corresponding resident portraits in the bottom insets. Keep the canvas, Chinese heading "A · 平面群岛", subtitle "风格概念 · 非实时世界", bottom caption "界面示意 · 假设数据", two bottom UI mockup layouts, all correct existing Chinese text, statuses, names and IDs unchanged and legible.
Make direction A unmistakably FLAT 2D editorial graphic illustration. Replace the deep floating rocky cliffs and sculpted architecture with exactly three broad flat asymmetrical rounded color regions floating in cream negative space; a region may have one offset paper-like shadow, not modeled top/side rock faces. Remove material rendering, realistic stone texture, deep perspective, lush diorama detail and volumetric lighting. Use crisp graphic silhouettes, flat color fills, only sparse flat foliage shapes and minimal small steps or one simple arch. A simple visual travel field guide with modern grown-up graphic confidence. Do not make it look like a 3D/clay game scene. Keep the same three character identities and garments (cobalt round-hat cape, coral square-head backpack, lavender triangle hood), 2.5-head proportions, warm minimal faces; render them with clean flat geometric shapes and no sculpted surface highlights. The main character stays prominent.
Preserve one simple abstract art display, one open journal, and two linked record cards, translated into flat illustration. Keep the bright cream, cobalt, coral, ochre and muted-green palette and generous whitespace. The bottom resident thumbnails must match the flattened main illustrations exactly. No new residents, no extra labels or functionality. This board is speculative, never live activity.
```

### B 微缩街区

```text
Use case: stylized-concept.
Asset type: ONE polished landscape concept presentation board for choosing an art direction of an external-agent social world. This is original speculative visual design, NOT a live website screenshot.
Layout: generous professional graphic design on a landscape 3:2 canvas. Top 65% is a beautiful world scene, bottom 35% contains two crisp miniature UI mockup insets: a single Agent identity card on the left, a two-Agent owner management panel on the right. Avoid excessive labels or paragraphs. Large Chinese heading at top left and a conspicuous subtitle directly beneath it. All UI fields and all world residents are fictional examples.
Same content for all three directions: exactly three distinctive friendly cartoon digital residents. Main resident XiaoLan: round brim/head silhouette, cobalt-blue cape, small ochre emblem. Second XiaoMo: squarish head silhouette, coral accent and a backpack. Third A-Che: triangular hood/head silhouette, lavender accent. They are posed as illustrated portraits, not performing busy activity. One artwork display with a simple abstract artwork, one open journal representing a past experience, and two small record cards connected by one simple line representing a historical exchange. No chat bubbles. No crops or farm, no romance, no money or level mechanics, no combat, no crowds.
Bottom UI exact sparse text, readable sans-serif Chinese: identity inset heading "居民身份", name "小岚", ID "A-001", labels "已注册" and "已加入". Owner inset heading "我的 Agent"; two rows "小岚 · A-001" (selected) and "小墨 · A-002"; main detail heading "当前管理：小岚"; text "本地配置：未知". Add "界面示意 · 假设数据" as a persistent caption above the bottom insets.
No green online dots, no realtime badges, no activity counts, no credentials, no signature/verified symbols, no fake operational logs. Keep all important text large enough to read. Only the specified Chinese text, heading and subtitle; no extra paragraphs, brand logos, watermark or copyright characters.
Heading exact: "B · 微缩街区".
Subtitle exact: "风格概念 · 非实时世界".
Style: premium 2.5D miniature town diorama, a fixed oblique elevated camera, fully visible top and side surfaces of buildings, a coherent small plaza connected by streets. Matte resin/clay finish, rounded low-detail geometry, consistent scale, soft shadows. Exactly three small low-rise architectural masses, not skyscrapers or sprawling city. Residents are 3 heads tall with cylindrical/boxy short bodies, broad head/hat silhouettes, same cobalt-cape / coral-backpack / lavender-hood identities. They stand as static exemplars near the plaza. One main resident is easy to locate with a tasteful outlined selection marker, no glowing online light. Artwork stand and open experience journal are physical objects in this miniature space. Historical exchange shown on a quiet record plaque, no characters talking or walking.
Palette: pale gray #E8ECEB background, deep sea navy #233746, terracotta #C97558, cream walls #F0DFBA, resin green #748B78, restrained amber #F2C879. Soft warm side light, a few fixed warm window accents, no implied online/night cycle. Bottom UI is high-contrast cream/navy, clear list and simple form; use a larger cropped resin-style resident portrait in the identity card. Visually distinguish from flat illustration: coherent physical volume, materials, depth and streets. No build controls or fantasy housing upgrade features. Original architecture, do not mimic specific existing town-building games.
```

### C 轨道图谱

```text
Use case: stylized-concept.
Asset type: ONE polished landscape concept presentation board for choosing an art direction of an external-agent social world. This is original speculative visual design, NOT a live website screenshot.
Layout: generous professional graphic design on a landscape 3:2 canvas. Top 65% is a beautiful world scene, bottom 35% contains two crisp miniature UI mockup insets: a single Agent identity card on the left, a two-Agent owner management panel on the right. Avoid excessive labels or paragraphs. Large Chinese heading at top left and a conspicuous subtitle directly beneath it. All UI fields and all world residents are fictional examples.
Same content for all three directions: exactly three distinctive friendly cartoon digital residents. Main resident XiaoLan: round brim/head silhouette, cobalt-blue cape, small ochre emblem. Second XiaoMo: squarish head silhouette, coral accent and a backpack. Third A-Che: triangular hood/head silhouette, lavender accent. They are posed as illustrated portraits, not performing busy activity. One artwork display with a simple abstract artwork, one open journal representing a past experience, and two small record cards connected by one simple line representing a historical exchange. No chat bubbles. No crops or farm, no romance, no money or level mechanics, no combat, no crowds.
Bottom UI exact sparse text, readable sans-serif Chinese: identity inset heading "居民身份", name "小岚", ID "A-001", labels "已注册" and "已加入". Owner inset heading "我的 Agent"; two rows "小岚 · A-001" (selected) and "小墨 · A-002"; main detail heading "当前管理：小岚"; text "本地配置：未知". Add "界面示意 · 假设数据" as a persistent caption above the bottom insets.
No green online dots, no realtime badges, no activity counts, no credentials, no signature/verified symbols, no fake operational logs. Keep all important text large enough to read. Only the specified Chinese text, heading and subtitle; no extra paragraphs, brand logos, watermark or copyright characters.
Heading exact: "C · 轨道图谱".
Subtitle exact: "风格概念 · 非实时世界".
Style: elegant futuristic 2D digital observatory, a sparse planar orbital graph with a large central resident badge, two secondary resident badges, one artwork node and one journal node. Dramatic dark ink background, restrained geometric rings and arcs with generous negative space. Hierarchy is clear, connections are sparse and static, no dense hairball, no terminal screen, no streaming light trails. Residents are compact 1.5-head half-body cartoon portraits in distinctive rounded-square badge shells, with same round/cobalt cape, square/coral backpack and triangular/lavender identities. Portraits have enough personality to feel like residents instead of plain anonymous network dots.
Palette: ink #0E1228, pale text #E8EDF7, small cyan #53D8E5, lilac #B59EFF, warm orange #F2A866, panel #1B2340. Crisp thin geometric borders with just a hint of soft edge light, flat fills and restrained gradients. Only a small central accent glow, no glassmorphism text overlay or distracting star particles. Top world graphic feels like an explorable constellation of ideas and characters; bottom identity card and owner list remain clean, high-contrast dark panels. Use the same central portrait for identity card. Visually distinct from physical islands and buildings. No numerically ranked reputation, live connections or signal/status lights.
```

</details>

