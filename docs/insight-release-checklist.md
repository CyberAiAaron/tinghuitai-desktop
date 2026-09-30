# 会中主动智能发布门槛

每次修改 `live-insight`、JEV、回放节奏或主动智能 prompt 后，用生产候选配置重放至少一场 50 分钟以上的真实历史会议。发布前还要抽读代表卡片；自动统计不能替代内容判断。

## Rapid 模式门槛

- **响应时间**：有价值事件完成后，JEV 判断、合并和快思考通常在 **5–10 秒**内开始产出。这个时间是响应延迟，不是定时凑卡。
- **召回目标**：活跃讨论约 **0.7–1 张即时卡 / 分钟**。无新信息、空话和重复允许零出卡，不设最低张数配额。
- **垃圾控制**：JEV 先筛选；快思考可返回 `NONE`；语义重复交给慢思考吸收，独特卡片长期保留。
- **事实安全**：自动扫描结果为 **0 条**“讨论态写成已确定”和“无主行动包装成承诺”。
- **可靠性**：JEV 与模型调用失败必须为 0，或逐条给出已验证的恢复说明；失败调用不能当作有效产出。
- **信息完整**：有 Action、来源或链接时完整保留。只提示模型尽量简短，不用 token 或字数硬截断。

## 回放记录

每次候选至少记录：

1. 会议总时长、有效转写时长和分段数。
2. JEV 调用、命中、失败与阈值。
3. 快思考调用、出卡、`NONE`、失败和每分钟卡片数。
4. 输入 / 输出 token，模型延迟 P50 / P90 / 最大值。
5. 人工抽读中的有用、无用、重复、错误承诺和遗漏链接。

## 运行

直接重放并验收：

```bash
node scripts/insight-release-gate.js /path/to/session.json --out /tmp/insight-release --tag candidate
```

复核已有的真实回放产物：

```bash
node scripts/insight-release-gate.js --rapid /path/to/rapid-replay.json

# 旧版慢节奏回放仍兼容：
node scripts/insight-release-gate.js \
  --summary /tmp/insight-release/session-candidate-summary.json \
  --jsonl /tmp/insight-release/session-candidate.jsonl
```

退出码 `0` 只代表脚本覆盖的自动门槛通过。发布结论还要结合模型失败、人工抽读、全量测试、交叉审核和真实会议试用分别记录。
