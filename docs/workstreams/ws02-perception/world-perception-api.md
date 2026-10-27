# WS02 · 完整世界感知接口合同

2026-10-19 · v1.1，IR2-01／02 作者修订，待原 WS06 复核。所有下列路径／字段／JSON 均为**待实现接口建议**；本轮授权规划及现有前端交互改进，不授权整套真实感知后端。现有 [M1 HTTP](../../access/v1/http-api.md) 不改；已知 ID 公开资料、私有期望间隔、地图动效不等于本合同已实现。故事见 [01](01-user-stories.md)，对象全清单见 [world-objects](world-objects.md)，交付与验收见 [04](04-delivery-plan.md)。

## 1. 完整性的产品定义

默认范围为当前实例的 `default` 世界内，当前主体／用途有权读取的**全部已启用来源**。不要求先选附近、空间、类型或标签；`filters:{}` 即全域，非空过滤才是用户主动缩小范围。未来多世界需显式发现／枚举，不跨实例猜测。

“认识整个世界”包括世界名称／说明、当前规则及其版本、实际可用模块／接口／内容类型／来源，和统一对象目录中的全部获准居民、物品、空间、事件与已开放业务内容。每个可读对象有详情入口，可继续分段取得全部获准正文／附件说明；内部表、秘密、未获准字段不属于读取范围。

两种完成分别报告：`complete` 是指定来源切点的目录枚举完成；`contentComplete` 是某个对象当前版本的正文分段完成。读完目录不声称读完所有正文、媒体或全部历史；若 Agent 要逐一读全文，遍历全部 ref 并分别读到 `contentComplete:true`。期间撤回／失权应报告不可读，不能为满足旧快照暴露历史正文。

## 2. 通道与来源发现

| 通道／读取面 | 内容与真源 | 消费进度 |
| --- | --- | --- |
| `world` | 世界信息／规则；获准公开人、Agent、物品（作品／道具概念）、场所、活动计划、发生记录、公告；未来互动公开内容／关系、共享成长摘要、服务公开内容由对应原模块负责 | 默认全域；空间／类型／标签可选。人类网页、每个 Agent 消费端、用途分别保存 |
| `inventory` | 本人获准持有记录；持有源拥有数量／权利，物品详情仍回原物品源。不把公开作品目录变成背包，不把货币变道具 | 与 world 独立；服务端确定本人／受权观察对象，不能输入任意 ownerId 扩权 |
| `inbox` | 给本人的原创内容或派生提醒；原创有自身正文／作者／受众，派生提醒引用业务来源 | 与 world／inventory 独立；关注、网页已读／删除不推进 Agent 游标 |
| `current-items` 读取面 | 原业务仍有效的问题／邀请／订单等；与通知保留期无关。来源未开／失败不返回假空 | 独立稳定分页，回原模块确认当前状态／动作；不把读通知当接受 |
| 发现目录 | 当前允许披露的协议、世界规则引用、模块／类型／schema／来源及启用状态；不需要先接完整模块装配器才能定义来源登记合同 | 独立目录 revision，不能当世界增量断点 |

世界动态是 `world` 公告／活动／发生记录的一个显示筛选，不是人人必收的 inbox 广播。各源只交有所有者的公开读取合同；世界保存展示副本及引用，不窥他域表、不写源业务状态。私有主人、邮箱、密码、凭据、他人信件、未公开绑定不进入 world，包括计数、标题与关联边。

发现响应对每个可披露来源列 `sourceId, moduleId, types, channels, state, schemaRefs`。`state` 为 `enabled/not_enabled/unavailable`：未启用是无真实读取能力，不是数量为零；已启用但故障是覆盖不完整。源名本身无权披露时也不返回。预留领域只列产品方向，不捏造居民／余额／存量。

## 3. 拟议 HTTP 清单

以下入口均位于可信同源 `/v1/perception`，接受 opaque Bearer 格式 `<credentialId>.<secret>`；这仅复用格式，不自动给现有 runtime 新权限。未来作用域由 WS01 与 WS02 接口 owner 联合确认。runtime 读自己；人类会话只能读当前明确获准的视图，管理绑定不自动取得 Agent 私信。D1 匿名真实范围未定，不能默认开放此目录。

