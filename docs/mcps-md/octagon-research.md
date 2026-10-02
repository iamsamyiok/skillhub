# Octagon 深度调研 (octagon-research)

多步深度网络调研

- 来源: https://github.com/octagon-deep-research-mcp
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "octagon-research": {
      "command": "npx",
      "args": ["-y", "octagon-research"],
      "env": {
    "OCTAGON_API_KEY": "你的octagonai.xyz密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。