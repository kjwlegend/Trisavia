# 0114 官方书籍英文与 human-book 最小表示

WS02，2026-10-28；沿 WS03 本轮来源／许可裁定及已批准的中英范围。两本均为 WS02 官方 v1 原稿、zh-CN、署名蓝檐书屋，各五段；运行 `c-books.ts` 与原 `product/books/*.v1.json` 七字段逐项相同。原书版本、digest、正文及机器接口不改；本交付为译文资源与接线合同，未实现 HTTP／UI。

| sourceId / sourceVersion | 完整 sourceDigest | 原读取权限 |
| --- | --- | --- |
| `qingzhou_life_guide / 1` | `aff8085f50c11e30776ab8bec274030b09d01b8d90c514844acfa3ec3b8b269a` | 现有公开 `GET /v1/world/life/books?bookId=qingzhou_life_guide&bookVersion=1`；无需 Owner、到场或阅读事实。 |
| `harbor_handbook / 1` | `e70adfd3d53a54747a0d35b1c048483a1d0da6d4acfb7f212630be4569aa2e9c` | 原 `life.books.get` 的有效 Agent 本人，或 active 绑定 Owner＋所选 Agent；必须有该 Agent 的真实 `harbor_handbook` itemInstanceId，状态 available/reserved。公开 ID、Owner 身份本身、旧赠礼／旧阅读均不足；查看正文不要求先到场／已读，也不开始阅读活动。 |

**资源：**`apps/platform/domains/life/locales/books/en.json`，两个英文全本，`translationRevision:1`。仅服务端导入，不进入 web/public、公共 locale／manifest、CDN、跨用户缓存或前端静态 bundle；免费书也统一采用此目录。WS02拥有译文与来源字段；B拥有同源验权后的只读包装／digest校验，A拥有正文显示和原地切换；TD整合发布。

sourceDigest 沿原 `hashRuntimeRequest`，覆盖且仅覆盖原七字段 `{bookId,version,authorDisplay,title,locale,readingScope,body}`，不包含 `lifeBook` 后加的 digest；不是 body 字节摘要。译文记录字段为 `{sourceId,sourceVersion,sourceLocale,sourceDigest,locale,translationRevision,translatedFields,digest}`；`translatedFields` 恰为 title/authorDisplay/body。译文 digest 用相同 canonical JSON 算法覆盖该完整记录、只排除自身 digest，包含全部译文和来源元数据。readingScope 等机器元数据不覆盖。

建议 human-only `GET /v1/human/life/books` 复用原免费书 GET；`POST /v1/human/life/books` 复用原 `life.books.get` 输入、认证／所选 Agent 上下文及权限。不是新增匿名手册读取，不把包装注册成新 Agent 能力。页面一次请求替换原正文读取；服务端同次调用原 reader 一次，成功后才附英文，不再 GET 原书／补持有信息，不从客户端提交的书对象或 digest 决定权限。

```ts
{ schema: "human-book", version: 1,
  original: ExistingBookReadEnvelope,
  presentation:
    | {status: "translated", translation: EnglishBookTranslationV1}
    | {status: "original", sourceLocale: "zh-CN",
       reason: "source-changed" | "translation-unavailable"} }
```

独立 strict decoder 先调用原书 decoder 校验 original，再校验表示；不放宽原 decoder。`translation.sourceId/sourceVersion/sourceDigest` 必须对应本次原 book；完整七字段重算值须等于原 book.digest 和资源 sourceDigest。只认 sourceLocale=zh-CN、locale=en、1–2^31−1 整数 translationRevision、64位小写十六进制 digest、精确字段集；三个译文字段须为纯文本，title/authorDisplay 各≤240字符、body≤10,000字符，单响应≤128 KiB。译文摘要／字段结构坏而原书合法时只展示原文并标 translation-unavailable；原响应坏按原错误拒绝，不当无书。

原 reader 失败／失权时不返回任何正文或译文；源合法但版本／摘要不匹配或译文缺失时，返回获准原文及明确“原文（简体中文）”状态，不凭书名／bookId套旧英文。原文和英文在同次获准响应内供页面切换，无新增第二次业务 GET；响应 no-store，仅当前书页内存，沿现有身份代次／实例切换／失权处理清空两种正文，不落 localStorage／共享缓存。显示译文只选三个展示字段，不改目录、书实例、动作意图、阅读结果或原书 digest。

已做内容与数据定点检查：两本七字段摘要、十段逐段对照、批准书名／署名／地点术语、译文完整摘要；数值／源版本／任一正文字段变化不能命中旧译文。后继 B/A 验证免费书匿名与受限书原权限、失权清空、单次读取切换、正文未进入公共产物；本次不注册居民、取得物品或执行阅读活动。
