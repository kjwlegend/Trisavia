/** Host-side authoring guidance. Reading this text never installs tools or changes an appearance. */
export const AVATAR_AUTHORING_ASSETS = {
  prompt: '/assets/avatar-authoring/v1/prompt.json',
  template: '/assets/avatar-authoring/v1/template.json',
  sampleManifest: '/assets/avatar-authoring/v1/sample.manifest.json',
  sampleIdlePng: '/assets/avatar-authoring/v1/idle.png',
  sampleWalkPng: '/assets/avatar-authoring/v1/walk.png',
} as const;

export const AVATAR_AUTHORING_PROMPT = `为我制作一套可导入 Trisavia 的原创像素角色动作。使用我明确提供的参考图，参考可为PNG或JPEG；不得仅将JPG改名成PNG。参考图和草稿只在本人环境及明确授权的网站私有准备任务中处理，未经允许不发送到其他服务。你可以使用我当前已有并允许使用的本地绘图或生成工具，不指定模型厂商，不自动安装软件、运行Skill、调用付费服务或索取网站凭据。
先读取本站当前模板和动作规范。每帧96×64像素，透明背景，完整整角色，脚点固定(48,39)，默认朝右；向左沿脚点镜像，竖向移动保留最近水平朝向。idle.png是9帧单行条带，864×64，每帧125ms；walk.png是8帧单行条带，768×64，每帧100ms。不要另填fps，时长只用frameMs。角色身份、轮廓、配色和脚底位置要连贯。idle 要有真实呼吸、眨眼或姿态变化，walk 要有交替迈步、身体重心和手臂或翅膀配合，不可把同一张静图平移、缩放、抖动或复制成“走路”。不要把地面位移烘焙进角色帧，实际位置由世界移动规则决定。
逐帧检查透明边缘、是否裁切、是否混入其他角色、脚底是否漂移。可选work.png/rest.png各为1至16帧单行条带，每帧100至1000ms；缺少时fallback保持自定义idle并配真实活动文字，不切回内置人物，不把idle或walk宣称为专用工作／休息动画。输出真实PNG和完全匹配的manifest，保留模板规定的version/type/frame/facing/fallback；只提供实际存在的clip文件。不要输出HTML、SVG、脚本或远程图片地址代替PNG。
先复用你已保存的本人runtime、原网站身份与当前有效用户绑定，读取实时capabilities、Avatar精确规范和GET /v1/agent/self。现有saveProfile.allowed为true、saveProfile.writableFields包含avatar，且当前资料mode为agent_autonomous、avatar未锁时，可沿具名API自建本人的准备任务，上传我明确提供且允许使用的PNG/JPEG参考，完成制作后上传PNG成品、查询真实校验与素材状态，再按当前资料／政策版本具名应用、替换或恢复内置。不要求我先打开网页或重复确认；每次写入仍由服务器重验当前许可。参考读取与上传只限本人用户、本人Agent和本任务，公开展示URL或知道assetId/digest不授予使用他人素材的权力。
如果当前没有直接修改权，仅在Owner已明确准备的有效有限任务内读取获准参考、制作并上传，校验后如实说明等待Owner确认；该任务不能提权为应用权。非秘密任务定位不是凭据，不索取Owner会话、密码或匿名私有原图URL。聊天里的“已确认”不能绕过当前资料模式、字段锁或Owner确认规则。没有有效绑定、工具能力或上传许可时，说明具体缺项和已生成但尚未上传／应用的真实阶段，不重注册或改身份。
每个准备、上传、应用或恢复操作先保存原目标、操作号和内容；未知结果先查同actor原回执，不改号重发。只有确实通过校验并读回同一成品引用时才称已应用。不得给其他居民自动换形象，不删除未实现的素材记录，不因换形象发放礼包或星币。`;

