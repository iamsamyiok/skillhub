# Context7 文档 (context7-docs)

最新库文档实时注入

- 来源: https://github.com/context7-mcp
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "context7-docs": {
      "command": "npx",
      "args": ["-y", "context7-docs"],
      "env": {
    // 无需密钥
      }
    }
  }
}
```

## 密钥

无需密钥。