| 方法／路径（全部待实现） | 输入要点 | 返回与 owner |
| --- | --- | --- |
| GET `/discovery?limit=50&pageToken=…` | 首次无 pageToken；支持协议 major；同基线分页 | `catalogRevision,worlds,modules,types,sources,operations,schemaReader,guideReader,nextPageToken,complete`；WS02 发布来源目录，模块提供自己的合同；基础模块可用性复用 WS06 |
| GET `/schemas/:schemaId?version=1` | 仅可信目录登记的精确 ID／version，编码为单个路径参数 | 受审 JSON Schema 数据；不取任意网络 `$ref` 或执行代码 |
| GET `/guides/:moduleId?version=1` | 可信目录中的精确模块／说明版本 | 前置条件、每步能力引用、完成／停止／恢复方式；模块 owner 提供 |
| POST `/overview` | 公共请求字段、可选 scope，默认全域 | 世界名称／说明／当前规则引用、已启用来源／类型及可披露计数／新鲜度；概览数不作快照页总数承诺 |
| POST `/snapshot` | 公共字段；首读无 pageToken，续页用原 token | 统一对象摘要页、固定切点、末页 checkpoint |
| POST `/changes` | 公共字段＋已保存 `checkpoint`；续页再带 pageToken | 固定目标切点的 `upsert/remove`；末页新 checkpoint |
| POST `/detail` | `protocolVersion,channel,purpose,consumerId,ref,knownVersion?,contentToken?` | 当前受权字段／正文／附件说明／动作引用；长内容有独立续页和 `contentComplete` |
| POST `/current-items` | 公共字段，`channel:current-items`；固定事项来源集合，首读无 pageToken | 原业务当前事项及来源状态；独立稳定分页，不从旧通知推算，不依赖 inbox 投递源已启用 |
| POST `/reader-state/query` | 人类当前授权；`protocolVersion:1,surface,ref`，一次一个 ref，无任意 reader／owner／Agent 选择字段 | 读取本人该 surface／ref 的 `stateVersion,contentVersion,read,hidden,currentContentVersion`；无记录返回默认态，隐藏项仍可按当前权限查询；详见 §7 |
| PUT `/reader-state` | 人类当前授权；`protocolVersion:1,operationId,surface,ref,expectedStateVersion,contentVersion?,read?,hidden?`，至少有 read／hidden 之一；`read:read` 必须 contentVersion | 条件更新本人列表状态，返回 `operationId,surface,ref,stateVersion,contentVersion,read,hidden`；同 operationId 同载荷重试取原结果，不重复写入；与 Agent 数据进度无关 |

“公共请求字段”是 `protocolVersion:1,channel,purpose,consumerId,scope?,limit?,pageToken?`；scope 省略等于 `{worldId:"default",filters:{}}`。过滤仅接受目录声明的 `spaceRefs,types,tags`，不支持随意 SQL／未声明谓词。limit 建议默认 50、上限 200，并有响应字节／扫描上限；数值是可调整的技术建议，不能偷偷截断后报完整。详情与大对象也受预算限制，通过分段完成读取。

`consumerId` 是客户端本地生成并可靠保存的消费端标识，不是身份或权限；服务端结合实际认证主体、用途绑定。snapshot／changes 的 channel 仅 world／inventory／inbox；current-items 使用专属读取面，不能把它的续页放入其他通道。`purpose` 是请求意图，服务端仍验证其合法性。响应统一含 `protocolVersion,instanceId,requestId,data`，读响应附当前 `permissionVersion`。现有 M1 严格 schema 不接受这些新字段，不把它们发给旧路径。

## 4. 稳定分页与断点规则

1. 首页固定已启用且获准的来源集合、`sourceSetVersion`、scope／权限／协议与投影版本，以及每源已连续应用的提交水位，组成 `cut` 向量；不承诺跨域同一时刻原子快照。eventId／最大自增 ID／时间不是连续覆盖证明。
2. 每源对象内容和应用水位必须同提交；用有期限的物化页集或等效稳定来源快照，确保每页对应冻结切点。不能只固定 token 却继续查询任意变化中的当前表；不跨 HTTP 请求长期占用数据库事务。
3. 首期选择**整视图完成后才提交断点**：任一已启用来源失败，不发该视图新 checkpoint、不返回假空／假完整，保留旧进度并重试该页。其他通道可以独立成功。未启用源单独列明，不混进已覆盖来源或用演示凑齐；这比首期增加部分来源断点合并更容易验证。
4. 每页重验当前身份／用途／阅读权限／模块状态；影响结果的权限、来源集合、过滤或协议变化，旧页失效、清理受影响暂存后重建。公开计数／存在性也执行当前权限；敏感记录不能借旧 cut 留存。新增来源重建包括该来源已经存在的对象，不只订阅以后事件。
5. snapshot／changes 中间页 `nextPageToken` 非 null、`complete:false,checkpoint:null`；末页必须 `nextPageToken:null,complete:true,checkpoint` 非 null。仅在所有已启用获准来源已枚举到 cut 时允许该组合；空 records 可以是合法末页，不能是被吞掉的源失败。discovery／current-items 也有稳定续页及 complete，但不签发世界增量 checkpoint；current-items 的 checkpoint 始终为 null，完成后要更新当前事项就重新枚举。
6. 本地把数据、去重键与续页／最终 checkpoint 一起可靠保存。快照逐页暂存，全部完成后再切换完整视图；delta 同样完成本批后原子提交，不用迟回页覆盖已保存新版本。同一消费视图串行；无法可靠保存只承诺每次重读当前状态，不承诺可靠增量。
7. `pageToken` 只续当前固定枚举，`checkpoint` 只启动之后增量；两者不互换、不授权。服务端绑定实例／内部恢复代次、实际主体／消费端／用途、scopeHash、权限／来源／协议与 cut；外部不提交 recoveryEpoch。签名 token 或服务端会话由技术总监选实现。
8. 从 cut 之后的变化必须连续可读，日志保留覆盖快照有效期。`page_expired` 只使本次枚举的暂存失效：changes 从最后可靠保存且仍有效的 checkpoint 重新读同通道增量；仅 checkpoint 也过期才按 `cursor_expired` 重建并标历史缺口。snapshot／discovery／current-items 则各自重启原枚举，具体见 §6。变化用 `{sourceId,eventId}` 在当前实例／消费视图／streamVersion 内去重，原对象 version 防旧值覆盖；移出过滤／撤回需 remove 或让范围失效。remove 只表示从此视图移除，不自动表示对象全局删除；存在性不准披露则重建而非泄漏墓碑。

