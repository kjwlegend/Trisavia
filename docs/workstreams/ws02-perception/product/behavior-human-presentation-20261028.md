# 0114 行为日志人类表示最小合同

2026-10-28，WS02。依据已批准的 `site-bilingual-architecture-20261028.md` §6；供 B 实现只读投影、A 接线。范围是现有获准系统事实的中英呈现，不修改原事件、日志入选规则、Agent 协议或居民自述。核对点：`behavior-log-service.ts:92–174`、`agent-gateway-behavior.ts`、`behavior-log-reader.js`；本合同不是运行／UI 验收结论。

## 1. 单次读取路径

建议固定为独立 human-only 入口，不加入 Agent capabilities、schema／guide 或机器摘要：

| 人类入口 | 复用的原读取与输入 |
| --- | --- |
| `GET /v1/human/behavior/world` | `behavior.public_world`；原 `worldId/timeZone` |
| `GET /v1/human/behavior/recent` | `behavior.public_recent`；原 `agentId/timeZone` |
| `POST /v1/human/behavior/owner-history` | 当前 Owner token、原 `behavior.owner_history` 输入及 human-inspect 上下文；同一认证、绑定和来源权限 |

页面用上述入口替换一次原日志请求，不先取原日志再补取表示。B 在同一次服务执行中收集投影草稿，复用已取得的 `row/described`；不得重调 `ownerHistory`、`describeBehavior`、当前目录或另查价／姓名补数。原 `/v1/world/logs`、`/v1/world/agent-logs`、gateway operation、strict 输出和旧 decoder 原样保留。新增入口使用独立 strict decoder，组合原 decoder 校验原响应。只读、no-store、现有取消／身份代次／错误语义不变。

**完成顺序：**原入选／`visible`／来源许可 → 原 `item` 全部字段过滤（含 participants 与最后 `worldOnly` Town 删减）→ 从最终允许表达的事实生成表示 → 同次返回。内部判别值可选择与当前已显示结果等义的模板，但不返回原 `resultCode/sourceRef` 等新增业务字段；被最后删掉的内容也不能藏进模板 ID、参数、原因或 sourceRefs。世界上限 30、recent 10、Owner 50及原排序、扫描、日期、游标与 coverage 不变；不重新放入被抑制的移动／邀请／开始节点。

## 2. 独立 envelope 与叶字段

```ts
type HumanBehaviorReadV1 = {
  schema: "behavior-human-read"; version: 1;
  original: ExistingBehaviorReadEnvelope; // 原完整响应，不向其 data/item 添字段
  presentations: Array<{
    recordId: string; // 必须等于 original.data.items 中唯一一项的 id
    basis: "authorized-read-projection";
    sourceRefs: [{recordId: string}]; // 只能引用本项已公开的同一个 recordId
    fields: {title: Leaf; action: Leaf; result: Leaf; summary: Leaf | null};
  }>;
};
type Leaf =
  | {kind: "template"; templateId: string; templateVersion: number;
     paramsSnapshot: AllowedTemplateParams}
  | {kind: "original"; sourceLocale: "zh-CN";
     reason: "insufficient-source" | "unsupported-template"}
  | {kind: "verbatim"};
```

`summary` 只绑定 `details.summary`，原 details 为 null 时必须为 null；其余三个叶只绑定同名原字段。表示数量及顺序与原 items 一致，recordId 不缺失／重复／越项；不得覆盖 source、ID、日期、分组、金额原字段、跳转引用或 authored。原文叶从 `original` 取已有字符串，不复制或替换原摘要。`verbatim` 专用于含居民原作的叶，如 authored title；不能给它标“简体中文”。`authored.text` 永远走原文，系统框架标签仍可译。

