# 详情关闭名称修正独立静态审查

2026-10-20（Asia/Shanghai）。原独立 reviewer「M1 后端独立代码审查」`01a13916-02fe-7e90-8881-972aba227d8d`。

**R2最终结论：静态接受固定 `81927a2a2c468ad4a2438631530cfe6884d7fbe1 → 001ae3faa844fda05e6e18f1fba25dac7e731236`。DL-CR01已静态复核关闭，无剩余发现；实现及现有测试定位完整覆盖本次 OWN-UI-R8-01 最小修正范围。仅为静态接受，尚未发布或经用户复验。** 下列 R1 记录保留原版本结论，R2依据见文末。

**R1结论：通用名称修正静态覆盖 OWN-UI-R8-01，但发现一处随之失效的既有 E2E 定位（DL-CR01，P2），当前固定候选暂不接受。请原作者同步现有测试定位后提交固定后继复核。** 本结论仅属静态审查；尚未发布或经用户复验，不重开旧 PG 独审。

## 固定范围与依据

- base：`81927a2a2c468ad4a2438631530cfe6884d7fbe1`。
- head：`4775de82898552be245a9ef2b9a0f7fc91cccc18`，Git 确认为上述 base 的直接子提交。
- 完整差异仅 `apps/web/public/hud/detail-host.js:10`，1行增／1行删，将 `aria-label` 从“关闭通知详情”改为“关闭详情”。
- 作者／工作树依 TD 交接：原 owner_read_web，agentThreadId `01a1576e-5a22-79a2-8752-daa9b3a4e36e`，`/Users/kjw/Workspace/Codes/agents-era-worktrees/m1-web`，分支 `codex/ws02-detail-close-label`；模型沿用 TD 已核实的 `gpt-6.1-sol`／`xhigh`。本 reviewer 不以读取浮动工作树核实执行状态。
- 来源：[普通用户报告阶段八](user-simulation/m2-owner-data-ui-round-01-2026-10-20.md#阶段八pg钱包四类信箱6947c4d桌面窄验收) 的 OWN-UI-R8-01（原件第294行），明确允许通用“关闭详情”。原件与本报告分开维护，未改写原用户发现。

## 静态覆盖与发现

`createDetailHost` 建立共用详情窗；`shell.js:23,30` 将同一 host 交给信箱。通用名称同时适合通知、事件及关联物品，符合该问题的最小修正。固定差异没有改变按钮 ID／type、视觉关闭图标、事件监听、焦点恢复、布局或业务逻辑；未发现该生产文案修正本身引入的新问题。

**DL-CR01／P2：同步既有 E2E 对关闭按钮的旧名称定位。** 固定 head 的 `tests/e2e/hud-demo.spec.ts:38` 仍在详情窗可见时执行 `getByRole('button', { name: '关闭通知详情', exact: true }).click()`；修改后共用按钮仅具有“关闭详情”这一显式无障碍名称，旧精确定位不再匹配。该分支有明确现有调用路径：同文件第132—136行打开通知及作品、Escape 回到仍可见的通知详情，随后第137行调用 `mailList(page)`；第149—155行也会在详情可见时调用。因此现有信箱故事会在关闭操作等待旧名称直至超时，后续断言无法执行。这是固定源码推导出的测试回归，未声称实际运行失败。

最小修订为更新该现有辅助函数的精确无障碍名称至“关闭详情”，保留详情可见时真实点击及原故事断言；无需增加镜像文案测试，也无需扩大产品修复或重开 PG 实施。

## 验证与未测范围

reviewer 只读完整固定 Git diff、`detail-host.js`、必要 shell／既有测试上下文及上述问题来源；固定 base→head 的 `git diff --check` 实际退出0。仓库现有其他修改均保留。

作者 `node --check` 与 `git diff --check` 均退出0为 TD 提供的作者回执，本 reviewer 未重跑语法检查，且这两项不能证明按旧无障碍名称定位的浏览器故事仍有效。

本轮未执行项目代码、浏览器、HTTP、产品套件、SQL、数据库、迁移、服务启停或部署，未读取 DB／私密配置。仅新建本独立短报告，不 stage／commit／整合 main，不改旧 PG 报告。发布及普通用户必要复验状态待 TD／原模拟者另行记录。

## R2 固定后继复核与接受

固定 head `001ae3faa844fda05e6e18f1fba25dac7e731236`，Git 确认直接 parent 为 R1 的 `4775de82898552be245a9ef2b9a0f7fc91cccc18`；base仍为 `81927a2a2c468ad4a2438631530cfe6884d7fbe1`。已读后继完整差异及 base→最终 head 全部差异：后继仅将 `tests/e2e/hud-demo.spec.ts:38` 的精确 name 从“关闭通知详情”同步为“关闭详情”；累计仅上述测试和生产 label 两文件、2行增／2行删。

**DL-CR01关闭。** 既有辅助函数保留原详情可见条件、`exact: true` 与真实 `.click()`，所匹配名称现与共用详情按钮一致；其余故事、调用顺序及全部既有断言逐字节未改，没有跳过或删除关闭动作，没有新增测试或扩大产品逻辑。连同 R1 已审生产修正，本固定两文件全批无新增问题，静态接受。

reviewer 对固定 base→最终 head 的 `git diff --check` 实际退出0；对最终固定 Git tree 全部 tracked 文件查找旧名称“关闭通知详情”，`git grep` 空输出、退出1，未读取或清理 ignored 历史 outputs。作者对两个文件的 `node --check` 和固定 diff 检查均0仍按 TD 的作者回执记录，不冒充本 reviewer 执行或浏览器结果。

本次仍仅静态复核并更新本报告；未运行浏览器／HTTP／产品／DB／PG／服务，未整合 main、stage／commit 或发布，未改旧 PG 报告。OWN-UI-R8-01 的发布与普通用户必要复验尚未完成，不以本代码静态关闭替代用户复验关闭。