scope、cut、源状态和页结束信号是开发合同；确切水位／快照存储算法、保留期和容量必须在后续获准实现时验证。不能证明覆盖的来源返回 unavailable，而不是先交一个只含示例的“全世界”。本地消费视图以实际主体、consumerId、channel、purpose、worldId 和 scopeHash 区分，不用一个全局游标覆盖全部客户端。

| 对象记录字段 | 类型与约束 |
| --- | --- |
| ref | `{moduleId,type,id}`，同一实例内稳定定位；type 如 `profiles.agent@1` 表示该公开类型 major，不是图标／数据库表名 |
| version／schema | version 为来源公开的正安全整数、同对象单调递增；schema 为 `{id,version}` 表示该摘要／正文结构，不以包版本替代 |
| sourceId | 本页 cut／sourceStates 内的实际读取来源；业务相关对象另用 sourceRef／relatedRef，不冒充流生产者 |
| op／eventId | op 仅 upsert／remove；snapshot 不必 eventId，changes 必须稳定 eventId；未知关键操作不确认完整 |
| summary／detailAvailable | 仅当前获准字段，正文可读时指示可取 detail；摘要不承诺已含全部正文 |

## 5. 可串联的 JSON 样例

所有 ID、人物和水位均为文档 fixture，不是服务返回。`world-meta` 负责世界说明／规则，`profiles-public` 负责允许发现的公开角色；样例省略其他未启用来源不代表它们已接入。

发现目录（下列为响应 data，目录过长按同 revision 分页）：

```json
{
  "catalogRevision":"catalog_fixture_2",
  "worlds":[{"worldId":"default","name":"示例世界","description":"接口合同样例","rulesRef":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"rulesVersion":3}],
  "modules":[{"moduleId":"world","state":"enabled","contractVersion":"1.0.0","usageGuide":{"id":"world.read","version":1}},{"moduleId":"profiles","state":"enabled","contractVersion":"1.0.0","usageGuide":{"id":"profiles.read","version":1}},{"moduleId":"inventory","state":"not_enabled","contractVersion":null,"usageGuide":null},{"moduleId":"mailbox","state":"not_enabled","contractVersion":null,"usageGuide":null}],
  "types":[{"type":"world.rules@1","moduleId":"world","summarySchema":{"id":"world.rules-summary","version":1},"detailSchema":{"id":"world.rules-detail","version":1}},{"type":"profiles.agent@1","moduleId":"profiles","summarySchema":{"id":"profiles.agent-summary","version":1},"detailSchema":{"id":"profiles.agent-detail","version":1}}],
  "sources":[{"sourceId":"world-meta","moduleId":"world","types":["world.rules@1"],"schemaRefs":[{"id":"world.rules-summary","version":1},{"id":"world.rules-detail","version":1}],"channels":["world"],"state":"enabled"},{"sourceId":"profiles-public","moduleId":"profiles","types":["profiles.agent@1"],"schemaRefs":[{"id":"profiles.agent-summary","version":1},{"id":"profiles.agent-detail","version":1}],"channels":["world"],"state":"enabled"},{"sourceId":"holdings","moduleId":"inventory","types":[],"schemaRefs":[],"channels":["inventory"],"state":"not_enabled"},{"sourceId":"direct-mail","moduleId":"mailbox","types":[],"schemaRefs":[],"channels":["inbox"],"state":"not_enabled"}],
  "operations":[
    {"id":"discovery","method":"GET","path":"/v1/perception/discovery","inputSchema":{"id":"perception.discovery-query","version":1},"outputSchema":{"id":"perception.discovery-page","version":1}},
    {"id":"overview","method":"POST","path":"/v1/perception/overview","inputSchema":{"id":"perception.overview-query","version":1},"outputSchema":{"id":"perception.overview","version":1}},
    {"id":"snapshot","method":"POST","path":"/v1/perception/snapshot","inputSchema":{"id":"perception.snapshot-query","version":1},"outputSchema":{"id":"perception.page","version":1}},
    {"id":"changes","method":"POST","path":"/v1/perception/changes","inputSchema":{"id":"perception.changes-query","version":1},"outputSchema":{"id":"perception.page","version":1}},
    {"id":"detail","method":"POST","path":"/v1/perception/detail","inputSchema":{"id":"perception.detail-query","version":1},"outputSchema":{"id":"perception.detail","version":1}},
    {"id":"current-items","method":"POST","path":"/v1/perception/current-items","inputSchema":{"id":"perception.current-items-query","version":1},"outputSchema":{"id":"perception.current-items-page","version":1}}
  ],
  "schemaReader":{"method":"GET","pathTemplate":"/v1/perception/schemas/{schemaId}","versionQuery":"version"},
  "guideReader":{"method":"GET","pathTemplate":"/v1/perception/guides/{moduleId}","versionQuery":"version"},
  "nextPageToken":null,"complete":true
}
```

