# 云端浏览器 (browserbase-mcp)

Serverless 无头浏览器池

- 来源: https://github.com/mcp-server-browserbase
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "browserbase-mcp": {
      "command": "npx",
      "args": ["-y", "browserbase-mcp"],
      "env": {
    "BROWSERBASE_API_KEY": "你的browserbase.com密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。