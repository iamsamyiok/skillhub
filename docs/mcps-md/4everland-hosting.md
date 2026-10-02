# 4EVERLAND 托管 (4everland-hosting)

去中心化网站托管

- 来源: https://github.com/4everland-hosting-mcp
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "4everland-hosting": {
      "command": "npx",
      "args": ["-y", "4everland-hosting"],
      "env": {
    "4EVERLAND_TOKEN": "你的4everland.org密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。