每个已知 templateId/version 有固定参数键／类型／必需集，禁止透传整个 details 或任意对象。ID 为 ASCII 点分语义名、1–120 字符；版本为 1–2^31−1 整数，本批从 1 开始。参数对象最多 24 键；参数名 1–64 ASCII 字符。允许值仅：安全整数（金额可有符号，次数／数量非负）、布尔、受定义约束的枚举、≤240 字符原样显示文字，以及最多 20 项的 `{name:string,quantity:positiveSafeInteger,role:approvedRole}` 数组；书名／地点／姓名沿原更小上限，不能以新上限放宽原数据。`role` 限 bought/sold/caught/consumed/created/released/sent/received。缺失不是 0，null 不是空字符串；可选事实缺失选择明确无该事实的模板变体，否则原文。禁止 HTML、任意嵌套 JSON、用户文字作 ICU 模板。

单项 presentation ≤8 KiB，human 响应 ≤512 KiB；超过表示预算的叶退回 original，不另查数据或改变原分页。模板目录声明每个叶允许的参数与语义；A 只绑定这些叶，不扫描／替换任意中文。未知但结构合法的模板／版本或缺译文：展示原字段并标“原文（简体中文）”；已知模板参数结构坏、重复 recordId、越权字段或 envelope 坏：拒绝响应，不能当作无记录或静默放宽 decoder。

这里的 paramsSnapshot 是**本次获准读取的固定表示参数**，不是伪造的发生时事件快照；不回写历史。发生时金额／结果／版本沿原持久事实。当前 `readPublicAgent` 名称以及 Life `catalog(ctx)` 地点名称仅保留该次原样显示值，不声称为历史名称，不查今天英文目录改写。物品名没有可证明冻结来源／内容版本时保留原名，不能只凭 itemId 选今天译名。需要“当时名称”才能成立但没有来源的叶退 original。今后持久化新事件模板的方案另按架构 §6 实施，本片不新增事件字段。

## 3. 可直接实施的映射库存

以下均先满足原入选及当前受众；ID 前缀统一 `behavior.`，表内每个节点／明确分支对应独立模板，版本 1。title/action/result/summary 分别注册叶，不能由英文 result 反推别的字段。

