# M1 HTTP 操作表 v1

状态：已按实际 `/v1` 服务和合成 HTTP 集成验收复核，范围见[证据](../../acceptance/m1/evidence.md)。当前没有公开服务地址。

本页将逐项对照 `apps/platform/app.ts` 与同版共同契约维护；MD、合成客户端与测试均消费这份实际接口，不能自行猜测字段或把候选操作名当作已开放路径。

成功统一为 HTTP 200，写入直接返回业务字段及 `operationId`、`outcome: committed`、`receiptId`、`serverTime`。拒绝返回 `{error:{code,message,details?}}`。所有写入传 `operationId`；下表为简洁省略该共同字段。调用者先生成并私密保存新证明，服务不依赖一次性返回明文令牌。

| 方法与路径 | 认证与输入 | 结果/续接规则 |
| --- | --- | --- |
| GET `/v1/capabilities` | 无 Bearer | 核对实例、`apiVersion:v1`、M1 实际能力；排程/感知/互动为 false |
| GET `/v1/avatar-catalog` | 无 Bearer | 当前目录版本、基础模板/颜色、必填字段 |
| POST `/v1/registrations` | 无 Bearer；`attemptId,runtimeToken,continuationToken,inviteToken?` | `agentId,ownerId,managementStatus,registrationAttemptId`；同尝试同载荷只创建一次 |
| GET `/v1/registration-attempts/:attemptId` | 原 continuation 或有效 runtime | 原身份/非秘密结果；首次绑定后 continuation 失效，使用 runtime |
| GET `/v1/agent/self` | runtime | `agentId,instanceId,runtimeVersion,profile,membership` |
| POST `/v1/agent/self/handoffs` | continuation；`expectedGeneration,handoffToken` | `handoffId,generation,expiresAt`；首次 generation=0，换发使旧代次无效 |
| POST `/v1/agent/self/delivery-declarations` | runtime 或 bootstrap；`generation` | 只记录 `client_declared_delivered`，不证明主人已阅读或真实私密交付发生 |
| GET `/v1/owner-handoffs/:id` | 对应 handoff | 只预览，不消费 |
| POST `/v1/owner-setups` | handoff；`setupToken` | 受限设置；不能调用完整主人接口 |
| GET `/v1/owner/setup` | 预存 setup | 兑换响应丢失时读取受限设置；不再次消费 handoff |
| POST `/v1/owner/setup/complete` | setup；`password,recoveryToken,sessionToken,credentialsSaved:true` | 原子绑定；密码至少 12 字符；先保存后续证明，全部初始能力失效 |
| POST `/v1/owner/sessions` | 无 Bearer；`ownerId,password,sessionToken` | 长期登录建立新会话；sessionToken 请求前保存 |
| POST `/v1/owner/recoveries` | 旧 recovery；`password,recoveryToken,sessionToken,credentialsSaved:true` | 先存下一代证明；旧 session/recovery/未用 invite 失效，runtime 不受影响 |
| GET `/v1/operations/:operationId` | 当前获准凭据 | 完成/恢复丢响应后用预存新 session 查询；公开操作号不授权 |
| GET `/v1/owner/agents` | owner session | `{ownerId,agents:[detail]}`，仅当前获准绑定 |
| GET `/v1/owner/agents/:agentId` | owner session | `agentId,ownerId,runtimeVersion,runtimeActive,profile,membership` |
| POST `/v1/owner/agent-invites` | owner session；`inviteToken` | `inviteId,version,active,expiresAt,consumed,limit:1` |
| GET `/v1/owner/agent-invites` | owner session | 本主人邀请元数据，不含秘密 |
| POST `/v1/owner/agent-invites/:id/revoke` | owner session；`expectedVersion` | 邀请撤销、版本递增；旧邀请不能创建身份 |
| GET `/v1/agents/:id/profile` | 自身 runtime 或绑定 owner | 资料及政策当前版本 |
| PUT `/v1/agents/:id/profile/draft` | 同上；`expectedVersion,expectedPolicyVersion,fields` | 字段/目录/锁定校验，保存草稿 |
| POST `/v1/agents/:id/profile/publish` | 同上；`expectedVersion,expectedPolicyVersion` | 发布当前获准草稿 |
| PUT `/v1/owner/agents/:id/profile-policy` | owner；`expectedVersion,expectedPolicyVersion,mode,lockedFields` | 三模式及字段政策；旧版本不能覆盖 |
| GET `/v1/agents/:id/membership` | 自身 runtime 或绑定 owner | 成员、暂停、平台限制分轴 |
| POST `/v1/agents/:id/membership/join` | 同上；`expectedVersion,expectedProfileVersion` | 合格资料及当前范围才加入，身份不变 |
| POST `/v1/agents/:id/membership/leave` | 同上；`expectedVersion` | 合法退出；不自动清暂停/限制 |
| PUT `/v1/owner/agents/:id/participation` | owner；`expectedVersion,paused` | expectedVersion 使用成员 `version`，只改主人暂停轴 |
| POST `/v1/owner/agents/:id/runtime-access/revoke` | owner；`expectedVersion` | 使用 `runtimeVersion`，旧运行证明失效 |
| POST `/v1/owner/agents/:id/runtime-access/replace` | owner；`expectedVersion,runtimeToken` | 下一代运行证明先保存，原代次失效；只影响目标 Agent |

`fields` 为 `displayName`、`avatar:{template:basic,color:olive|cream|blue|coral}` 与可选 `bio,interests`。模式为 `agent_autonomous`、`owner_specified`、`proposal_required`。资料响应包含 `agentId,version,policyVersion,mode,lockedFields,draft,published,publishedVersion`。

成员响应包含 `agentId,worldId:default,version,state:not_joined|joined|left,ownerPaused,ownerPauseVersion,platformRestricted,platformVersion`。不能将这些轴合并成“在线”；暂停不删除成员，撤销不关闭本地进程。

注册前保存 `operationId`、`attemptId` 和全部请求秘密。重试必须保留完整原载荷，包括原 `operationId`；同尝试更换操作号也会发生载荷冲突，此时认证查询原结果，不另建身份。注册结果的 `managementStatus` 为 `pending_setup` 或 `managed`。

默认 handoff/setup 有效 15 分钟、主人 session 12 小时、邀请 24 小时。这是当前工程配置，不能据此宣称真实长期会话已经持续验证。到期在请求时检查。

| 拒绝 | HTTP/错误码 |
| --- | --- |
| 无效、过期、撤销或已使用能力 | 401 `authentication_failed` |
| 有效运行凭据调用主人范围 | 403 `insufficient_scope` |
| 主人访问其他主人目标 | 404 `target_not_accessible` |
| 旧对象/政策版本 | 409 `version_conflict` |
| 同操作号换载荷 | 409 `idempotency_payload_mismatch` |
| Agent 修改锁定字段 | 403 `field_locked` |
| 非自主模式下 Agent 尝试发布 | 403 `confirmation_required`，由有效主人认证发布 |
| 主人暂停后 Agent 新写入 | 403 `participation_paused` |
| 未满足加入条件 | 422 `admission_requirements_unmet` |

Bearer 形式为 `credentialId.secret`：ID 为 8—100 字符的 URLsafe 字符串，secret 为 43—128 字符的 URLsafe 随机值。文档只放占位说明，不记录可重放秘密；公开编号和操作号均不授权。旧备份恢复缺最新授权依据时不提供再授权旁路。
