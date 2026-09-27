# Allyson SVG 动画 (allyson-svg)

静态图转SVG动画

- 来源: https://github.com/allyson-mcp
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "allyson-svg": {
      "command": "npx",
      "args": ["-y", "allyson-svg"],
      "env": {
    "ALLYSON_API_KEY": "你的allyson.ai密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。