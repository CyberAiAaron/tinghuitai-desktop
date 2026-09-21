# 本仓库的修改规则（Aaron · 2026-09-21 定）

- **唯一修改者：Claude Code。** Aaron 原话「我现在要以你为准……你这里是唯一修改源，做听会台调试」。
- 其他 AI（Codex、Grok Bot、Cline、Continue、Cursor 内模型、DeepSeek / 通义 / Kimi）只读：可以读代码、给审核意见，不改 `app/` `web/` `scripts/` `tests/` 里任何文件，不跑会写生产数据的脚本。
- 要提改动：写到 `~/Workbuddy/agent_bus/inbox/claude/`，由 Claude 判断后落地。
- 本轮需求：`~/This is my Chansey/Meeting LiveMate/听会台_本轮改版需求清单_20260921.md`；现状对账：同目录 `听会台_本轮需求_现状对账_20260921.md`。
- 原 Cline↔Grok 审核门禁（Grok 09-21 14:00 写）已停用。原文不再留 .bak 文件（会被 grep 命中改错地方），要看就翻 git 历史：`git log --all --diff-filter=D -- AGENTS.md.grok-20260921.bak`。
