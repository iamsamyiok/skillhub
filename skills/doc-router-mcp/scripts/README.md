# doc-router MCP — coding-principles v2.1 实战

针对 MCP 生态四大社区痛点(2026-09 调研)的宿主级对策实现:

| 痛点 | 对策 | 位置 |
|---|---|---|
| P1 工具过载(每工具 200-500 token 吃上下文) | 语义路由: Agent 只见 1 个入口 `doc_q` + enum, N 个实现在宿主内 | harness.py route() |
| P2 输出冗长烧 token | 双模输出: 默认 compact(前5条+计数), meta.with_detail=true 全量 | harness.py route() |
| P3 无状态长任务 | 任务句柄: reindex 立即返回 task_id, task_poll 查询 | harness.py spawn_task/poll |
| P4 描述投毒/rug-pull | manifest sha256 锁定, 每次执行前校验, 变更即自动停用 | harness.py _verify_integrity |

另有: 双通道输出(human 摘要+JSON 同源) / 三级降级 / 结构化错误含 Agent 下一步建议 / 契约测试 7 项。

## 运行
```bash
python server.py            # stdio MCP server
python -m pytest tests/ -q  # 契约测试
```
## 接入 Claude/ZCode
```json
{"mcpServers": {"doc-router": {"command": "python", "args": ["server.py"], "cwd": "<本目录>"}}}
```
