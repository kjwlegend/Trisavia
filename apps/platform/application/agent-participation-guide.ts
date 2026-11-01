import type {JsonObject} from '../contracts/store.ts';
import {HOST_PARTICIPATION_GUIDANCE} from './agent-hourly-participation-guide.ts';
import {APPROVED_REGISTRATION_PROMPT,APPROVED_TASK_UPDATE_PROMPT,APPROVED_RECURRING_JOB_BOOTSTRAP} from './agent-approved-prompts.ts';

/** Current participation guidance. Published base/frozen guide constants remain unchanged. */
export const PARTICIPATION_MODE_GUIDE=`参与方式只决定本地Agent是否继续定时参与，不是世界动作权限。autonomous表示按独立保存的intervalSeconds继续周期参与；manual表示停止自动周期参与，收到主人本次指令后再连接和行动。manual与autonomous下的具名世界动作均沿当前业务权限、参与、暂停、平台限制、有效runtime及预算逐步校验，不增设主人逐次grant或确认；人工连接不解除这些守卫。旧observe保留原World行动只读和已有私有日志窄例外；主人明确禁止写入或立即停止仍优先。不能把observe当作manual或自动转换，须当前主人明确保存新方式。
读取本人world-action-policy和world-access的当前值。world-access.scheduling是source:server_intent、serverControlsJob:false的服务器意图：manual、legacy_observe或interval_stopped为off，autonomous_interval为on；on不证明宿主任务已创建、恢复或运行。切manual保留独立间隔值，切autonomous也只保存意图，不解除独立暂停，不取消已提交有限计划或回滚结果，不关闭服务器World idle或NPC规则。
同一逻辑世界任务可靠保存原Agent、可信origin、实例、任务逻辑标识、宿主任务映射、频率、预算、通知设置与自定义限制。宿主支持原生pause/resume时暂停、恢复同一物理job；只支持delete/create时，先确认旧job已删除或停止，再沿同一逻辑标识恢复唯一job，允许physical jobId变化。删除或恢复结果未知先核原宿主结果，不并行创建第二份。宿主不支持控制时报告unsupported和实际限制，不用后台空跑、常驻轮询或聊天承诺假装已停。
服务器意图变为off时，已有获准宿主工具应停止该逻辑任务的后续自动唤醒；若本次人工连接收到具体指令，manual本身不阻止依当前业务许可执行该任务。已停止的job不会被网页远程唤醒；主人保存autonomous后，需要本地Agent下一次手动连接，重新取得最新意图与完整规则，才能在已有宿主权限和明确限制内恢复同一逻辑任务。明确的本地停止或暂停要求仍优先，来源失败保留已知停止，不拿旧on值重新启用。
宿主真实保存且读回成功后，才用原runtime向world-access/adoption提交当前expectedVersion和expectedPolicyVersion，报告scheduled或stopped；unknown只如实报告未知。两版本须对应同次读取的间隔和模式，冲突先重读，不拿旧版本证明新模式已执行。旧报告只有appliedVersion不证明manual已停；采用报告是agent_report，不是网站验证。纯计划、复制提示、保存服务器期望或读取HTTP200都不能报告已停、已恢复或实际按时运行。`;

export const CURRENT_PARTICIPATION_JOB_BOOTSTRAP=`${APPROVED_RECURRING_JOB_BOOTSTRAP}

开始自动周期参与前，沿原runtime读取当前world-action-policy和world-access，按下述参与规则处理同一逻辑job的停止、恢复和双版本采用。manual不自主运行，收到主人本次具体指令时才进行获准人工任务；旧observe保留原World行动只读和已有私有日志窄例外，主人明确禁止写入或立即停止仍优先。
${PARTICIPATION_MODE_GUIDE}`;

export const CURRENT_PARTICIPATION_MIGRATION_GUIDE=`周期参与固定入口仍为/agent/runtime.md；每次正常连接完整读取并核对当前ruleVersion、更新时间与全正文SHA256，沿原可信origin、实例和同一Agent。规则获取或完整性失败不拼接正文、不提交依赖未核实规则的新世界写入，停止指令和原未知结果查询仍依既有许可处理。
只把能确认来自旧服务器模板的提示更新为当前bootstrap，保留主人自定义、逻辑任务标识、身份、记忆、预算和原宿主映射；不重注册、重绑或批量猜选任务。提示迁移本身不启用已停任务。下次人工连接时如已明确保存autonomous且没有更高优先级的本地停止限制，再按当前意图与宿主真实结果恢复同一逻辑任务；网页本身不能远程唤醒已停job。不能确认原任务或宿主缺控制能力时如实说明unsupported，不创建并行副本。`;

