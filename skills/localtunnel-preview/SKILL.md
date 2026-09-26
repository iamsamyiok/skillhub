---
name: localtunnel-preview
version: 1.0.0
category: 开发工具
tags: [预览, 临时链接, localtunnel, tunnel, 开发]
description: 通过 localtunnel 将本地 Web 服务暴露为临时公网 URL，5 分钟后自动清理。提供安全防御：端口范围限制、进程隔离、自动回收。适用于需要分享本地项目给他人预览的场景。
license: MIT
---

# LocalTunnel Preview Skill

通过 localtunnel 将本地 Web 服务暴露为临时公网 URL，链接 5 分钟后自动失效。

## 设计原则

- **安全性优先**：端口范围限制、进程隔离、自动回收、不泄露敏感信息
- **零配置**：无需注册账号、无需域名、无需 API key
- **短期有效**：链接 5 分钟后强制失效，结束后自动清理所有资源
- **独立运行**：不依赖平台特定功能，适用于任何有 Node.js 环境的外网服务器

## 工作流程

### 步骤 1：确认服务器已运行

检查是否已有服务器监听在目标端口：

```bash
ss -tlnp 2>/dev/null | grep ':<PORT>' || netstat -tlnp 2>/dev/null | grep ':<PORT>'
```

若无服务器，先启动（使用 `background_terminal_create`）：

```bash
# Node.js
background_terminal_create(command: "cd <workspace> && npm run dev", timeout: 30000)
# 静态 HTML
background_terminal_create(command: "cd <workspace> && python3 -m http.server <PORT> --bind 127.0.0.1", timeout: 30000)
```

启动后等待 3-5 秒，确认服务监听成功：

```bash
sleep 3 && ss -tlnp | grep '<PORT>'
```

### 步骤 2：安全检查

开始隧道前，**必须先确认以下所有检查项通过，否则拒绝执行**：

| 检查项 | 规则 | 命令 |
|---|---|---|
| 端口范围 | 8000-9999，禁止 0-1023 及常见服务端口（3000/5432/6379） | `echo '<PORT>' \| awk '{if ($1 >= 8000 && $1 <= 9999) print "OK"; else exit 1}'` |
| 绑定地址 | 必须绑定 `127.0.0.1`，禁止 `0.0.0.0` | `ss -tlnp \| grep ':<PORT>' \| grep -q '127.0.0.1' && echo "bind OK"` |
| 项目路径 | 必须在 `/workspace` 或 `/tmp/opencode` 内 | `pwd \| grep -qE '^/workspace|^/tmp/opencode' && echo "path OK"` |
| 进程所有者 | 服务器进程必须由当前用户启动 | `ps -o user= -p <PID>` |

### 步骤 3：启动 localtunnel

使用 `background_terminal_create` 启动 localtunnel，捕获生成的 URL：

```bash
# 创建 localtunnel 终端
LT_TERMINAL=$(background_terminal_create(
  command: "timeout 320 npx localtunnel --port <PORT> 2>&1 | tee /tmp/lt-output.txt",
  timeout: 330000
))

# 等待 URL 生成（最多 30 秒）
for i in $(seq 1 30); do
  sleep 1
  URL=$(grep -oE 'https://[a-zA-Z0-9_-]+\.loca\.lt' /tmp/lt-output.txt 2>/dev/null | head -1)
  [ -n "$URL" ] && break
done
```

### 步骤 4：验证 URL 可达性

```bash
curl -s --max-time 5 "$URL" -o /dev/null -w "%{http_code}"
```

- HTTP 200/301/302 → 成功，继续
- HTTP 000 或其他 → 失败，输出错误并清理（执行步骤 6）

### 步骤 5：设置 5 分钟自动清理

**必须**设置定时器，5 分钟后自动停止隧道：

```bash
# 后台定时器（使用 background_terminal_create）
background_terminal_create(
  command: "sleep 300 && background_terminal_kill <LT_TERMINAL_ID> && rm -f /tmp/lt-output.txt /tmp/lt-url.txt; echo 'tunnel cleaned at $(date)'",
  timeout: 310000
)
```

同时记录启动时间，告知用户：

> 预览链接（5 分钟有效）：<URL>
> 启动时间：<ISO 时间>，将在 5 分钟后自动失效

### 步骤 6：输出结果与清理

成功时输出：

```
预览已就绪：

<URL>

有效期：5 分钟（至 <截止时间>）
终端 ID：<LT_TERMINAL_ID>
```

失败时输出错误原因，**不得编造 URL**。

用户可随时手动停止：

```bash
background_terminal_kill <LT_TERMINAL_ID>
rm -f /tmp/lt-output.txt /tmp/lt-url.txt
```

## 安全防御清单

### 输入验证
- [ ] 端口号是整数且在 8000-9999 范围内
- [ ] 绑定地址包含 `127.0.0.1`（禁止 `0.0.0.0`）
- [ ] 项目路径在 `/workspace` 或 `/tmp/opencode` 内

### 进程隔离
- [ ] 使用 `background_terminal_create` 启动 localtunnel，不使用 `&` 或直接 exec
- [ ] 记录终端 ID，便于后续 `background_terminal_kill` 清理
- [ ] 5 分钟定时器双重保障（terminal + 后台 timer）

### 资源清理
- [ ] 结束时必须清理 `/tmp/lt-output.txt`
- [ ] 结束时必须通过 `background_terminal_kill` 停止隧道进程
- [ ] 禁止残留长时间运行的隧道进程

### 信息泄露防护
- [ ] 不输出服务器进程完整命令行（可能含敏感参数）
- [ ] 不输出 `/tmp/lt-output.txt` 的完整路径（仅输出 URL）
- [ ] 不在日志中打印 tunnel URL 的完整内容（只展示给用户）

### 异常处理
- [ ] localtunnel 启动失败 → 报告具体错误，不重试超过 2 次
- [ ] URL 提取失败 → 报告错误，不编造假 URL
- [ ] 外部访问 000 → 告知用户网络问题，建议检查防火墙或代理设置

## 注意事项

- **localtunnel 是共享服务**：URL 随机生成，无密码保护，不要用于敏感数据预览
- **5 分钟是硬限制**：无论用户是否需要，5 分钟后必须停止，不得延长
- **端口复用**：同一端口不能同时运行多个隧道，启动前检查端口占用
- **网络依赖**：localtunnel 需要稳定的外网访问能力，若网络受限会返回 000 错误
- **依赖要求**：目标环境必须已安装 Node.js 和 npm（`npx localtunnel` 可直接使用）

## 相关文件

- localtunnel 官方：https://github.com/localtunnel/localtunnel
- localtunnel server：https://server.loca.lt（状态：503 Tunnel Unavailable 表示服务繁忙，稍后重试）
