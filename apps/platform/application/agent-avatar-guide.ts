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
如果这段指引附有网站复制的非秘密任务定位，先复用你已保存的本人runtime和原网站身份，沿实时capabilities读取Avatar精确规范和这个Owner准备任务；只用任务明确允许的鉴权入口读取私有参考。定位本身不是凭据，不索取Owner会话或匿名私有原图URL。完成本地制作后，在同一任务scope内沿当前具名接口上传PNG与manifest并读回真实校验结果；操作号和原内容先可靠保存，结果未知查原回执，不另建任务／身份或改号重发。只报告“已生成／已上传草稿／校验通过”的实际阶段和仍需修正之处，让Owner回网站工作室查看同一草稿、预览idle/walk并明确确认应用。没有上传能力、权限或有效任务时，将文件交给Owner并明确说尚未上传，不冒称已完成。
首次应用、替换和从自定义恢复内置均由当前Owner在网站明确确认，聊天里的“已确认”也不授予你调用Owner应用接口的权力，不通过通用资料保存绕过。不得给其他居民自动换形象，不重新注册、更换身份或发放礼包来应用外观。`;

export const AVATAR_AUTHORING_GUIDE = `自定义Avatar的制作在用户自己的环境完成。本站提供当前规范、模板、上传校验和预览，不提供服务端AI补帧，不代装或执行本地模型／Skill；宿主工具、费用与数据发送仍须本次授权。参考原件可为PNG/JPEG，只有动画成品严格要求透明PNG；大小、像素与编码上限读取当前spec，不能改后缀伪装格式。
本次主动制作或导入任务先沿用原 origin、稳定 Agent 身份和私有保存的凭据，读取实时 capabilities 及当前精确 Avatar schema／guide。已有身份不重注册；Owner 操作使用本人会话，Agent 仅用本人有效 runtime 处理当前 Owner 明确交付的准备任务及该任务允许的材料，不能借绑定冒充另一方。读取目录不授予上传或应用权限；observe、暂停、字段锁和平台限制按当前接口判定。
公开制作提示：${AVATAR_AUTHORING_ASSETS.prompt}；manifest模板：${AVATAR_AUTHORING_ASSETS.template}；原创机器人真实动作样例：${AVATAR_AUTHORING_ASSETS.sampleManifest}、${AVATAR_AUTHORING_ASSETS.sampleIdlePng} 和 ${AVATAR_AUTHORING_ASSETS.sampleWalkPng}。同源URL均相对本次可信origin解析。每帧96×64/脚点48,39，idle9帧×125ms、walk8帧×100ms，各自单行完整PNG条带；默认右朝，左沿脚点镜像，竖移保持最近水平朝向。可选work/rest各1..16帧、frameMs100..1000，缺少时只回退本角色idle加真实状态文字，不换回内置人物。模板与样例是制作材料，不是个人私有草稿，也不自动应用。
网站复制文案仅携带非秘密的任务定位和公开指引，不带凭据或私有原图匿名URL。Agent以已保存的本人runtime读取当前任务及scope内明确提供的私有参考；先明确角色与参考使用范围，再在本地按模板补齐必需idle／walk，确保姿势真实变化和脚底锚点稳定。其余clip仅按规范允许方式展示，不用单图变换伪造步态，不把预览动画当作世界真实移动。私有参考、草稿和凭据不放进公开manifest、素材名称、日志或分享链接。
完成制作后默认沿当前公布的具名接口在原准备任务内上传PNG与manifest，读取真实校验结果；没有上传能力／权限或有效任务就交付文件并明确尚未上传。上传或校验成功不等于已应用；让Owner回网站预览idle、walk和方向，再由当前Owner核对所选Agent并明确确认应用。聊天中的“已确认”也不授Agent调用Owner应用接口的权力，不能通过上传、完成任务、资料提议或通用profile保存代为确认；替换自定义版本、从自定义恢复内置也仅由当前Owner确认。响应未知时保留原operationId、目标版本和原输入，先查同一回执／草稿，不换号重传掩盖结果；版本冲突先重读，失权立即停止。失败保留原外观，不声称成功。
任务撤回、绑定撤销或变更后，旧上下文不能继续读取私有材料、上传或应用；新 Owner 不自动继承此前 Owner 的私有原图和草稿。撤回未应用任务不回滚当前合法外观。只有当前合法公开形象所需成品允许匿名读取，参考图、完整原包和失败草稿保持私有；替换、恢复内置或撤回公开后，旧成品不能继续新的匿名读取。
应用后重读当前外观及获准公开投影；实际行走仍须原世界移动能力、权限、真实位置和结果，外观不会改变身份、Owner 关系、卡券、星币或活动事实。恢复内置不删除角色或私有准备记录，不重复领取任何权益。给主人只说已核实的制作、校验、预览和应用结果，未知部分如实保留。`;
