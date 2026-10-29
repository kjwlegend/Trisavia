# 人类账号直接注册 · 2026-10-29 短合同

业务所有者：WS01。用户已授权从注册流程完全移除固定 `1234` 验证码；本页仅替代旧账号合同与功能流程中的注册 challenge／发码／验码要求。实现、检查、发布状态由 TD 回执确认，不以规则批准记为已经上线。

## 注册与权限

- 人先注册：填写用户名、邮箱、密码，一次「创建账号」完成，进入真实空态。
- Agent 私密入口：填写同样字段，一次「注册并关联」完成。最终账号、主人会话、目标绑定与交接消费在同一事务提交，失败不留可登录半成品。
- 注册不创建 challenge、不发送或校验验证码、不暗填 `1234`、不产生邮件 job，也不依赖邮件 key。未来真实邮件接入另行裁定；本次不改变密码找回或其他验证用途。
- 新账号统一为 `emailVerified=false`、`emailVerifiedAt=null`、验证来源 `unverified`。用户名与未验证邮箱仍按现有格式、规范化及唯一性校验；填写某邮箱不获得已有账号权限，也不触发账号合并。
- 已有账号仍须登录并明确确认关联目标。Agent 身份、运行凭据、私密交接、浏览器证明与目标隔离照常校验；直接注册不复活过期或已消费入口，不转让已有绑定。

## 状态与续接

- 新注册尝试对外为 `verificationMode='none'`、`status='pending_registration'`、`emailVerificationRequired=false`；capabilities 提供 `ownerRegistration:{version:2,emailVerificationRequired:false,emailVerifiedOnCompletion:false}`，不冒充体验或真实邮箱验证。
- UI 的一次创建动作可执行现有 start → final 两个命令；保留原 attempt、browser/setup 目标 proof、固定 operation 与 `expiresAt`。开始或准备完成不表示账号已创建；只有最终成功回执才展示创建／关联成功。
- 旧 `completed` 操作先返回原成功事实，不追改旧账号验证来源或时间。旧未完成注册只有在原 attempt/proof、期限与目标均仍有效且未取消、撤销或消费时，才可按新直接注册规则完成；不延期、不清除冲突，新账号仍标记未验证。
- 注册 send/verify 的新写入返回 `409 registration_verification_not_required`；原已成功操作仍可凭原证明查询或重放原回执，不能因此触发新邮件或挑战。找回密码的 send/verify 规则不变。
- 结果未知先查原回执，必要重试沿用原操作与正文，不重复创建账号或绑定；不保存明文密码。可选恢复备份不变，正常注册不增加文件门槛。

## 必须文案与落地边界

注册说明应明确无需邮箱验证码且邮箱尚未验证。关联说明使用「创建账号并关联这位 Agent」，不把原子提交表述为成功建号后另做一次绑定。准备态用「可以继续创建账号。」／“Ready to create your account.”，不提前声称完整资料已保存或邮箱已验证。

精确中英文词条由 WS07 在 account 资源落实，WS01 已核准 `registration.directIntro`、`directEmailHint`、`directLinkIntro`、`emailUnverified`、`progressReady` 及 `verifyBeforeCreate`、`emailRequirement` 两项修订。其余找回文案保持。A 负责注册前后端，TD 统一版本、固定差异审查、GitHub 与本地交付；本次没有新的 UAT 发布批准。