这是仅两个 world 来源已启用的受限 fixture，库存／定向信件明确未启用，不代表生产全世界只有这些对象。该主体为 runtime，reader-state 是人类专用操作，不在其可调用目录；schema／guide 读取用单独绑定。实际完整目录须列全部当前获准模块／类型／来源及可用操作。规则正文通过 rulesRef 详情读取；模块特有规则也提供独立版本与引用。modules、types、sources、schemaRef、操作引用必须能互相解析；未来按完整登记夹具验证，不自动安装模块或 Skill。

overview 响应 data 示例（概览计数与快照不是同一截止时刻的承诺）：

```json
{"worldId":"default","name":"示例世界","description":"接口合同样例","rulesRef":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"rulesVersion":3,"defaultScope":{"worldId":"default","filters":{}},"catalogRevision":"catalog_fixture_2","sourceSetVersion":"sources_fixture_2","counts":{"profiles.agent@1":1,"world.rules@1":1},"coverage":"all_enabled_sources","observedAt":"2026-10-19T08:00:00Z","freshness":"unknown","notEnabledChannels":["inventory","inbox"]}
```

首次全域快照请求：

```json
{"protocolVersion":1,"channel":"world","purpose":"agent-perception","consumerId":"client_fixture_a","scope":{"worldId":"default","filters":{}},"limit":50}
```

第一页完整响应：

```json
{
  "protocolVersion":1,"instanceId":"instance_fixture","requestId":"request_fixture_1","permissionVersion":"perm_fixture_4",
  "data":{
    "channel":"world","consumerId":"client_fixture_a","scopeKind":"all","scopeHash":"scope_fixture_all","sourceSetVersion":"sources_fixture_2","readSessionId":"snapshot_fixture_1","streamVersion":"stream_fixture_1",
    "cut":[{"sourceId":"world-meta","watermark":"meta_fixture_3","projectionVersion":1},{"sourceId":"profiles-public","watermark":"profiles_fixture_9","projectionVersion":1}],
    "sourceStates":[{"sourceId":"world-meta","state":"enabled","freshness":"unknown"},{"sourceId":"profiles-public","state":"enabled","freshness":"unknown"}],
    "records":[{"op":"upsert","sourceId":"profiles-public","ref":{"moduleId":"profiles","type":"profiles.agent@1","id":"agent_fixture_1"},"version":12,"schema":{"id":"profiles.agent-summary","version":1},"summary":{"displayName":"小岚","dataMode":"fixture"},"detailAvailable":true}],
    "nextPageToken":"page_fixture_2","complete":false,"checkpoint":null
  }
}
```

续页请求重复原 channel／consumer／scope／limit，增加 `pageToken:"page_fixture_2"`。末页保持相同会话、scopeHash、sourceSetVersion、streamVersion、permissionVersion 和完整 cut；例如末页 data 中 records 给规则对象，而结束字段如下（这是片段，不能替代完整页信封）：

```json
{"records":[{"op":"upsert","sourceId":"world-meta","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"version":3,"schema":{"id":"world.rules-summary","version":1},"summary":{"title":"当前规则","dataMode":"fixture"},"detailAvailable":true}],"nextPageToken":null,"complete":true,"checkpoint":"world_checkpoint_fixture_1"}
```

本地保存两页后，下一批增量请求：

```json
{"protocolVersion":1,"channel":"world","purpose":"agent-perception","consumerId":"client_fixture_a","scope":{"worldId":"default","filters":{}},"checkpoint":"world_checkpoint_fixture_1","limit":50}
```

增量每批重新固定目标 cut，页信封同 snapshot；其记录有 sourceId／eventId，操作如下。未知 op 不能越过并确认完整：

```json
{"op":"remove","sourceId":"profiles-public","eventId":"change_fixture_10","ref":{"moduleId":"profiles","type":"profiles.agent@1","id":"agent_fixture_1"},"version":13}
```

详情请求与可分段响应 data：

```json
{"protocolVersion":1,"channel":"world","purpose":"agent-inspect","consumerId":"client_fixture_a","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"knownVersion":3}
```

```json
{"ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"version":3,"schema":{"id":"world.rules-detail","version":1},"content":{"text":"示例：内容可见不等于获准执行。","dataMode":"fixture"},"attachments":[],"actions":[],"nextContentToken":null,"contentComplete":true}
```

detail 首次返回当前获准版本，可新于目录 cut；不承诺旧快照正文永久可读。长正文的 contentToken 绑定该 ref／version／权限，版本变化返回 `content_changed`，丢弃该对象不完整正文后重读；附件清单分页计入 contentComplete，正文中的外链不是受审调用定义。已获准的大媒体通过受控资源读取绑定按需取，不强制下载全部媒体才能完成目录。

inventory／inbox 使用相同快照及增量结构但不同 channel／purpose／consumer 进度。inbox 中 ref 是信件／投递自身 ID；原创可无 relatedRef，派生提醒必须有可追溯 sourceRef／sourceVersion。inventory 的 ref 是持有记录并另指物品 ref；不以物品存在证明持有。当前事项响应沿同页信封、固定枚举基线及续页／complete 信号，records 必须有原业务 sourceRef／version／当前允许入口；其末页 checkpoint 为 null，不启动世界增量。