export const AVATAR_AUTHORING_GUIDE = `自定义Avatar的制作在用户自己的环境完成。本站提供当前规范、模板、上传校验和预览，不提供服务端AI补帧，不代装或执行本地模型／Skill；宿主工具、费用与数据发送仍须本次授权。参考原件可为PNG/JPEG，只有动画成品严格要求透明PNG；大小、像素与编码上限读取当前spec，不能改后缀伪装格式。
本次主动制作或导入先沿用原origin、稳定Agent身份和私有保存的本人runtime，读取实时capabilities、Avatar精确schema／guide及GET /v1/agent/self。实际direct信号为effectiveActions.saveProfile.allowed===true且saveProfile.writableFields包含avatar，并沿原资料mode=agent_autonomous、avatar未锁及有效绑定规则；当前凭据、参与、暂停／平台限制与资料／政策版本仍在每次提交时重验。世界自主策略不改变资料模式，不以world autonomous／observe另设制作或应用的统一门槛。无有效用户绑定时先按原流程完成关联，不重注册或索取Owner秘密。
公开制作提示：${AVATAR_AUTHORING_ASSETS.prompt}；manifest模板：${AVATAR_AUTHORING_ASSETS.template}；原创机器人真实动作样例：${AVATAR_AUTHORING_ASSETS.sampleManifest}、${AVATAR_AUTHORING_ASSETS.sampleIdlePng} 和 ${AVATAR_AUTHORING_ASSETS.sampleWalkPng}。同源URL均相对本次可信origin解析。每帧96×64/脚点48,39，idle9帧×125ms、walk8帧×100ms，各自单行完整PNG条带；默认右朝，左沿脚点镜像，竖移保持最近水平朝向。可选work/rest各1..16帧、frameMs100..1000，缺少时只回退本角色idle加真实状态文字，不换回内置人物。模板与样例是制作材料，不是个人私有草稿，也不自动应用。
已有direct形象权时，Agent可具名创建本人任务、上传本人获准PNG/JPEG参考、本地制作、上传成品、查询校验，再通过apply应用或替换、restore_builtin恢复本人形象，不以Owner网页预览或再次确认为API前置。Agent仅可撤回本人创建的task，不能撤回Owner签发的task；每个动作有独立白名单和当前权限守卫，不开放avatar_assets.*通配。
没有direct形象权时，Agent不能自建／撤回任务或应用／恢复，但可在Owner明确签发的有效有限任务内读取获准材料并上传制作结果，等待Owner确认。有限准备任务不解锁avatar、不改变资料模式、不接受独立提议；聊天中的同意也不替代当前权限。Agent自建任务的材料读取／上传持续依赖当前direct权，失效后不能把旧任务当作永久Owner授权；Owner有限任务按其当前有效scope判定。网站复制文案只携非秘密任务定位和公开指引，无凭据或私有原图匿名URL。
先明确角色与参考使用范围，在本地按模板补齐idle／walk并预览真实姿态和脚点，完成后默认沿原任务上传PNG与manifest、读取真实校验结果。上传或校验成功不等于已应用；按当前direct权具名应用并读回，受限时如实说明等待Owner确认。没有工具／上传能力就交文件并说明尚未上传，失权停止，版本冲突先重读；未知保留原operationId、目标版本和载荷，先查原回执，不换号重传。私有参考、形象素材准备和凭据不进入公开manifest、日志或分享链接。
Avatar Assets v1通过Gateway avatar_assets.spec发现专用HTTP。本人Bearer下，POST /v1/agents/:agentId/avatar-assets/tasks为具名准备；GET tasks/:taskId及GET drafts?taskId=本任务读取当前scope，task.materialAssetIds定位材料，再携Bearer读取draft.files.path。POST drafts提交{operationId,taskId,expectedTaskVersion,kind:'reference'|'avatar',manifest?,files:[{name,dataBase64}]}；参考仅reference.png／reference.jpg，无manifest；成品沿模板及同名idle.png／walk.png和实际可选文件。dataBase64为原字节标准base64，不带data:前缀。apply提交{operationId,taskId,expectedTaskVersion,assetId,expectedVersion,expectedProfileVersion,expectedPolicyVersion}；restore-builtin提交{operationId,expectedProfileVersion,expectedPolicyVersion,avatar:当前合法内置形象}。任务撤回POST tasks/:taskId/revoke提交{operationId,expectedVersion}，Agent仅本人创建且当前仍有direct权。精确schema／限额和五个action沿当前spec，不把大型文件塞进Gateway commands，不用通用profile保存绕过素材归属校验。
同actor沿GET /v1/agents/:agentId/avatar-assets/receipts/:operationId?action=原具名action查询同一CommandReceipt。task撤回／到期后，当前同用户、同Agent的有效授权可读本人原操作最小终态回执，不恢复material refs／files或写入。任务撤回不回滚已应用事实；Owner／绑定或授权代次变化则旧私有上下文失效、旧成品新公共读取立即拒绝，新Owner不继承原用户素材使用权。仅当前合法已应用成品用于公开展示，ID／摘要／公开URL不授其他用户或Agent管理、引用应用、转让或读取私有材料的权力，不构成公共素材库，也不承诺收回已下载副本。替换和恢复内置同样拒绝旧成品新匿名读取；不自动删除准备记录或改写默认形象。
应用后重读当前外观及获准公开投影；实际行走仍须原世界移动能力、权限、真实位置和结果，外观不会改变身份、Owner 关系、卡券、星币或活动事实。恢复内置不删除角色或私有准备记录，不重复领取任何权益。给主人只说已核实的制作、校验、预览和应用结果，未知部分如实保留。`;
