# Cloudflare (cloudflare-mcp)

Workers/KV/R2 管理

- 来源: https://github.com/mcp-server-cloudflare
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "cloudflare-mcp": {
      "command": "npx",
      "args": ["-y", "cloudflare-mcp"],
      "env": {
    "CLOUDFLARE_API_TOKEN": "你的Cloudflare密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。