## 6. 权限、错误与离线恢复

| 建议 HTTP／code | 客户端下一步；均不是当前 M1 新增的已开放错误 |
| --- | --- |
| 401 `authentication_failed`／403 `insufficient_scope` | 停止该私有读取，按现有身份流程取得合法凭据；不拿公开 ID／purpose／consumerId 扩权 |
| 404 `target_not_accessible` | 详情或 reader-state 目标不存在／无当前阅读权一致处理；不返回默认态、旧标记或旧回执来区分，清掉无权缓存／提示 |
| 409 `read_scope_changed` | 权限／来源集合／过滤／关键 schema 变更，废弃相关暂存和旧续页，当前验权后重建 |
| 409 `channel_not_enabled` | 通道无真实来源；显示未启用，不能变成余额 0 或空信箱成功 |
| 409 `content_changed` | 仅该对象正文续页版本变化，重新取当前正文；不把旧正文片段拼接成完整 |
| 409 `reader_state_conflict` | 新 operationId 的 expectedStateVersion 与当前不符；本次不写入，调用本人状态查询，重新决定是否修改，用新 operationId 和读到的版本提交 |
| 409 `operation_id_conflict` | 同一人类读者在本实例复用 operationId 却改变请求载荷；不覆盖原操作、不返回另一载荷的结果 |
| 410 `page_expired` | 仅当前枚举会话过期，`resyncRequired:true,historyGap:false`；按下表重启原操作，不能一律换快照 |
| 410 `cursor_expired` | 最后可靠 checkpoint 已无法连续接续，`resyncRequired:true,historyGap:true`；重建同通道当前受权视图（默认全域、原主动过滤仍保留），明确历史缺口，另查原域当前事项；不重放业务动作 |
| 422 `protocol_unsupported` | 不懂关键 op／schema 时停止该视图推进，升级客户端；安全通用摘要可按声明存 unsupported，但不声称读懂正文 |
| 429 `rate_limited`＋Retry-After | 本地退避／减少预算，从可靠保存位置重试，不创建服务端外部调度 |
| 503 `source_unavailable` | 给可披露 sourceStates 与 retryable；本视图不前移，无新 checkpoint，重试原页；其他独立通道不受假确认影响 |

错误封套为 `{protocolVersion:1,requestId,error:{code,retryable,resyncRequired,historyGap?,sourceStates?}}`。实例／内部恢复代次改变拒绝旧 token／旧授权，清理旧视图，沿现有身份安全规则处理；不把灾备当普通离线成功恢复。

`page_expired` 的恢复只丢弃过期会话的未提交页／去重暂存，不推进或清掉最后可靠保存的 checkpoint；仍获准的已提交视图可标陈旧，失权内容不能保留展示。恢复请求都不带旧 pageToken，并重新检查当前权限／范围；若另有 `read_scope_changed`，执行其权限／范围失效规则。

| 过期操作 | 重启请求与提交边界 |
| --- | --- |
| snapshot | 同 channel／consumerId／purpose／scope 重新发首页，取得新 cut；读完并可靠保存后替换视图，不能拼入过期快照的页 |
| changes | 保留最后可靠保存的 C0；同 channel／consumerId／purpose／scope 发 `changes(checkpoint:C0)`，重新固定目标 cut 并完整补读。重读可重复返回 C0 之后仍获准的 v2、v3 事件，不得只给合并后的 v3 现状；事件去重后整批可靠提交才替换 C0。不能用暂存页／未保存末页中的候选断点重启，也不能自行改读 snapshot 跳过未提交变化 |
| discovery | 用原 discovery 无 pageToken 的首页重新枚举，取得新 catalogRevision；不生成或更新 world／inventory／inbox checkpoint |
| current-items | 同 purpose／consumerId／scope，仍以 `channel:current-items` 重发自身首页，重新取得当前事项基线；末页 checkpoint 仍为 null，不调用 `snapshot(channel:current-items)`，不更新任何数据通道断点 |

只有上述 changes 重启发现 C0 也过期，服务端才返回 `cursor_expired`；客户端随后重建同通道当前快照并披露无法补回的历史。分页会话失效本身不证明变化日志有缺口。正文 contentToken 的版本冲突仍按 `content_changed` 处理，与目录／增量页恢复分开。

断网／休眠期间不补演生活或补跑每次定时。恢复先验权、读来源目录／规则版本，再从本地 checkpoint 补读或重建。平台只保证当前请求下的授权响应、内部持久来源／投递及已定义保留窗口，不执行用户 Agent 的 LLM、工具或唤醒。现有私有期望间隔只供自身 Agent 读取；本地是否采纳、如何定时及成本由主人许可／宿主能力决定，null 不意味着平台默认替跑。

## 7. 人类状态、扩展与开发前置

### 7.1 本人状态读取与内容版本

reader-state 是 WS02 的人类列表标记，不是通用状态平台。query／PUT 都只接受 `surface:inbox|world-news` 与 `{moduleId,type,id}` ref，实际读者由认证人类会话确定；拒绝 runtime，绑定主人不自动取得 Agent 私信。每次查询、写入或回执重试先验证该 ref 当前存在、属于所选 surface 且该人有阅读权；无权／不存在统一 404 `target_not_accessible`，不附状态、内容版本或旧回执。不能靠状态表中有旧记录证明对象仍可读；普通到期而仍有历史阅读权则可查。

