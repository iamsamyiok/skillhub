# Weather MCP Server

提供实时天气查询、预报、空气质量等工具的 MCP Server。

## 工具列表

- `get_current_weather` - 获取当前天气
- `get_forecast` - 获取天气预报
- `get_air_quality` - 获取空气质量数据

## 安装

```bash
# 下载并解压
curl -L https://iamsamyiok.github.io/skillhub/downloads/weather-mcp.zip -o weather-mcp.zip
unzip weather-mcp.zip

# 安装依赖
cd weather-mcp && npm install
```

## 配置

### Claude Desktop

编辑 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "weather-mcp": {
      "command": "node",
      "args": ["scripts/server.js"],
      "env": {
        "OPENWEATHER_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor / VSCode

通过 MCP 扩展管理，或直接编辑配置文件。

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENWEATHER_API_KEY` | OpenWeather API 密钥 | 必填 |
| `DEFAULT_CITY` | 默认城市 | Shanghai |

## 传输方式

支持 stdio（默认）、SSE、HTTP 三种传输方式。