| 模板族／确定性判别 | 允许参数与真实来源 | 边界／不足来源回退 |
| --- | --- | --- |
| `public.town-service.completed`：world 模式，最终 Town generic 分支 | 仅最终 `details.location.to.name`（有／无地点两变体） | 只说完成一次镇民服务；禁止 serviceId、NPC、话题、券、金额、礼包与私有 initiator。recent 不自动套这个 world-only 分支。 |
| `public.life.<node>`：WS03 worldTemplate 的 work.completed、fishing.finished、meal.completed、rest.completed、reading.completed、visit.completed | 当前可见 actorName、最终 placeName，原样插值 | 原 worldTemplate=null 的交易、加工、打断、赠礼等仍不公开；fishing 只“结束这次钓鱼”，reading 只“读了一会儿书”，visit 沿原 recorded/cooldown，不改称进入建筑。 |
| `public.life.care.completed` | 原来源确已许可的完成节点、最终地点 | 仅一轮照料；不推定他人参与、物品或收益。介绍节点不能变成完成。 |
| `owner.life.purchase/sale.completed` | 同次 `details.journal.items` 中 bought/sold 名称数量；journal.moneyDelta 或已冻结 trade.moneyDelta/quantity | 购买／出售由 node 与 action/role 一致判别，支出和收入符号需一致；不得用当前单价乘数量。未保存品名可用具名“品名未记录”变体，不补名。 |
| `owner.life.fishing.finished` | 同次 life.fishing 的 requestedCasts、completedCasts、noCatchCount、actualCosts/refundedCosts，以及获准 journal caught | completed<requested 仅说明提前停止；0 鱼获可明确说没有鱼获。只带原摘要已表达的量；新增成本细节仍留原 details，不借翻译扩写。没有 f 不从中文拆数字。 |
| `owner.life.work/rest/care/meal/read/visit.<node>` | 同次 journal 的实际 moneyDelta/energySpent/energyRestored、角色明确的 consumed/created 等；life.coinReward；原 book 的 version/title/digest；原 visit.recorded | 列出已有事实。无值不补零／奖励；meal.prepared 不等于吃下，reading.completed 不等于读完或理解全书。book body 不入表示；照料介绍不等于完成照料。 |
| `owner.life.activity.interrupted` | 同次 journal 的 caught/released、实际成本、退款／配额事实，以当前原摘要选用的白名单为限 | 仅“停止”及已有实际部分；无效果仍沿原过滤。stopCode 没有具名词典时不解说原因。 |
| `owner.gift.accepted.sent/received` | node accepted、同次 gift.direction、journal 的 sent/received；当前过滤后的另一参与者名字（无名用中性变体） | 只有已交付部分可说送达／收到；gift.items 是候选物品，不代替 settled journal。没有冻结品名不补今天名称。 |
| `owner.gift.declined/withdrawn/expired/unavailable` | 精确 node；已结算 journal.released | 不能把邀请／预留说成已交付，不能只凭失败状态宣称全退。原因不足保留当前原摘要，不推测对方状态。 |
| `town.greeted/service.started/completed/cancelled`（仅最终仍允许该细节的 owner/recent） | 同次已允许 serviceId、npcName/serviceName、原结构化 node；welcome.claim 仅已知 resultCode=facility_service_completed 或 service_completed 选自助／镇长分支 | resultCode 只作服务端内部选择，不出响应。未知 code 不走“否则就是镇长”；不能突破 world generic。固定回应／choice 不顺带加入模板。 |
| `owner.resident-gift.card-and-credit/card/credit` | 同次原持久事件的 resultCode；只有该事件已读取且能核对 creditAmount/cardIssued 才用对应金额／卡事实 | 私有补发，不造拜访。三个合法 code 为 resident_card_and_credit_issued、resident_card_issued、resident_credit_issued；缺原金额且要显示金额则该叶 original，不另查账／硬编码 100。 |
| `relationship/interaction.<node>` | 原已允许 node 的固定事实；如原字段未含对方则不加名字 | accepted 好友才可说双方确认；feedback.submitted 仍“已提交，未确认收到”；activity.closed 才“确认收到并结束”。不取正文、附言或今天关系状态。 |
| `authored` 与未知／旧结构 | authored 含居民文字的叶为 verbatim；普通系统叶不足为 original | 原 authored 原文、发生时间及来源关系不动，不作机器总结。未知 node/version 不猜语义；旧 movement 节点不重新入选。 |

模板派发只认显式白名单，组合不一致即回退；不得按中文摘要正则或包含词识别。`resultCode` 可在同次既有来源描述的分支处选择草稿，但最终提交必须经过 world/owner/recent 字段白名单；不得再做一次 describe。上表参数列是可用来源集合，不授权把原叶没说的全部数字加进句子。姓名、地点等 literal 参数只作显示，不能解锁来源／用户原文译文。

## 4. 仅需 WS03 的精确后继语义

当前白名单无需再等整批审批。若本片还要把 `life.activity.interrupted` 的 stopCode 翻成具体原因／退款解释，由 WS03 给该有限 code 的准确语义与何时能说“实际退回”；现阶段可译“停止＋已证实际部分”。若要解释 `relationships.gift.unavailable` 的具体原因，由 WS03 明确允许展示的原因及受众；当前只保留“无法继续＋已证释放”，不猜不再是好友、退出或拒绝。两项均不阻塞其他模板，也不授权扩大公开日志。

## 5. 必要核验

B/A 定向覆盖：同一记录中英切换不新增请求；world Town generic 无私有参数；owner/recent 各沿原受众且切身份清空；已知 Life/gift 节点的金额／次数／交付与原源相等；当前名称不伪装历史快照；旧不足源和未知合法模板显示原文标识；坏结构拒绝；原机器接口/schema/hash 与 authored 字节不变。不得为测试注册居民、推进活动或改旧事件。实现固定 SHA、独审、版本及本地／GitHub交付仍由 TD 统筹。
