# CONFIG — 密钥与端点配置

> ⚠️ 本技能**不包含任何真实密钥**。请按以下方式配置你自己的 Key，
> 并**永远不要**把 Key 写进代码或提交到 Git 仓库。

## 需要配置的密钥

| 服务 | 环境变量 | 用途 | 申请地址 | 费用 |
|---|---|---|---|---|
| SiliconFlow | `SILICONFLOW_API_KEY` | 扫描件 OCR | https://cloud.siliconflow.cn → API密钥 | 免费 |
| MinerU（可选） | `MINERU_API_KEY` | 复杂版式解析 | https://mineru.net → API Token | 有限免费额度 |

anydoc / markitdown 为本地引擎，**无需任何密钥**。

## 配置方式（三选一）

### 方式一：环境变量（推荐，临时会话）

```bash
# Windows (git-bash / MSYS)
export SILICONFLOW_API_KEY="sk-你的密钥"

# Windows (PowerShell)
$env:SILICONFLOW_API_KEY = "sk-你的密钥"

# Linux / macOS
export SILICONFLOW_API_KEY="sk-你的密钥"
```

### 方式二：用户级永久环境变量（Windows）

```powershell
[Environment]::SetEnvironmentVariable("SILICONFLOW_API_KEY", "sk-你的密钥", "User")
```

设置后重启终端生效。

### 方式三：本地配置文件（不进Git）

文件路径：`~/.config/doc-to-md/config.json`

```json
{
  "siliconflow_api_key": "sk-你的密钥",
  "siliconflow_endpoint": "https://api.siliconflow.cn/v1",
  "ocr_model": "PaddlePaddle/PaddleOCR-VL-1.5"
}
```

> 脚本读取顺序：环境变量 → 配置文件。请把 `~/.config/doc-to-md/` 加入 `.gitignore`。

## 验证配置

```bash
python scripts/convert.py --check-config
```

输出各服务就绪状态，例如：

```
[ok] anydoc          本地引擎就绪
[ok] SiliconFlow     key 已配置（env）   端点: https://api.siliconflow.cn/v1
[ok] markitdown      备选引擎就绪
[--] MinerU          未配置（可选）
```

## 安全检查清单

- [ ] 代码/脚本中无明文 Key（`grep -rn "sk-" .` 应无结果）
- [ ] Key 只存在于环境变量或 `~/.config/` 下
- [ ] `.gitignore` 已排除配置文件
- [ ] Key 泄露后立即到对应平台撤销重发
