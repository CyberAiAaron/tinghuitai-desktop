# 本仓库的修改规则（Aaron · 2026-09-21 定）

- **唯一修改者：Claude Code。** Aaron 原话「我现在要以你为准……你这里是唯一修改源，做听会台调试」。
- 其他 AI（Codex、Grok Bot、Cline、Continue、Cursor 内模型、DeepSeek / 通义 / Kimi）只读：可以读代码、给审核意见，不改 `app/` `web/` `scripts/` `tests/` 里任何文件，不跑会写生产数据的脚本。
- 要提改动：写到 `~/Workbuddy/agent_bus/inbox/claude/`，由 Claude 判断后落地。
- 本轮需求：`~/This is my Chansey/Meeting LiveMate/听会台_本轮改版需求清单_20260921.md`；现状对账：同目录 `听会台_本轮需求_现状对账_20260921.md`。
- 原 Cline↔Grok 审核门禁（Grok 09-21 14:00 写）已停用。原文不再留 .bak 文件（会被 grep 命中改错地方），要看就翻 git 历史：`git log --all --diff-filter=D -- AGENTS.md.grok-20260921.bak`。

## 施工用的三个脚本（2026-09-22）
- `scripts/t.sh`：测试只回三个数。不带参数 = 只跑和改动相关的测试 + 架构约束测试（`tests/arch-*.test.js`、`tests/llm-everywhere.test.js`、`tests/contract.test.js`）；`--all` 全量；`--commit "信息"` = 全量 fail 0 才提交。全量输出在 `.tmp/test.out`，不要直接 `npm test` 把输出打进对话。
- `scripts/wt.sh new|done|list <名字>`：给并行施工开 / 收独立 worktree（自带 node_modules 软链和隔离端口）。
- `scripts/deploy-beta.sh [--check]`：装到本机这一份。有会在开、有未提交改动、测试不过都会拒绝；装前给删改预览、留回退快照和设置备份；装完核对进程和文件。

## 架构约束（有测试盯着，别绕）
- 模型调用只许走 `app/llm.js` 的 `ask`；厂商名只许出现在白名单文件里（`tests/llm-everywhere.test.js`）。
- 递给模型的本机资料只许从 `app/context-pack.js` 出；四个资料设置项只许它认（`tests/arch-context-pack.test.js`）。
- 外部动作只许登记在 `app/tools/`；写类工具只有界面点击那条路能执行。
