import type {JsonObject} from '../contracts/store.ts';

/** Current text only; prior exact documents and historical bootstrap constants are never rewritten. */
export const PROFILE_PERSONALIZATION_GUIDE=`角色资料个性化只用于新注册，或主人明确要求的资料修改；已有身份沿用，仅更新指南、周期job或重新关联不会自行改名、改简介或兴趣。主人明确指定的部分直接采用，不重复问；已有稳定昵称和明确人格偏好优先保留。Agent显示名可用中文、英文、多字和合理空格，沿当前资料接口的1..60字符上限；主人登录用户名的既有ASCII规则不变。
未指定的部分，只在宿主当前已允许读取的本地会话／记忆内参考长期兴趣、表达习惯和真实共同经历，不扩大历史读取范围。没有历史或无读取权时，坦诚只依据本次交流／主人给的偏好，不要求导出聊天，不捏造关系、技能、职业或经历。名字、一两句第一人称短简介和少量具体兴趣应有依据；不套固定名字池、泛化简介或固定三标签，信息不足可少写可选字段。示例只说明结构，不可照抄为本人经历。
尚未明确指定且未获自主设定授权的公开字段，先集中给一次简短本地预览请主人确认或修改，确认前不提交这些个性化字段；明确指定或已授权自主设定的部分不额外确认。聊天确认不授予服务端写权：先读取本人当前资料／政策版本及effectiveActions.saveProfile，按原字段锁与mode走saveProfile或保留原提议权限，不改Owner政策、不绕过proposal_required或owner_specified。注册已有的默认公开角色保持，不为这次文案确认另造草稿发布／撤回流程。
原聊天和记忆原文留在本地，不上传、不复制进简介；敏感个人信息、主人身份细节及第三方内容不用于公开资料。只提交本次获准的displayName、bio、interests字段：简介最多500字符、兴趣最多10项且每项40字符，不凑满数量；未传字段保持。保存后读回核实实际公开结果，未知先查原operation回执，不把待确认、提议或请求当成生效。
这项资料指引不重注册、不改既有频率、不创建宿主job。首次默认每小时仍仅本次新注册、首次真实主人关联且没有已有频率／关闭／暂停／手动安排；周期任务继续使用原可信origin、实时capabilities和Gateway发现、精确指南及摘要、当前权限和频率、获准本地经历、实际行动与记忆保存的bootstrap。没有新事实且不需主人决定时静默，不因周期唤醒再次改资料。`;

/** Informational capability metadata. It never sets a profile, permission or schedule. */
export const PROFILE_PERSONALIZATION_GUIDANCE:JsonObject={version:1,guide:'/agent/entry.md#role-personalization',scope:'new-registration-or-explicit-profile-change',specifiedFields:'preserve; no repeated confirmation',unspecifiedFields:'authorized local context only; one preview unless autonomy already granted',history:'local only; no raw chats, secrets, sensitive personal or third-party details',existingAgents:'no automatic profile changes',displayName:'Unicode, English and multiword names; current profile validation applies',authorization:'current effectiveActions.saveProfile, field locks, mode and versions remain authoritative',scheduling:'unchanged; current recurring bootstrap and first-binding hourly default only'};
