# LaTeX 编译 (latex-compile)

生成并编译LaTeX

- 来源: https://github.com/latex-mcp-server
- 运行时: node

## MCP 配置

```json
{
  "mcpServers": {
    "latex-compile": {
      "command": "npx",
      "args": ["-y", "latex-compile"],
      "env": {
    // 无需密钥
      }
    }
  }
}
```

## 密钥

无需密钥。