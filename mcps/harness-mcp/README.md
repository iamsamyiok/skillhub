# Harness CI/CD (harness-mcp)

部署流水线操作

- 来源: https://github.com/mcp-server
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "harness-mcp": {
      "command": "npx",
      "args": ["-y", "harness-mcp"],
      "env": {
    "HARNESS_API_KEY": "你的Harness 平台密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。