`POST /reader-state/query` 的 data 为 `surface,ref,stateVersion,contentVersion,read,hidden,currentContentVersion`。stateVersion 是非负安全整数；read 为 `read|unread`；hidden 为布尔值；contentVersion 是最近已读标记关联的正安全整数或 null；currentContentVersion 是来源当前获准正文版本，不能用状态写入版本代替。合法目标尚无状态记录时返回 `stateVersion:0,contentVersion:null,read:unread,hidden:false`，查询不创建记录；目标是否可读尚未知／来源失败时返回相应失败，不伪造默认态。hidden:true 仍可按 ref 查询本人状态，只隐藏人的列表呈现，不构成源撤回。

world／inbox 的 snapshot／changes／detail 不按人类 hidden 标记排除源对象。页面无本地状态重开时，先合法枚举 ref，再逐个查询本人状态；查询完成前不把未知当未读／未隐藏显示或计数。由此能恢复已隐藏项的过滤，也不需要另建隐藏对象目录。状态查询受普通请求预算约束，无分页／checkpoint，不读写 Agent 或其他人类进度。

`read:read` 写入必须带实际展示或明确标记的 contentVersion，来源须确认该版本仍获准；只记该版本。`read:unread` 写入不带 contentVersion，清空已读标记为 null；仅更新 hidden 时不带 read／contentVersion，保留原阅读标记。客户端仅在 `read:read` 且 `contentVersion==currentContentVersion` 时将当前正文呈现为已读，新正文版本呈现未读；来源更新不自行递增 stateVersion，hidden 也不自动复活。状态写入成功 stateVersion 递增，未指定字段保持；不删除源、统一目录对象或当前事项。

### 7.2 条件写入、冲突与丢响应

PUT 的 operationId 是非空不透明字符串，在实际实例＋人类读者内唯一；请求 schema 不接受任意 readerId、ownerId 或 Agent 身份字段。客户端发出前可靠保存 operationId 和原请求。服务端当前验权后先查该键的回执：同请求载荷返回**原结果 data**，不再检查旧 expectedStateVersion 或重新写入；同键异载荷返回 `operation_id_conflict`。首次操作才检查 expectedStateVersion；不符返回 `reader_state_conflict` 且不写入，客户端调用 query 重读后重新决定，用新的 operationId 提交。冲突结果也为该键保留，同键重试不突然变成成功；新决定不得修改旧键载荷。

成功时状态与操作结果同事务保存，回执在该读者状态的保存期内保留；本版不定义回执清理／旧键再利用。返回原结果只证明该次操作当时的结果，不能覆盖后来 query 读到的更高 stateVersion；需当前状态再 query。若回执已不可安全提供或读者失权，拒绝而不重执行／泄漏。请求在提交前失败、查无已提交结果时，同键同载荷可按首次规则重试；不凭超时猜测成功。状态与回执均不含源正文，Agent 进度不参与此事务。

人类发现目录的 operations 必须列以下两个绑定（这是**人类目录片段**，与 §5 runtime fixture 分开，不是新增世界来源）；schemaReader 按精确 id/version 提供对应输入／输出 schema。query 输入仅含 protocolVersion、surface、ref；PUT 输入及可选字段约束按上文；schema 拒绝未声明字段，read 输出为上述完整状态、写输出为操作原结果，均套 §3 响应信封。人类获准真实来源未启用时不宣称能读写状态；演示不调用它们。

```json
{"operations":[{"id":"reader-state-query","method":"POST","path":"/v1/perception/reader-state/query","inputSchema":{"id":"perception.reader-state-query","version":1},"outputSchema":{"id":"perception.reader-state","version":1}},{"id":"reader-state-update","method":"PUT","path":"/v1/perception/reader-state","inputSchema":{"id":"perception.reader-state-update","version":1},"outputSchema":{"id":"perception.reader-state-result","version":1}}]}
```

以下是**文档请求／响应轨迹 fixture**，不是接口执行。人类 A／B 两页属于同一读者；ref 取 §5 的规则对象，此例假定它也是当前获准 world-news 公告。response 的 data／error 套统一信封，省略的 requestId 每次不同；本例 currentContentVersion 始终为 3。第 1／2 步表示两页初读相同默认态，第 5 步后 B 重新决定只隐藏；第 7 步的服务器响应丢失后第 8 步取回原结果，最终第 9 步模拟无本地状态重开读取。

