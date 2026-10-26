# 生活日志与轻声气泡

入口：[打开预览](http://127.0.0.1:59197/docs/design/life-journal-bubbles-20261026/)。四个标签分别查看世界日志、个人经历、地图气泡与表情总览。所有人物活动和说话均为已标注设计示例。

工程只需读 [短合同](CONTRACT.md)、[事实/呈现映射](mapping.json)、[素材清单](assets-manifest.json)。最终业务值与NPC台词归 M03 `docs/workstreams/ws03-interaction/life-journal-v1/`；本包不改变业务、生产代码、版本或UAT。

- 3 套 × 8 种同语义表情：独立透明 PNG 和各一张图集；另有 3 个原生动作状态图。
- 母图由内置 imagegen 生成，原图在 `assets/generated/`，完整提示在 `prompts/`。
- `reference/emote-overview.png` 为一张总览；其余截图展示真实预览尺寸及样例状态。
- 仅部署小图/图集及必要清单，母图、截图、预览地图不进入生产首屏。

桌面及窄屏的必要检查记录在 `reference/validation.json`。当前尚未完成正式接线、生产权限与时效测试，也没有最终用户审美签收。
