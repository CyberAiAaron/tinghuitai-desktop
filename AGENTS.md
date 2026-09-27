# 本仓库的修改规则（Aaron · 2026-09-27 更新）

- **主导修改者：Codex。** Aaron 2026-09-27 最新原话：「以后别走 claude 了，我不用 claude 了，你来主导」。这条取代 2026-09-21 的 Claude 唯一修改源规则。
- Codex 可以修改 `app/`、`web/`、`scripts/`、`tests/`，并负责测试、发布和验收；不得再把听会台工作交给 Claude。
- **Peer review 由 Grok Bot 承担。** Codex 在重要改动前给 Grok Bot 审范围与验收条件，代码和测试完成后再给 Grok Bot 审 diff 与证据；Grok Bot 默认只读，不直接修改产品源码。
- 其他 AI（Cline、Continue、Cursor 内模型、DeepSeek / 通义 / Kimi）默认只读，除非 Aaron 后续明确指定。
- 本轮需求：`~/This is my Chansey/Meeting LiveMate/听会台_本轮改版需求清单_20260921.md`；现状对账：同目录 `听会台_本轮需求_现状对账_20260921.md`。
- 原 Cline↔Grok 文件门禁仍停用；现在是 Codex↔Grok Bot 双方审核。原文不再留 .bak 文件（会被 grep 命中改错地方），要看就翻 git 历史：`git log --all --diff-filter=D -- AGENTS.md.grok-20260921.bak`。

## 施工用的三个脚本（2026-09-22）
- `scripts/t.sh`：测试只回三个数。不带参数 = 只跑和改动相关的测试 + 架构约束测试（`tests/arch-*.test.js`、`tests/llm-everywhere.test.js`、`tests/contract.test.js`）；`--all` 全量；`--commit "信息"` = 全量 fail 0 才提交。全量输出在 `.tmp/test.out`，不要直接 `npm test` 把输出打进对话。
- `scripts/wt.sh new|done|list <名字>`：给并行施工开 / 收独立 worktree（自带 node_modules 软链和隔离端口）。
- `scripts/deploy-beta.sh [--check]`：装到本机这一份。有会在开、有未提交改动、测试不过都会拒绝；装前给删改预览、留回退快照和设置备份；装完核对进程和文件。

## 架构约束（有测试盯着，别绕）
- 模型调用只许走 `app/llm.js` 的 `ask`；厂商名只许出现在白名单文件里（`tests/llm-everywhere.test.js`）。
- 递给模型的本机资料只许从 `app/context-pack.js` 出；四个资料设置项只许它认（`tests/arch-context-pack.test.js`）。
- 外部动作只许登记在 `app/tools/`；写类工具只有界面点击那条路能执行。
