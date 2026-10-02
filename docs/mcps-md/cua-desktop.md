# Cua 电脑操作 (cua-desktop)

Agent 操作完整桌面

- 来源: https://github.com/cua
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "cua-desktop": {
      "command": "npx",
      "args": ["-y", "cua-desktop"],
      "env": {
    // 无需密钥
      }
    }
  }
}
```

## 密钥

无需密钥。