```json
[
  {"step":1,"page":"A","method":"POST","path":"/v1/perception/reader-state/query","request":{"protocolVersion":1,"surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"}},"status":200,"data":{"surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"stateVersion":0,"contentVersion":null,"read":"unread","hidden":false,"currentContentVersion":3}},
  {"step":2,"page":"B","sameQueryAsStep":1,"status":200,"sameDataAsStep":1},
  {"step":3,"page":"A","method":"PUT","path":"/v1/perception/reader-state","request":{"protocolVersion":1,"operationId":"read_fixture_a","surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"expectedStateVersion":0,"read":"read","contentVersion":3},"status":200,"data":{"operationId":"read_fixture_a","surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"stateVersion":1,"contentVersion":3,"read":"read","hidden":false}},
  {"step":4,"page":"B","method":"PUT","path":"/v1/perception/reader-state","request":{"protocolVersion":1,"operationId":"hide_fixture_b0","surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"expectedStateVersion":0,"hidden":true},"status":409,"error":{"code":"reader_state_conflict","retryable":false,"resyncRequired":false}},
  {"step":5,"page":"B","sameQueryAsStep":1,"status":200,"data":{"surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"stateVersion":1,"contentVersion":3,"read":"read","hidden":false,"currentContentVersion":3}},
  {"step":6,"page":"B","decision":"重读后仍决定隐藏，保留 A 的已读标记；创建新 operationId"},
  {"step":7,"page":"B","method":"PUT","path":"/v1/perception/reader-state","request":{"protocolVersion":1,"operationId":"hide_fixture_b1","surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"expectedStateVersion":1,"hidden":true},"status":200,"data":{"operationId":"hide_fixture_b1","surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"stateVersion":2,"contentVersion":3,"read":"read","hidden":true},"responseLost":true},
  {"step":8,"page":"B","sameRequestAsStep":7,"status":200,"sameDataAsStep":7},
  {"step":9,"page":"fresh","sameQueryAsStep":1,"status":200,"data":{"surface":"world-news","ref":{"moduleId":"world","type":"world.rules@1","id":"rules_fixture_1"},"stateVersion":2,"contentVersion":3,"read":"read","hidden":true,"currentContentVersion":3}},
  {"step":10,"page":"fresh-after-permission-loss","sameQueryAsStep":1,"status":404,"error":{"code":"target_not_accessible","retryable":false,"resyncRequired":false}}
]
```

上例 `sameQueryAsStep/sameRequestAsStep/sameDataAsStep/responseLost/decision` 仅为轨迹记法，不是 API 字段；重复查询完整复用第 1 步方法／路径／请求。丢响应重试完整复用第 7 步方法／路径／原载荷，结果仍为 stateVersion 2，不变成 3。若其后有新操作得到版本 3，再重试第 7 步仍取回原版本 2，当前状态须 query；失权后重试同样按 404 拒绝，不返原结果。

### 7.3 本轮演示与后续扩展

本轮未接真实信箱时前端不请求上述待实现读写接口；按 WS07 本轮设计，以独立浏览器命名空间保存示例标记与必要界面位置，正常重开／刷新保持，按 origin／实际实例／经验证主人／受权 Agent／来源隔离，访客另域。未验证前不预显，退出／切换先清可见旧上下文；不存秘密或真实正文、不清其他存储，存储失败才退为本页并提示。删除的 10 秒撤销只恢复本人演示列表原状态，刷新续剩余时间，不重置期限或复活源正文；不冒称服务端持久化。

每个新来源交稳定 ref、公开 schema、当前权限、快照／后续变化及水位覆盖能力、详情／当前事项、停用／撤回处理。模块／类型／来源目录 revision 变化可被下次主动检查发现；首次／说明版本变化／引用失效时重读精确版本 guide 和 schema。新来源纳入 sourceSetVersion 后重建全域，旧类型更新走增量；未知新类型通过已懂的通用 upsert/remove 接收安全摘要并标正文未支持，未知关键语义不确认完整。不要求核心或 Node 按业务名硬编码，也不需要先建设完整运行时插件框架。

技术总监后续验证来源稳定快照、连续提交水位、权限撤回屏障、字节／扫描预算、日志保留与快照寿命、token 绑定、本地原子保存和客户端版本支持。真实源缺失先报告 not_enabled；合成 provider 仅用于明确标记的隔离契约验证，不能冒充真实世界验收。唯一任务／验收清单见 [04](04-delivery-plan.md)；本文件不产生第二套实施授权。

## 15. 2026-10-27：三位新NPC生活点的发现与可见性

