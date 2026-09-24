# 会中洞察发布门槛

每次修改 `live-insight`、回放节奏或洞察 prompt 后，用生产默认配置重放至少一场 50 分钟以上的真实历史会议。

## 自动门槛

- 平均节奏：**1–2 张 / 10 分钟**。
- 任意滚动 10 分钟窗口：峰值 **≤2 张**。
- 事实状态：自动扫描结果为 **0 条**「讨论态写成已确定」和「无主行动包装成承诺」。
- 冷却：相邻两张卡的会议时间间隔 **≥300 秒**。
- 模型调用失败或未解析必须另外核对；本脚本不把失败调用当成通过依据。

## 运行

直接重放并验收：

```bash
node scripts/insight-release-gate.js /path/to/session.json --out /tmp/insight-release --tag candidate
```

复核已有的真实回放产物：

```bash
node scripts/insight-release-gate.js \
  --summary /tmp/insight-release/session-candidate-summary.json \
  --jsonl /tmp/insight-release/session-candidate.jsonl
```

退出码 `0` 表示四条自动门槛全过，`1` 表示至少一条未过。语义扫描只负责拦截明确矛盾句和无主承诺；发布前仍需人工抽读代表卡片，确认内容有实质信息。