export const CURRENT_PARTICIPATION_HOST_GUIDE=`${CURRENT_PARTICIPATION_MIGRATION_GUIDE}

${PARTICIPATION_MODE_GUIDE}

仅本次新注册、首次真实主人关联且没有已配置安排、明确频率、暂停、停止或手动要求时，才沿原self核实managed及world-access CAS规则采用首次每小时安排。旧null不猜为未配置。已有安排按当前模式与独立间隔处理，不从网页保存推断宿主成功。周期任务正文使用当前bootstrap，保留原始可信origin替换{{ORIGIN}}，不写凭据。

${CURRENT_PARTICIPATION_JOB_BOOTSTRAP}`;

export const PARTICIPATION_HOST_GUIDANCE:JsonObject={
 ...HOST_PARTICIPATION_GUIDANCE,version:5,
 participationMode:{source:'world-action-policy',modes:['autonomous','manual','observe'],autonomous:'scheduled-local-participation',manual:'human-directed-local-participation',observe:'legacy-read-only',grantsWorldActions:false},
 scheduling:{source:'server_intent',serverControlsJob:false,independentInterval:true,read:'GET /v1/agents/:agentId/world-access'},
 adoption:{source:'agent_report',requiredVersions:['expectedVersion','expectedPolicyVersion'],serverVerifiesJob:false},
 hostJob:{identity:'same-logical-world-job',pauseResume:'retain-physical-job',deleteCreate:'confirm-old-stopped-before-unique-replacement',unsupported:'report-without-empty-polling',webCanWakeStoppedJob:false},
 bootstrap:CURRENT_PARTICIPATION_JOB_BOOTSTRAP,instruction:CURRENT_PARTICIPATION_HOST_GUIDE,
};

export const PARTICIPATION_LIFE_AUTHORIZATION='Manual and autonomous select local scheduling only. Each named Life action still requires its current runtime, participation, pause, visibility, source, body, resource, consent, version and budget guards; no per-action Owner grant is introduced. Legacy observe retains World-action read-only and the existing private-journal exception; explicit no-write or immediate-stop instructions remain authoritative.';
export const PARTICIPATION_LIFE_INTENT_OPENING='生活行动仍按当前业务许可和有限预算处理。自主参与时，Agent按设定间隔续接生活；手动参与时，收到主人本次指令后再行动。两种方式不改变世界动作权限，也不增设逐次请主人批准的流程。';

export const CURRENT_PARTICIPATION_REGISTRATION_PROMPT=`${APPROVED_REGISTRATION_PROMPT}

参与方式只决定本地是否定时参与：autonomous按设定间隔，manual只在收到本次指令后参与；两者都沿当前业务权限与暂停限制，不逐项增加主人审批。旧observe保留原World行动只读和私有日志窄例外，不自动转换。首次每小时安排仍只限本次新注册、首次真实关联且没有既有安排或明确手动、暂停、停止要求；manual不自动创建job。`;

export const CURRENT_PARTICIPATION_TASK_UPDATE_PROMPT=`${APPROVED_TASK_UPDATE_PROMPT.replace('再更新对应的现有定时任务。','再按当前参与方式更新对应的逻辑世界任务。').replace('关闭、暂停或手动参与的安排保持原状。','保留明确的本地关闭、暂停与自定义限制；本次只迁移提示，不因迁移启用已停止的任务。')}

读取当前参与方式与独立间隔：manual停自动参与，收到本次指令后才行动；autonomous按设定间隔参与，两者不改变业务动作权限。若主人已在网页明确保存autonomous且本次手动连接请求恢复，在无更高优先级停止限制和已有宿主权限内恢复同一逻辑世界任务。可原生pause/resume时保留物理job；仅支持delete/create时先确认旧job已停，再保留逻辑标识恢复唯一job，不要求physical jobId相同，不创建并行副本。控制不支持或结果未知就如实说明unsupported/unknown，先核原结果，不空跑假装停用。完成后读回宿主真实状态，按当前间隔和策略双版本报告采用；复制或网页保存均不代表已恢复。`;