仅衔接[M03 §10](../ws03-interaction/life-actions-v1/01-behaviors.md#10-三位新镇民与生活闭环2026-10-27首批设计冻结)的青禾`npc-gardener`、小满`npc-tea-companion`、闻溪`npc-trail-guide`；业务数值、正文、取消与到期规则归原M03。以下是后继实施字段语义，不是当前可执行接口或已发布目录，不改变080／UAT072。本节扩展§1的粗细两层及§14的权威读面，不另开任务板或完整同步协议。

### 15.1 首次发现与按需读取

Agent首次准备本轮生活任务时读当前实例capabilities／发现目录；沿Life的`life.actions`与World现有`world.npcs`／`scene.npcs`发现新身份、已启用动作和详情引用。以后按目录／规则／内容变化标记补读受影响项，不要求每轮重取全部指南。激活须同时具备真实动作、可达站位、非空版本正文及精确schema／guide；未激活只可作为明确的规划信息，不给可执行入口，不用空列表冒充已开放但无人可用。NPC忙碌／离开是已启用服务的当前不可用状态，与未激活、源故障分开。

| 读取面／现有扩展点 | 最小新增字段语义 | 读取边界 |
| --- | --- | --- |
| 原overview来源指标＋Life目录入口 | `catalogRevision/ruleVersion`、已启用且当前可参与项的稳定ref／数量、名额概况、`changeToken/asOf`与详情ref；本人条件须本人身份 | 只做选择摘要，不装正文、路线全坐标、物品实例或他人占用名单；0必须是当前有权范围内已核实的0，未查完／故障明确不完整。公开概览不包含个人冷却和参与资格 |
| `life.actions`／`life.options`及World动态NPC投影 | `npcId/placeId/pointId或routeId`、`enabled/available/reasons`、`providerState`（在场可接待／忙碌／离开）、容量／剩余名额、`definitionVersion/stateVersion`；详情给真实位置／接近区和地图版本 | 复用当前options的资格／成本／恢复预览，按需取得时长、费用与体力预留／实际消费规则、取消代价、截止、正文ref及原结果查询ref；公开点状态与本人资格分别判权，读到可用不保证抢位成功 |
| Life现有query分发／来源引用的点、路线与正文详情 | 点状态、路线有序两点／各点版本／当前可达性；`contentRef/version/digest`及获准完整正文 | 具体新增query名与schema由TD冻结并随实际能力发布，不杜撰URL或把话题伪装成书籍；正文归WS03，位置与可达格归World／设计实装 |
| `life.state`／`life.activities.get`／`life.plans.get`及原Behavior来源适配 | 原操作引用、阶段、实际成本／效果、已完成与未完成部分、终态原因、实际结果引用；路线完成与回访结果分列 | runtime只读自身；Owner只观察当前绑定且发生时／当前均获准的最小结果，不能代执行或读Agent私有感受、所选私密话题和交流正文；公共日志仍按原入选／去重／10与30条上限 |

**既有scope接入。** 三种获准生活可由原`life.activities.start`／`life.plans.submit`及对应get／cancel承载，无须WS02另造执行scope；新增具名`actionId`及plan步骤仍须WS01原模式／动作许可、本人明确意图和逐步授权代次校验。旧通用start／plans许可不自动放行未知动作，Owner仍只观察／复制；若作者发现某步超出现有许可，由WS01裁定该具体缺口，不以此表扩大真人权限。既有World21／Life4精确文档保留；后继current接口和schema由TD／A／B按实际启用落实，未激活不提前发布。

### 15.2 三类点的公开状态与本人结果

| 对象 | 公开／人类可观察事实 | 本人细节与更新语义 |
| --- | --- | --- |
| 青禾／松荫漫步园两照料点 | 每点`careKind/available/nextEligibleAt`、真实空闲／使用／冷却状态、名额、`instructionRef`与正文版本、上次完成的`lastCareAt`与本轮已浇水／已清理；青禾介绍是否可用另列。公开`nextEligibleAt`只表示点级时间限制，不含任何居民的个人冷却；公众不读正在照料者的私人任务 | 本人options给点冷却与本人重复参与限制合算后的`nextEligibleAt`及原因；时间到不保证NPC、身体、名额或体力已可用。资格／体力预留及取消结算沿M03 §10原值，结果给实际体力结算和完成／部分／取消。源事实保留真实`actorId`，公开照料者引用仅在发生时及当前均许可时附带，否则省略身份、不泄漏私有ID。点恢复可参与不重写上次事实，不生成一次新照料或虚构植物状态 |
| 小满／原酒馆外场陪坐 | 真实在场／忙碌／离开、是否能同时取得原有两席及NPC身体；公共活动仅显示获准的用餐／陪坐阶段，不列居民食物实例、选择话题或感受 | 本人预览自有食物与实际恢复，纯陪坐独立可选；取得的话题正文按版本及原内容权限读取。食用完成而陪坐取消时分别返回真实食用结果和未完成陪坐，安静只记同坐。公开有限话题目录不等于公开某个Agent的选择、交流或接待历史 |
| 闻溪／东岸外街两条路线 | 公布“树荫到河湾”“街边慢走”的稳定route引用、顺序两点、公共导览版本及当前可达性；介绍／回访处的NPC状态独立读取，不占公共停留区为座位 | 本人按原计划读两个到访结果、路线完成／部分／到期及可选回访；走完而闻溪不在时为路线已完成、尚未交流，不要求重走。公开路线定义不公开居民进行中的行程、停留进度、收藏或回访话题；公开完成摘要仍须原来源授权。收藏沿routeId＋版本，不因反复读取增地点数 |

**更新与撤权。** 目录／规则版本、正文版本与运行状态版本分开；`changeToken`只表示有权读面需重取，不是全世界checkpoint、已读或业务完成证明。只读不发起介绍、不占位、不推进到期任务、不确认内容。本文所称同版本已读／已取得只能来自真实取得或确认凭据，无凭据则未知，不等于理解。详情和原结果每次重验来源及主体权限；内容撤回／地图失效返回真实不可用原因，原部分结果仍按权可查，不静默换新路线／新正文覆盖旧回执。换Agent或撤权清除旧私有缓存。公共照料牌只展示获准当前点状态，不能借其绕过日志上限枚举所有照料者历史；新NPC自己的生活不重新灌入公众日志。

交TD的必要检查仅为：首次可发现与未激活不可执行、忙碌／离开及名额失效、两类照料的本人资格与公共身份脱敏、食用后取消陪坐、路线部分／到期及完成后未回访、正文改版与跨Agent撤权。沿原结果适配核对，不新增独立报告或改业务数值。
