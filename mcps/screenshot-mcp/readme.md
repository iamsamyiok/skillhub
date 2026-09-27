# 网页截图 (screenshot-mcp)

URL一键截图

- 来源: https://github.com/ScreenshotMCP
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "screenshot-mcp": {
      "command": "npx",
      "args": ["-y", "screenshot-mcp"],
      "env": {
    "SCREENSHOT_API_KEY": "你的screenshot 服务密钥"
      }
    }
  }
}
```

## 密钥

需要 1 个环境变量密钥，见上方配置。钥到手后存入本地密钥文件(勿进 git)。