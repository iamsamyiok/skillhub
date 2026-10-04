# GeoGPT 开发者 API 使用文档

> 整理自 GeoGPT 官方开发者文档：https://geogpt.zero2x.org.cn/cn/developer-docs（#0 ~ #10 全部章节）
> 官方源文件版本：`API接口文档页-国内中文版0520`
> 支持邮箱：support.geogpt@zhejianglab.org
> 本账户配额：RPM 1000 / RPD 300000 / TPM 1000000 / TPD 100000000（详见 [第 6 节](#6-使用限制速率与配额)）

---

## 目录

> 📌 先看 [⚡ 实测速览](#实测速览2026-09-29)——官方文档有多处与线上不符，直接照抄会踩坑。

1. [平台入口与凭证获取](#1-平台入口与凭证获取)
2. [认证方式](#2-认证方式)
3. [环境与基础地址](#3-环境与基础地址)
4. [统一返回格式](#4-统一返回格式)
5. [全局错误码](#5-全局错误码)
6. [使用限制（速率与配额）](#6-使用限制速率与配额)
7. [接口总览](#7-接口总览)
8. [接口一：创建会话](#8-接口一创建会话-geogpt-generate)
9. [接口二：发送消息（流式问答）](#9-接口二发送消息流式问答-geogpt-sendmsg)
10. [接口三：个人库 RAG 检索](#10-接口三个人库-rag-检索-ragtop_k)
11. [接口四：公共库 RAG 检索](#11-接口四公共库-rag-检索-ragtop_k_common)
12. [接口五：大模型服务（OpenAI 兼容）](#12-接口五大模型服务openai-兼容-modelv1chatcompletions)
13. [接口六：模型列表](#13-接口六模型列表-modelv1models)
14. [端到端最小可用示例](#14-端到端最小可用示例)
15. [官方文档勘误与注意事项](#15-官方文档勘误与注意事项)
16. [这个 API 能帮你做的具体事情](#16-这个-api-能帮你做的具体事情)

---

## 实测速览（2026-09-29）

本文档主体照录官方页面内容；下面是**实测后的结论**，与官方描述冲突处以实测为准。

| 接口 | 实测状态 | 关键结论 |
| --- | --- | --- |
| 创建会话 `generate` | ✅ 可用 | 返回 UUID 形式的 `sessionId` |
| 发送消息 `sendMsg` | ✅ 可用 | 流式；**真实格式与官方文档完全不同**（OpenAI chunk + 双层 JSON 转义），见[第 9 节](#9-接口二发送消息流式问答-geogpt-sendmsg) |
| 多轮上下文 | ✅ 可用 | 同 `sessionId` 追问能正确引用上一轮内容 |
| 个人库 RAG `top_k` | ✅ 可用 | 返回 `[文档块, 分数]` 二元组，但外层分数恒为 0 |
| 公共库 RAG `top_k_common` | ✅ 可用 | 返回**扁平对象** + `metadata.score`；**纯中文查询 0 命中，必须用英文** |
| 大模型服务 `chat/completions` | 🔴 不可用 | 上游网关 401，非本地 key 问题 |
| 模型列表 `/v1/models` | 🔴 不可用 | 同上 |

四条最容易踩的坑：

1. 按官方文档写的 `<markdown>` + `decodeURIComponent` 两遍去解析 `sendMsg`，**一定失败**；实际是 `data:"{\"choices\":...}"` 双层转义 + `[DONE]` 结束。
2. RAG **不会因为不相关而返回空**——库里只有一篇无关论文时照样返回 3 条，必须自己卡 `score`/`distance` 阈值。
3. 公共库检索词**要用英文**。混进中文里的英文缩写（`U-Pb`）会命中，容易让人误判成"中文也能查"。
4. 个人库与公共库的响应结构**不一致**，需要两套解析代码。
5. **成功不等于有内容**：无效 `sessionId` 返回空回答、错误 token 返回 HTTP 200 + `code:"2020"`，两种情况状态码都是 200，必须分别校验业务 `code` 和答案是否为空。

> 2026-10-03 做了第二轮全量复测（三模型、多轮、并发、长输入、异常路径），结论补充见[第 15.4 节](#154-第二轮全量复测补充2026-10-03)。

---

## 1. 平台入口与凭证获取

| 项目 | 地址 |
| --- | --- |
| 开发者平台（申请 / 管理 API Key） | https://geogpt.zero2x.org.cn/cn/developer/api-keys |
| 站点首页 | https://geogpt.zero2x.org.cn |
| 开发者文档页 | https://geogpt.zero2x.org.cn/cn/developer-docs |

调用所有接口都需要先在开发者平台创建 Access Token（API Key），下文统一记作 `{access_token}`。

---

## 2. 认证方式

全部接口使用 **Bearer Token** 认证，令牌放在 HTTP 请求头中：

```http
Authorization: Bearer {access_token}
```

- 所有 POST 接口需额外带上 `Content-Type: application/json`。
- 注意：`大模型服务` 一节的官方 curl 示例里写的是小写 `authorization`，HTTP 头名大小写不敏感，两种写法均可。

---

## 3. 环境与基础地址

| 环境 | 基础地址 |
| --- | --- |
| 生产环境（中国站） | `https://geogpt.zero2x.org.cn` |

接口完整地址 = 基础地址 + 下文各接口的 URL 路径（路径本身已包含 `/be-api/...` 前缀）。

官方提供的站点列表（同一套 API 规范）：

| 站点 | 地址 |
| --- | --- |
| 中国站 | https://geogpt.zero2x.org.cn |
| 国际站 | https://geogpt-sg.zero2x.org |
| 欧洲站 | https://geogpt-eu.zero2x.org |

---

## 4. 统一返回格式

**同步接口**统一返回如下信封结构：

```json
{
    "code": "0001",
    "msg": "system error",
    "data": "",
    "traceId": "f25967d4a16db14d730f4a9bbfea07ed"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 业务状态码，`"00000"` 表示成功，非 `00000` 为错误 |
| `msg` | string / null | 错误描述，成功时通常为 `null` |
| `data` | any | 业务数据，类型随接口而变（字符串 / 对象 / 数组） |
| `traceId` | string | 链路追踪 ID，报障时请提供该值 |

**例外**：`大模型服务` 与 `模型列表` 两个接口走 OpenAI 规范，**不带**上述信封，直接返回模型侧原始结构。

---

## 5. 全局错误码

| HTTP 状态码 | 说明 |
| --- | --- |
| 401 | 认证失败（Token 缺失、过期或无效） |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

---

## 6. 使用限制（速率与配额）

GeoGPT 的使用限制通过四种方式同时衡量，**任一维度先触顶即被限流**：

| 缩写 | 全称 | 含义 | 本账户限额 |
| --- | --- | --- | --- |
| RPM | Requests Per Minute | 每分钟请求数 | **1000** |
| RPD | Requests Per Day | 每日请求数 | **300000** |
| TPM | Tokens Per Minute | 每分钟 token 数量 | **1000000** |
| TPD | Tokens Per Day | 每日 token 数量 | **100000000** |

### 6.1 配额解读

- **请求数**：RPD 300000 比 RPM 1000 折算出的日上限（1000 × 1440 = 144 万）严格得多，即全天平均约 **208 次/分钟**，跑批任务按 RPD 规划更实际。
- **token 数**：TPD 100000000 ÷ TPM 1000000 = 100 分钟，意味着满负荷（100 万 token/分钟）只能持续约 1 小时 40 分钟，之后就会被 TPD 卡住。
- **上下文上限**：模型侧另有 `max_model_len`（`/model/v1/models` 返回，示例值 80000），与 TPM/TPD 是两套独立约束。
- **统计口径**：配额绑定在 `access_token`（账户）维度；中国站、国际站、欧洲站的额度是否互通官方未说明，跨站部署时建议按各站独立配额处理。

### 6.2 超限后的表现与处理

官方文档的[全局错误码](#5-全局错误码)只列了 401/403/404/500，**未说明超配额时的返回码**。实测中限流通常表现为 HTTP `429 Too Many Requests`，也可能以业务 `code` + `msg` 返回。稳妥做法是：

1. 客户端主动限速，不要依赖服务端报错；
2. 收到 429 或未知错误码时按指数退避重试；
3. 长流式响应（`sendMsg`、`chat/completions`）按连接计数为 1 次请求，但 token 消耗在结束时才完整体现，预算要留余量。

```python
import time


class QuotaGuard:
    """按 RPM / TPM 做滑动窗口限速，TPD/RPD 作为当日累计熔断。"""

    def __init__(self, rpm=1000, tpm=1_000_000, rpd=300_000, tpd=100_000_000):
        self.rpm, self.tpm, self.rpd, self.tpd = rpm, tpm, rpd, tpd
        self.calls = []            # (时间戳, 估算token)
        self.day_calls = 0
        self.day_tokens = 0

    def acquire(self, est_tokens=2000):
        """请求前调用；分钟级超限则阻塞等待，当日配额耗尽则抛异常。
        进程常驻跨自然日时，需自行按日期重置 day_calls / day_tokens。
        """
        if self.day_calls >= self.rpd or self.day_tokens + est_tokens > self.tpd:
            raise RuntimeError("当日配额（RPD/TPD）已用尽，请次日重试或申请提额")

        while True:
            now = time.time()
            self.calls = [(t, n) for t, n in self.calls if now - t < 60]
            if (len(self.calls) < self.rpm
                    and sum(n for _, n in self.calls) + est_tokens <= self.tpm):
                self.calls.append((now, est_tokens))
                self.day_calls += 1
                self.day_tokens += est_tokens
                return
            time.sleep(0.5)


def request_with_backoff(do_request, max_retry=5):
    """429 / 5xx 指数退避。"""
    for i in range(max_retry):
        resp = do_request()
        if resp.status_code not in (429, 500, 502, 503, 504):
            return resp
        time.sleep(min(2 ** i, 30))
    raise RuntimeError(f"重试 {max_retry} 次后仍被限流")
```

### 6.3 凭证保管

- 本账户的 access_token 前缀为 `sk-BK**`（完整密钥**不写入本文档**，避免文档被分享或提交到仓库时泄露）。
- 推荐用环境变量注入，代码中只读变量：

```bash
export GEOGPT_TOKEN="$(cat ~/.geogpt_token)"   # 不要把密钥明文写进脚本
```

```python
import os
TOKEN = os.environ["GEOGPT_TOKEN"]
```

- 若怀疑密钥已在任何地方明文出现过，请到开发者平台 https://geogpt.zero2x.org.cn/cn/developer/api-keys 重新生成并轮换。

---

## 7. 接口总览

| # | 接口 | 作用 | 方法 | 路径 | 实测状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 创建会话 | 拿到 `sessionId`，用于维持多轮上下文 | GET | `/be-api/service/api/geoChat/generate` | ✅ 可用 |
| 2 | 发送消息 | 对话问答，流式返回结果（含思考链） | POST | `/be-api/service/api/geoChat/sendMsg` | ✅ 可用，**响应格式与官方文档不符** |
| 3 | 个人库 RAG 检索 | 在个人/团队知识库中做向量检索 | POST | `/be-api/service/api/rag/top_k` | ✅ 可用，中文查询有效 |
| 4 | 公共库 RAG 检索 | 在 GeoGPT 公共知识库中做向量检索 | POST | `/be-api/service/api/rag/top_k_common` | ✅ 可用，**仅英文查询有效** |
| 5 | 大模型服务 | 直接调用大模型（OpenAI 兼容） | POST | `/be-api/service/api/model/v1/chat/completions` | 🔴 上游网关 401，不可用 |
| 6 | 模型列表 | 查询可用的模型 ID | GET | `/be-api/service/api/model/v1/models` | 🔴 同上，不可用 |

典型调用链：`创建会话` → `发送消息`（携带 `sessionId` 反复调用）。
需要资料支撑时，先 `top_k` / `top_k_common` 召回片段，再把片段拼进 `发送消息` 的 `text`。
裸模型能力目前不可用，`大模型服务` 恢复前一律走 `发送消息`。

---

## 8. 接口一：创建会话 `/geoChat/generate`

**接口说明**：创建会话。一个会话包含多次问答，同一会话内的问答之间存在上下文关联。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `GET` |
| URL | `/be-api/service/api/geoChat/generate` |
| 请求头 | `Authorization: Bearer {access_token}` |
| 请求参数 | 无 |

**响应示例**

```json
{
    "code": "00000",
    "msg": null,
    "data": "11535115-9f0c-4c07-9da8-71db5648625b",
    "traceId": "39960dcff0df420c9e309b695c103914"
}
```

`data` 即为 `sessionId`（UUID 字符串），后续调用 `发送消息` 时必须传入。

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/geoChat/generate' \
--header 'Authorization: Bearer {access_token}'
```

**Python 示例**

```python
import requests

def make_authenticated_request(url, access_token):
    """执行带 Bearer Token 认证的 HTTP GET 请求。

    返回: dict，包含 status_code / headers / data
    异常: requests.exceptions.RequestException
    """
    headers = {'Authorization': f'Bearer {access_token}'}
    try:
        response = requests.get(url, headers=headers, timeout=10)  # 建议总是设置超时
        try:
            response_data = response.json()
        except ValueError:
            response_data = response.text
        return {
            'status_code': response.status_code,
            'headers': dict(response.headers),
            'data': response_data,
        }
    except requests.exceptions.RequestException as e:
        error_info = {'error_type': type(e).__name__, 'error_message': str(e)}
        if isinstance(e, requests.exceptions.Timeout):
            error_info['timeout'] = 10
        raise requests.exceptions.RequestException(f"请求失败: {error_info}") from e


if __name__ == "__main__":
    result = make_authenticated_request(
        url="https://geogpt.zero2x.org.cn/be-api/service/api/geoChat/generate",
        access_token="{access_token}",
    )
    print(f"响应状态码: {result['status_code']}")
    print(f"响应数据: {result['data']}")   # data.data 即 sessionId
```

---

## 9. 接口二：发送消息（流式问答）`/geoChat/sendMsg`

**接口说明**：发送问题，以流式（SSE）方式获取回答。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `POST` |
| URL | `/be-api/service/api/geoChat/sendMsg` |
| 请求头 | `Authorization: Bearer {access_token}`、`Content-Type: application/json` |

**请求体参数**

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 是 | 问题文本 |
| `sessionId` | string | 是 | 会话 ID，由「创建会话」接口返回 |
| `module` | string | 否 | 模型名称，不传则用默认模型 |
| `isRAG` | boolean | 否 | 个人库 RAG 开关 |
| `isRAGCommon` | boolean | 否 | 公共库 RAG 开关 |

**可用模型名称**

```text
Qwen2.5-72B-GeoGPT
GeoGPT-R1-Preview
DeepSeekR1-GeoGPT
```

**请求示例**

```json
{
    "text": "who are you",
    "sessionId": "11535115-9f0c-4c07-9da8-71db5648625b",
    "module": "DeepSeekR1-GeoGPT"
}
```

> `sessionId` 是必传项，用于维护该接口多轮对话的上下文范围。
>
> 实测多轮上下文**确实生效**：同一 `sessionId` 内先问"什么是俯冲带"，再追问"把你上一条回答里提到的板块名称单独列出来"，模型准确返回"欧亚板块、菲律宾海板块"。换 `sessionId` 即开新会话，上下文不互通。

**成功响应（实测格式，2026-09-29 验证）**

> ⚠️ 官方文档此处写的是 `<markdown>` XML 标签 + 双重 URL 编码，**已过期**。线上实际返回的是 OpenAI chunk 格式，且每一块被 JSON 转义了**两层**。照官方格式写解析代码会直接失败，请以本节为准。

实际流内容：

```text
data:"{\"choices\":[{\"delta\":{\"reasoning_content\":\"俯冲带\"},\"index\":0}],\"object\":\"chat.completion.chunk\"}"

data:"{\"choices\":[{\"delta\":{\"content\":\"俯冲带是指地球板块汇聚边界处...\"},\"index\":0}],\"object\":\"chat.completion.chunk\"}"

data:[DONE]
```

| 字段 | 含义 |
| --- | --- |
| `choices[0].delta.reasoning_content` | 模型思考过程（R1 系列模型才有），可单独展示或丢弃 |
| `choices[0].delta.content` | 正式回答正文，增量拼接 |
| `choices[0].index` | 固定 `0` |
| `object` | 固定 `chat.completion.chunk` |
| `[DONE]` | 流结束标记（**不是** 官方文档写的 `<end></end>`） |

实测一次问答产生 282 个 `data:` 块，思考 570 字 + 回答 118 字；`reasoning_content` 会先于 `content` 全部输出完。

**正确的解析代码（Python）**

```python
import json
import requests

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _unwrap(payload: str):
    """data: 后的内容可能被 JSON 转义多层，循环剥到对象为止。"""
    obj = json.loads(payload)
    while isinstance(obj, str):
        obj = json.loads(obj)
    return obj


def chat(session_id, question, module="GeoGPT-R1-Preview", timeout=(10, 300)):
    """流式调用 sendMsg，逐块产出 (kind, text)。kind 为 'reasoning' 或 'content'。"""
    with requests.post(
        "https://geogpt.zero2x.org.cn/be-api/service/api/geoChat/sendMsg",
        headers=HEADERS, stream=True, timeout=timeout,
        json={"text": question, "sessionId": session_id, "module": module},
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                return
            data = _unwrap(payload)
            delta = data["choices"][0].get("delta", {})
            if delta.get("reasoning_content"):
                yield "reasoning", delta["reasoning_content"]
            if delta.get("content"):
                yield "content", delta["content"]


if __name__ == "__main__":
    answer = ""
    for kind, text in chat("{session_id}", "用一句话说明什么是俯冲带"):
        print(text, end="", flush=True)
        if kind == "content":
            answer += text
```

<details>
<summary>官方文档的旧格式（已过期，仅供对照）</summary>

```text
"<type>-1</type><sessionId>...</sessionId><questionId>...</questionId><answerId>...</answerId><markdown>%5B%7B...%5D</markdown><end></end>"
```

`<markdown>` 内容需连续 `decodeURIComponent` 两次，得到 `[{"type": "MarkDown", "content": "..."}]`。
若未来线上回退到该格式，按 `<end></end>` 判结束。

</details>

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/geoChat/sendMsg' \
--header 'Authorization: Bearer {access_token}' \
--header 'Content-Type: application/json' \
--data '{
    "text": "who are you",
    "sessionId": "65a2c548-3969-41a9-9eee-0617cc5ec851",
    "module": "GeoGPT-R1-Preview"
}'
```

**Python 流式处理示例**

```python
import requests
import warnings
from typing import Callable


def handle_text_stream(url: str,
                       access_token: str,
                       payload: dict,
                       callback: Callable[[str], None],
                       chunk_size: int = 1024,
                       delimiter: str = '\n\n') -> None:
    """处理纯文本 SSE 流式响应。

    url:        流式接口端点
    access_token: 认证令牌
    payload:    请求负载
    callback:   每收到一个完整事件时触发
    chunk_size: 网络读取块大小（字节）
    delimiter:  事件分隔符（默认 SSE 标准双换行）
    """
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
    }

    buffer = ''  # 跨数据块的缓冲区
    try:
        with requests.post(url, headers=headers, json=payload,
                           stream=True, timeout=(3.05, 30)) as resp:
            resp.raise_for_status()
            for byte_chunk in resp.iter_content(chunk_size=chunk_size):
                if not byte_chunk:
                    continue
                try:
                    text_chunk = byte_chunk.decode('utf-8')
                except UnicodeDecodeError:
                    text_chunk = byte_chunk.decode('utf-8', errors='replace')
                    warnings.warn("检测到非 UTF-8 编码字符，已替换异常编码点")

                buffer += text_chunk
                while delimiter in buffer:
                    event_raw, buffer = buffer.split(delimiter, 1)
                    process_sse_event(event_raw.strip(), callback)

    except requests.exceptions.RequestException as e:
        error_msg = f"流式连接异常: {str(e)}"
        if buffer:
            error_msg += f"\n未处理缓冲数据: {buffer[:200]}{'...' if len(buffer) > 200 else ''}"
        callback(f"[ERROR] {error_msg}")


def process_sse_event(raw_event: str, callback: Callable[[str], None]) -> None:
    """解析 SSE 事件格式并提取纯文本内容。

    SSE 事件示例：
    data: 第一行内容
    data: 第二行内容
    """
    event_lines = [line.strip() for line in raw_event.split('\n') if line.strip()]
    content_lines = []
    for line in event_lines:
        if line.startswith('data:'):
            content_lines.append(line[5:].lstrip())
        elif line.startswith(':'):
            continue  # 忽略注释行
    full_content = '\n'.join(content_lines)
    if full_content:
        callback(full_content)


if __name__ == "__main__":
    def demo_callback(content: str):
        if content.startswith('[ERROR]'):
            print(f"\033[31m{content}\033[0m")
        else:
            print(f"收到内容: {content}")

    try:
        handle_text_stream(
            url="https://geogpt.zero2x.org.cn/be-api/service/api/geoChat/sendMsg",
            access_token="{access_token}",
            payload={
                "text": "实时天气报告",
                "sessionId": "65a2c548-3969-41a9-9eee-0617cc5ec851",
                "module": "GeoGPT-R1-Preview",
            },
            callback=demo_callback,
        )
    except KeyboardInterrupt:
        print("\n用户主动终止连接")
```

---

## 10. 接口三：个人库 RAG 检索 `/rag/top_k`

**接口说明**：知识库检索，需绑定个人账号或团队。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `POST` |
| URL | `/be-api/service/api/rag/top_k` |
| 请求头 | `Authorization: Bearer {access_token}`、`Content-Type: application/json` |

**请求参数**

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 检索关键字。个人库实测**中英文均可**（中文查询正常命中），与公共库"仅英文有效"不同 |
| `pathList` | String[] | 否 | 知识库目录，取自 GeoGPT **MyLibrary** 中已上传文档的路径列表；空数组表示全库 |
| `topK` | int | 否 | 返回关联度最高的前 K 条结果 |
| `isTeam` | boolean | 否 | `false` 查个人库，`true` 查团队库 |

**请求示例**

```json
{
  "query": "What is the significance of the Fe/Si and Mg/Si ratios in the model?",
  "pathList": [],
  "topK": 8,
  "isTeam": false
}
```

**响应示例**（结构已简化，实际返回条数由 `topK` 决定）

```json
{
  "code": "00000",
  "msg": null,
  "data": {
    "vector_time": 0.23685932159423828,
    "final": [
      [
        {
          "page_content": "The Fe/Si and Mg/Si ratios are significant in the model because they play a crucial role in determining the composition and structure of planets. ...",
          "metadata": {
            "id": "453602908571999898",
            "distance": 0.8422842025756836,
            "document_id": "1860962635752136705",
            "chunk_id": "1860962635752136705-9",
            "chunk_index": 9,
            "section": " Answer ",
            "user_id": "1762287698729730050",
            "text_type": "text",
            "title": "How My Documents Work",
            "journal": "",
            "year": null,
            "authors": []
          },
          "type": "Document"
        },
        0.9999999999999913
      ],
      [
        {
          "page_content": "In the first hypothesis, it is assumed that the solids formed in equilibrium from the material of the solar nebula ...",
          "metadata": {
            "id": "453602908581637369",
            "distance": 0.7756304740905762,
            "document_id": "1861962142337470465",
            "chunk_id": "1861962142337470465-3",
            "chunk_index": 3,
            "section": "1. Introduction ",
            "user_id": "1762287698729730050",
            "text_type": "text",
            "title": "Elemental ratios in stars vs planets (Research Note)",
            "journal": "",
            "year": null,
            "authors": ["Amaury Thiabaud", "Ulysse Marboeuf", "Yann Alibert", "Ingo Leya", "Klaus Mezger"]
          },
          "type": "Document"
        },
        0.9999998284043795
      ]
    ]
  },
  "traceId": "36b02e4d893fdbe02af74052870e589c"
}
```

**响应字段说明（实测，2026-09-29）**

个人库 `final` 的每一项确实是 `[文档块, 分数]` 二元组，与官方文档一致，但**实测细节不同**：

| 字段 | 实测情况 |
| --- | --- |
| `data.vector_time` | 向量化耗时（秒），实测 0.17 左右 |
| `data.final[i]` | `[文档块, 分数]` 二元组 |
| `data.final[i][1]` | ⚠️ 实测**恒为 `0.0`**，不可用作相关度判据 |
| `page_content` | 命中的文本片段，LaTeX 公式以 `$...$` 原样返回 |
| `metadata.Auto_id` | 官方文档写的是 `id`，线上实际字段名是 `Auto_id` |
| `metadata.distance` | 个人库实测符合官方说法「越大越接近」：中文查"自进化智能体 生成"命中相关文档 distance ≈ 0.42，用地学词去查无关内容只有 ≈ 0.05。建议按 `distance >= 0.3` 粗筛 |
| `metadata.document_id` / `chunk_index` | 文档与分块定位，可回链原文；⚠️ 官方文档写的 `chunk_id` 实测**不存在** |
| `metadata.text_type` | `text` / `table`，表格块单独标注，便于过滤 |
| `metadata.title` / `section` | 文献标题与章节 |
| `metadata.user_id` / `journal` / `year` / `authors` | ⚠️ 官方文档列出，实测**均不返回** |
| `type` | 固定 `Document` |

> ⚠️ **检索结果不会因"不相关"而返回空**。实测用一个与库内内容完全无关的地学关键词查个人库（库里只有一篇 AI 论文），接口照样返回 3 条"最接近"的结果。因此把 RAG 结果直接喂给模型前，**必须自己按 `distance` 或 `metadata.score` 卡阈值**，否则会把无关文献当依据。另外 `pathList` 传空数组等于全库检索，官方未提供"无匹配则返回空"的开关。

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/rag/top_k' \
--header 'Authorization: Bearer {access_token}' \
--header 'Content-Type: application/json' \
--data '{
    "query": "数据抽取",
    "pathList": [],
    "topK": 2,
    "isTeam": false
}'
```

**Python 示例**

```python
import requests
from typing import Dict, Any


def send_post_request(url: str,
                      access_token: str,
                      payload: Dict[str, Any],
                      timeout: float = 10.0) -> Dict[str, Any]:
    """执行带认证的 JSON POST 请求。

    返回: dict，包含 status_code / headers / data
    异常: requests.exceptions.RequestException（封装全部请求异常）
    """
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        try:
            response_data = response.json()
        except ValueError:
            response_data = response.text
        return {
            'status_code': response.status_code,
            'headers': dict(response.headers),
            'data': response_data,
        }
    except requests.exceptions.RequestException as e:
        raise requests.exceptions.RequestException({
            'error_type': type(e).__name__,
            'status_code': getattr(e.response, 'status_code', None),
            'error_message': str(e),
            'request_payload': payload,   # 保留请求数据用于调试
        }) from e


if __name__ == "__main__":
    result = send_post_request(
        url="https://geogpt.zero2x.org.cn/be-api/service/api/rag/top_k",
        access_token="{access_token}",
        payload={"query": "数据抽取", "pathList": [], "topK": 2, "isTeam": False},
    )
    print(f"状态码: {result['status_code']}")
    print("响应数据:")
    print(result['data'])
```

---

## 11. 接口四：公共库 RAG 检索 `/rag/top_k_common`

**接口说明**：在 GeoGPT 公共知识库中做知识检索，无需绑定个人文档。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `POST` |
| URL | `/be-api/service/api/rag/top_k_common` |
| 请求头 | `Authorization: Bearer {access_token}`、`Content-Type: application/json` |

**请求参数**

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 检索关键字。**实测必须用英文**，中文查询返回 0 条（公共库语料以英文文献为主） |
| `ragSwitch` | string | 否 | 知识库选择，常用值 `chat_common` |
| `topK` | int | 否 | 返回关联度最高的前 K 条结果 |
| `scoreThreshold` | float | 否 | 相关度分数阈值，低于该值的结果被过滤 |
| `expandSwitch` | bool | 否 | 是否开启上下文扩展 |
| `expandRange` | int | 否 | 扩展范围（字符数） |

**请求示例**

```json
{
  "query": "What is the significance of the Fe/Si and Mg/Si ratios in the model?",
  "ragSwitch": "chat_common",
  "topK": 8,
  "scoreThreshold": 0.35,
  "expandSwitch": true,
  "expandRange": 1000
}
```

**响应结构（实测，2026-09-29）**

> ⚠️ 官方称本接口结构与个人库一致，**实测并不一致**：公共库的 `final` 是**扁平对象数组**（没有外层分数），相关度放在 `metadata.score` 里；个人库才是 `[文档块, 分数]` 二元组。两个接口要写两套解析。

实测返回（英文查询 `noble gas isotope composition in subduction zone basalts`，`topK=3`，命中 3 条）：

```json
{
  "code": "00000",
  "msg": null,
  "data": {
    "vector_time": 0.20835304260253906,
    "final": [
      {
        "page_content": "Due to the apparent immobility of Hf in slab-derived fluids, we used the Hf isotopes to see through the subduction signal and determine whether the inferred mantle source for the investigated basalts was Indian or Pacific in petrological nature. ...",
        "metadata": {
          "Auto_id": "455798604778542120",
          "distance": 0.383391797542572,
          "document_id": "646741378638022247",
          "chunk_index": 18,
          "section": "",
          "text_type": "text",
          "title": "Basalt from the Extinct Spreading Center in the West Philippine Basin: New Geochemical Results and Their Petrologic and Tectonic Implications",
          "score": 0.9666001780666844
        },
        "type": "Document"
      }
    ]
  },
  "traceId": "..."
}
```

| 字段 | 实测说明 |
| --- | --- |
| `data.final[i]` | 直接是文档块对象，**不是**二元组 |
| `metadata.score` | 相关度分数（实测 0.9666），本接口的判据用这个字段 |
| `metadata.distance` | 距离值，与 `score` 非简单互补关系，不要混用 |
| `metadata.section` | 实测常为空字符串，别指望它做定位 |
| `metadata.title` / `document_id` / `chunk_index` | 生成引用与回链原文用 |

实测命中的都是真实地学文献（西菲律宾盆地玄武岩、稀有气体同位素分馏等），检索质量不错，但**只有英文查询有效**。

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/rag/top_k_common' \
--header 'Authorization: Bearer {access_token}' \
--header 'Content-Type: application/json' \
--data '{
    "query": "What are the composition characteristics of noble gas isotopes in subduction zone basalt?",
    "topK": 2,
    "ragSwitch": "chat_common",
    "scoreThreshold": 0.35,
    "expandSwitch": true,
    "expandRange": 1000
}'
```

**Python 示例**：复用第 10 节的 `send_post_request`，仅替换 URL 与 payload：

```python
result = send_post_request(
    url="https://geogpt.zero2x.org.cn/be-api/service/api/rag/top_k_common",
    access_token="{access_token}",
    payload={
        "query": "What are the composition characteristics of noble gas isotopes in subduction zone basalt?",
        "topK": 2,
        "ragSwitch": "chat_common",
        "scoreThreshold": 0.35,
        "expandSwitch": True,
        "expandRange": 1000,
    },
)
```

---

## 12. 接口五：大模型服务（OpenAI 兼容）`/model/v1/chat/completions`

> 🔴 **实测不可用（2026-09-29）**：本接口与[模型列表](#13-接口六模型列表-modelv1models)均返回
> `{"code":"0001","msg":"system error","data":"401 Unauthorized from GET http://10.202.24.202:4000/v1/models"}`
> ——是上游模型网关（LiteLLM）鉴权失败，**不是本地 key 的问题**（同一 key 调其余 4 个接口全部正常）。多次重试结果一致。需要裸模型能力时，暂时改用 `sendMsg`。以下内容按官方文档保留，待服务恢复后再验证。

**接口说明**：跳过会话与 RAG，直接调用大模型。请求与响应遵循标准 OpenAI Chat Completions 规范。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `POST` |
| URL | `/be-api/service/api/model/v1/chat/completions` |
| 请求头 | `Authorization: Bearer {access_token}`、`Content-Type: application/json` |
| 默认模型 | `Qwen2.5`（暂不支持通过参数指定模型） |

**请求参数**

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messages` | array\<object\> | 是 | 消息列表，每项含 `role`（`user`/`system`/`assistant`）与 `content` |
| `temperature` | float | 否 | 生成随机性，`0.0` 保守 → `2.0` 创意，默认 `1.0` |
| `max_tokens` | integer | 否 | 生成的最大 token 数（受模型上限限制） |
| `top_p` | float | 否 | 概率采样阈值，`0.1` 聚焦 → `1.0` 广泛，默认 `1.0` |
| `n` | integer | 否 | 生成多少个独立结果，默认 `1` |
| `stream` | boolean | 否 | 是否流式输出，默认 `false` |
| `stop` | string 或 array\<string\> | 否 | 停止词，如 `["\n", "。"]` |
| `presence_penalty` | float | 否 | 避免重复话题，`-2.0` → `2.0`，默认 `0` |
| `frequency_penalty` | float | 否 | 抑制高频词，`-2.0` → `2.0`，默认 `0` |
| `logit_bias` | map\<string, integer\> | 否 | 调整指定 token 的生成概率，如 `{"50256": -100}` 表示禁用该 token |

**请求示例**

```json
{
    "messages": [
        {
            "role": "user",
            "content": "tell me sth about DDD!"
        }
    ],
    "stream": true
}
```

**响应示例**（流式分块，与非流式返回结构与大模型直出一致）

```json
{
    "id": "chatcmpl-24e85a44c70da9baeafb390357581d27",
    "object": "chat.completion.chunk",
    "created": 1748508502,
    "model": "/mnt/models/geogpt/q25-72b_sft-2nd-new-data-v4_wi-geo-gt_mixed_sample-rag",
    "choices": [
        {
            "index": 0,
            "delta": { "content": "," },
            "logprobs": null,
            "finish_reason": null
        }
    ]
}
```

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/model/v1/chat/completions' \
--header 'Authorization: Bearer {access_token}' \
--header 'Content-Type: application/json' \
--data '{
    "messages": [
        {
            "role": "user",
            "content": "hello!"
        }
    ],
    "stream": true
}'
```

**Python 流式示例**

```python
import requests
import json


def stream_chat_completion(access_token, user_message, api_url=None):
    """调用流式聊天完成 API。

    参数:
        access_token: 认证令牌
        user_message: 用户消息内容
        api_url:      API 地址，默认为 GeoGPT 服务
    返回:
        list: 所有响应块
    """
    if api_url is None:
        api_url = "https://geogpt.zero2x.org.cn/be-api/service/api/model/v1/chat/completions"

    headers = {
        'Authorization': f'Bearer {access_token}',
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [{"role": "user", "content": user_message}],
        "stream": True,
    }
    responses = []

    try:
        with requests.post(api_url, headers=headers, json=payload, stream=True) as response:
            response.raise_for_status()
            print(f"响应状态码: {response.status_code}")
            print("开始接收流式响应...")

            for chunk in response.iter_lines():
                if not chunk:
                    continue          # 过滤保活空行
                decoded_chunk = chunk.decode('utf-8')
                try:
                    # 兼容 SSE 的 "data:" 前缀
                    json_str = decoded_chunk[5:] if decoded_chunk.startswith("data:") else decoded_chunk
                    if json_str == 'event:message':
                        continue
                    if json_str.strip() == "[DONE]":
                        print("\n收到结束标记 [DONE]")
                        break

                    # 反转义：\" -> "，\\ -> \，并去掉外层引号
                    unescaped = json_str.replace('\\"', '"').replace('\\\\', '\\')
                    if unescaped.startswith('"') and unescaped.endswith('"'):
                        unescaped = unescaped[1:-1]

                    data = json.loads(unescaped)
                    responses.append(data)

                    if data.get('choices'):
                        content = data['choices'][0].get('delta', {}).get('content', '')
                        if content:
                            print(content, end='', flush=True)

                except json.JSONDecodeError as e:
                    print(f"\n无法解析 JSON: {decoded_chunk}\n错误详情: {str(e)}")
                except Exception as e:
                    print(f"\n处理错误: {str(e)}")

    except requests.exceptions.RequestException as e:
        print(f"\n请求失败: {str(e)}")
    except Exception as e:
        print(f"\n发生错误: {str(e)}")

    return responses


if __name__ == "__main__":
    access_token = "{access_token}"      # 替换为实际访问令牌
    user_message = "你好，请介绍一下中国的长江"

    print(f"发送消息: {user_message}\n等待 AI 回复...\n")
    responses = stream_chat_completion(access_token, user_message)

    print("\n\n===== 响应摘要 =====")
    print(f"收到 {len(responses)} 个响应块")

    full_content = ""
    for r in responses:
        if r.get('choices'):
            full_content += r['choices'][0].get('delta', {}).get('content', '') or ""

    print("\n完整回复内容:")
    print(full_content)
```

---

## 13. 接口六：模型列表 `/model/v1/models`

> 🔴 **实测不可用（2026-09-29）**：与「大模型服务」同样返回上游 `401 Unauthorized`，详见[第 12 节开头说明](#12-接口五大模型服务openai-兼容modelv1chatcompletions)。

**接口说明**：获取模型服务当前可用的模型列表（OpenAI `models` 规范）。

| 项目 | 值 |
| --- | --- |
| 请求方式 | `GET` |
| URL | `/be-api/service/api/model/v1/models` |
| 请求头 | `Authorization: Bearer {access_token}` |
| 请求参数 | 无 |

**响应示例**

```json
{
    "object": "list",
    "data": [
        {
            "id": "/mnt/models/geogpt/q25-72b_sft-2nd-new-data-v4_wi-geo-gt_mixed_sample-rag",
            "object": "model",
            "created": 1760597986,
            "owned_by": "vllm",
            "root": "/mnt/models/geogpt/q25-72b_sft-2nd-new-data-v4_wi-geo-gt_mixed_sample-rag",
            "parent": null,
            "max_model_len": 80000,
            "permission": [
                {
                    "id": "modelperm-3a353e351e984cc28dfda5920b393235",
                    "object": "model_permission",
                    "created": 1760597986,
                    "allow_create_engine": false,
                    "allow_sampling": true,
                    "allow_logprobs": true,
                    "allow_search_indices": false,
                    "allow_view": true,
                    "allow_fine_tuning": false,
                    "organization": "*",
                    "group": null,
                    "is_blocking": false
                }
            ]
        }
    ]
}
```

关键字段：`id` 为模型标识，`max_model_len` 为上下文长度上限（示例中为 80000）。

**curl 示例**

```shell
curl --location 'https://geogpt.zero2x.org.cn/be-api/service/api/model/v1/models' \
--header 'Authorization: Bearer {access_token}'
```

**Python 示例**：复用第 8 节的 `make_authenticated_request`：

```python
result = make_authenticated_request(
    url="https://geogpt.zero2x.org.cn/be-api/service/api/model/v1/models",
    access_token="{access_token}",
)
print(f"响应状态码: {result['status_code']}")
print(f"响应数据: {result['data']}")
```

---

## 14. 端到端最小可用示例

以下代码为 2026-09-29 实测跑通的版本（RAG 召回 → 增强问答 → 多轮追问）：

```python
import json
import os
import requests

BASE = "https://geogpt.zero2x.org.cn"
TOKEN = os.environ["GEOGPT_TOKEN"]          # 见 6.3 凭证保管
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _unwrap(payload: str):
    """sendMsg 的每个 data: 块被 JSON 转义了多层，循环剥到对象为止。"""
    obj = json.loads(payload)
    while isinstance(obj, str):
        obj = json.loads(obj)
    return obj


def new_session() -> str:
    r = requests.get(f"{BASE}/be-api/service/api/geoChat/generate",
                     headers=HEADERS, timeout=15)
    body = r.json()
    assert body["code"] == "00000", body
    return body["data"]                      # sessionId


def rag_common(query_en: str, top_k: int = 3, min_score: float = 0.9):
    """公共库检索。注意：query 必须用英文，否则 0 命中。"""
    r = requests.post(f"{BASE}/be-api/service/api/rag/top_k_common", headers=HEADERS,
                      json={"query": query_en, "topK": top_k,
                            "ragSwitch": "chat_common",
                            "scoreThreshold": 0.2, "expandSwitch": False},
                      timeout=90)
    hits = r.json()["data"]["final"]
    # 公共库返回扁平对象，相关度在 metadata.score
    return [h for h in hits if (h["metadata"].get("score") or 0) >= min_score]


def ask(session_id: str, question: str, show_reasoning: bool = False):
    """流式问答，返回正式回答文本。"""
    answer = ""
    with requests.post(f"{BASE}/be-api/service/api/geoChat/sendMsg", headers=HEADERS,
                       json={"text": question, "sessionId": session_id,
                             "module": "GeoGPT-R1-Preview"},
                       stream=True, timeout=(10, 300)) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                return answer
            delta = _unwrap(payload)["choices"][0].get("delta", {})
            if show_reasoning and delta.get("reasoning_content"):
                print(delta["reasoning_content"], end="", flush=True)
            if delta.get("content"):
                answer += delta["content"]
                print(delta["content"], end="", flush=True)


if __name__ == "__main__":
    sid = new_session()
    print("sessionId:", sid)

    hits = rag_common("noble gas isotope composition in subduction zone basalts")
    print(f"公共库命中 {len(hits)} 篇")
    for h in hits:
        print(" -", h["metadata"]["title"][:70], f"(score={h['metadata']['score']:.3f})")

    context = "\n\n".join(h["page_content"] for h in hits)
    question = (f"请仅依据下列材料回答：俯冲带玄武岩的稀有气体同位素有哪些组成特征？\n\n{context}"
                if context else "俯冲带玄武岩的稀有气体同位素有哪些组成特征？")

    print("\n=== 回答 ===")
    ask(sid, question)

    print("\n=== 多轮追问（同 sessionId，上下文自动衔接）===")
    ask(sid, "把你上一条回答里引用的文献标题列出来，只给标题。")
```

个人库检索只需换接口，**但解析结构不同**（二元组、外层分数恒为 0，改用 `metadata.distance`）：

```python
def rag_personal(query: str, top_k: int = 3, path_list=None):
    r = requests.post(f"{BASE}/be-api/service/api/rag/top_k", headers=HEADERS,
                      json={"query": query, "pathList": path_list or [],
                            "topK": top_k, "isTeam": False},
                      timeout=90)
    pairs = r.json()["data"]["final"]
    return [p[0] for p in pairs]             # p[1] 恒为 0.0，别用它过滤
```

裸模型接口（`/model/v1/chat/completions`）实测当前不可用，见[第 12 节](#12-接口五大模型服务openai-兼容-modelv1chatcompletions)；恢复后用法如下：

```python
r = requests.post(f"{BASE}/be-api/service/api/model/v1/chat/completions",
                  headers=HEADERS,
                  json={"messages": [{"role": "user", "content": "你好"}], "stream": False},
                  timeout=120)
print(r.json()["choices"][0]["message"]["content"])
```

---

## 15. 官方文档勘误与注意事项

问题分两类：15.1 是官方原文的文字性错误，15.2 是线上行为与文档已经脱节的结构性偏差。实际调用请以本节和各接口内的"实测"标注为准。

### 15.1 官方原文的文字性错误

| 位置 | 官方原文问题 | 建议 |
| --- | --- | --- |
| 公共库 RAG 参数表 | 参数名写作 `eandRange`，明显是 `expandRange` 的漏字 | 使用 `expandRange`（官方 curl 示例即为该拼写） |
| 公共库 RAG 请求示例 | 示例体写的是 `pathList` / `isTeam`，与其自身参数表（`ragSwitch`/`scoreThreshold`/`expandSwitch`）不符 | 按参数表构造请求，参考本文第 11 节示例 |
| 个人库 RAG curl 示例 | 使用了 `isChina` 字段，而参数表定义的是 `isTeam` | 使用 `isTeam` |
| 个人库/公共库 Python 示例 | 示例 payload 沿用了 `isChina`，且公共库示例复制了个人库的参数 | 按各自参数表构造 |
| 大模型服务 | 文档说明「模型暂不支持设置」，但响应里会返回具体 `model` 路径 | 服务恢复后实测 `model` 字段是否生效 |
| 认证头大小写 | 大模型服务 curl 示例用小写 `authorization` | HTTP 头大小写不敏感，统一用 `Authorization` 更清晰 |
| 参数命名 | 「查询参数」一节实际是 JSON 请求体字段 | 按 `Content-Type: application/json` 的请求体发送 |

### 15.2 实测与官方文档的结构性偏差（2026-09-29）

这些不是笔误，而是**线上行为已经变了、文档没跟着更新**，照文档写代码会直接失败：

| 位置 | 官方文档 | 线上实测 |
| --- | --- | --- |
| `sendMsg` 响应 | `<markdown>` XML 标签 + 双重 URL 编码，`<end></end>` 结束 | OpenAI chunk 格式，每块**双层 JSON 转义**，`[DONE]` 结束；含 `reasoning_content` |
| `sendMsg` 字段 | 返回 `sessionId` / `questionId` / `answerId` | 均不返回，只有 `delta.reasoning_content` 与 `delta.content` |
| 公共库 RAG 结构 | 与个人库一致，`final` 为 `[文档块, 分数]` 二元组 | `final` 为**扁平对象数组**，分数在 `metadata.score` |
| 个人库 RAG 分数 | 二元组第二项为相关度 | 第二项**恒为 `0.0`**，不可用 |
| RAG `metadata` | 含 `id` / `chunk_id` / `user_id` / `journal` / `year` / `authors` | 实际为 `Auto_id`，且 `chunk_id`/`user_id`/`journal`/`year`/`authors` **都不返回** |
| 检索语言 | 未说明 | 公共库**纯中文查询 0 命中**（如"板块构造""华北克拉通破坏"）；混合查询命中的只是其中夹带的拉丁片段，"锆石U-Pb定年"实为 `U-Pb` 起作用 |
| 认证失败形态 | 全局错误码写 401 | 无效 token 返回 **HTTP 200 + `code:"2020"`、`msg:"token illegal"`**，只看状态码会当成成功 |
| `sessionId` 校验 | 未说明 | **不校验**：传全 0 的伪造 id 不报错，直接返回空回答（成功但内容为空） |
| 团队库 `isTeam:true` | 未说明 | 无团队时 `data` 直接是空数组 `[]`，而非 `{vector_time, final}` 对象 |
| 大模型服务 / 模型列表 | 正常可用 | 上游网关 `401 Unauthorized`，两接口均不可用 |

### 15.3 实践建议

- **务必设置超时**：`sendMsg` 为长流式响应，读取超时应放宽到分钟级（如 `timeout=(10, 300)`）；实测一次短问答约 33KB / 282 块。
- **流结束判定**：`sendMsg` 与 `chat/completions` 实测都以 `[DONE]` 结束，**不是** 官方文档写的 `<end></end>`。
- **错误处理分层**：先判 HTTP 状态码（401/403/404/500），再判业务 `code` 是否为 `"00000"`；注意上游故障会以 `code: "0001"` + `data` 里塞错误串的形式返回（HTTP 仍是 200）。
- **RAG 结果必须自卡阈值**：接口不会因为不相关而返回空，见第 10 节警告。
- **`traceId` 留痕**：失败时记录 `traceId`，向 support.geogpt@zhejianglab.org 报障时附上（本文 15.2 表最后一条即可凭此报障）。
- **知识库前置条件**：`/rag/top_k` 依赖已在 GeoGPT 网页端 **MyLibrary** 上传的文档，`pathList` 需从该库中取路径；空数组为全库检索。
- **Token 保密**：`{access_token}` 不要写进前端代码或提交到仓库，改用环境变量注入，详见 6.3。

### 15.4 第二轮全量复测补充（2026-10-03）

| 项目 | 实测结果 |
| --- | --- |
| 三个模型可用性 | `Qwen2.5-72B-GeoGPT` 8.1s / `GeoGPT-R1-Preview` 12.4s / `DeepSeekR1-GeoGPT` 7.0s，同一问题三者均给出正确的三类板块边界答案 |
| 多轮上下文 | 同 `sessionId` 追问"我上一条提到的岩石是什么"准确答出"科马提岩"；换新会话问同样的话，模型明确回答没有历史记录 —— 上下文确实由服务端会话维持 |
| 并发 | 4 路并发问答总耗时 12.3s，无失败，远低于 RPM 1000 |
| `metadata` 实际字段 | 公共库为 `Auto_id, distance, section, text_type, title, document_id, chunk_index, score`（公共库也带 `distance`）；`year`/`journal`/`authors` 依然不返回 |
| 个人库 `distance` 分布 | 相关查询≈0.31；无关查询即使完全不相干也会满 `topK` 返回，`distance` 低至 0.02–0.04。默认阈值 0.3 卡在边界，小库容易被全滤掉，可用 `--min-distance 0` 先看原始召回 |
| 超长输入 | 1.8 万字中文提问正常（23.7s，答案 464 字）；18 万字提问**不报错也不返回，一直挂到客户端超时**，务必自己限制 prompt 规模 |
| 证据增强链路 | `--ground` + 英文检索词命中共识岩/水热锆石等真实文献，回答按"材料[1]/[2]/[3]"编号引用，且只使用材料内信息 |
| 本地材料证据增强 | `--file` 走本地挑段注入，实测 202 段文档只注入相关 2 段（177 字），答案准确引用 `[本地1]`；材料未覆盖时明确拒答 |
| 本账号知识库现状 | 个人库仅 1 篇文档（ALITA-G），团队库为空 —— 个人库检索**链路已验证、检索质量无从验证** |

### 15.5 上传类接口存在，但开发者密钥无权访问（2026-10-04）

从网页前端（`/cn` 的 53 个 JS chunk）逆向出一整套**官方未文档化**的 MyLibrary 接口，网关前缀是 `https://geogpt.zero2x.org.cn/be-api/portal-api`，与本文档的 `be-api/service/api` 不同源：

| 未公开接口 | 用途 |
| --- | --- |
| `GET /geoCopilot/oss/uploadInfo?fileName=&type=` | 取 OSS 上传凭证（配合分片 `CompleteMultipartUpload`） |
| `POST /geoCopilot/documents`、`/files`、`/folderFiles` | 文档/文件入库、目录列表 |
| `GET /geoCopilot/folder/tree?folderName=`、`/rag/folder/tree` | 目录树 |
| `POST /geoCopilot/document/checkAndGetUploadInfo`、`/document/format`、`/document/readDocument/` | 上传前校验、格式化、读取 |
| `POST /geoChat/saveDocument`、`/docPreHandle`、`/docParseProgress` | 保存与解析进度轮询 |
| `POST /geoCopilot/documents/delete`、`/file/move`、`PUT /file/{id}`、`/recycle/files` | 删除、移动、回收站 |

**鉴权边界（实测）**：同一把 `sk-` 开发者密钥——

```
GET portal-api/geoCopilot/folder/tree    → HTTP 401 {"code":"0001","error":"Unauthorized","status":401}
GET portal-api/geoCopilot/oss/uploadInfo → HTTP 401 同上
GET service/api/geoChat/generate         → HTTP 200 {"code":"00000", ...}   ← 对照组
```

即 `portal-api` 认的是**网页登录后的 session JWT**，开发者 API Key 只覆盖 `service/api` 那 6 个接口。注意这里的 401 是网关标准错误体（`error`/`status`），与官方文档描述的 `code:"2020"` 业务信封不是一回事。

**结论**：想用 API 喂自己的资料，走本地文件注入（`ask.mjs --file`）；要进平台个人库只能在网页端手动上传，再用 `/rag/top_k` 检索。不要把浏览器登录态拿来调 `portal-api`。


---

## 16. 这个 API 能帮你做的具体事情

以下场景都是**实测跑通或据实测能力推断**的，不是宣传语。

### 16.1 已验证可用的能力

| 能力 | 用到的接口 | 实测证据 |
| --- | --- | --- |
| 地学领域问答 | `generate` + `sendMsg` | 问"什么是俯冲带"，答出板块汇聚边界定义 + 台湾（欧亚/菲律宾海板块）实例，并附 570 字思考链 |
| 多轮对话 Agent | 同 `sessionId` 反复 `sendMsg` | 追问"把上一条的板块名称单独列出来"，准确返回"欧亚板块、菲律宾海板块"；换新会话问同一句，模型明确回答无历史记录（2026-10-03 复测加了对照组） |
| 三模型切换 | `sendMsg` 的 `module` | `Qwen2.5-72B-GeoGPT` / `GeoGPT-R1-Preview` / `DeepSeekR1-GeoGPT` 全部可用，同一问题三者答案一致，耗时 7–12s |
| 文献片段检索 + 引用 | `top_k_common` | 英文检索词命中《西菲律宾盆地消亡扩张中心玄武岩》《超高精度稀有气体同位素分析…》等真实论文，带 `document_id`/`chunk_index` 可回链 |
| 自己上传文档的问答（私有知识库） | `top_k` + `sendMsg` | 账号 MyLibrary 中的 ALITA-G 论文被成功检索出表格块与正文块（`text_type` 区分 `table`/`text`）。注意该账号个人库只有这 1 篇文档、团队库为空，链路已验证但检索质量无从判断 |
| 针对本地论文/报告问答 | `sendMsg`（材料由 `--file` 本地注入） | 202 段的长文档只注入相关 2 段（177 字）即答出 127.5 ± 1.2 Ma 与 εHf(t)=+8.3；问材料里没有的作者/期刊时明确拒答；与 `--ground` 混用时能区分 `[文献N]` 与 `[本地N]` 两类来源 |
| 带思考链的可解释回答 | `sendMsg` 的 `reasoning_content` | 思考过程与正式回答分属两个字段，可只展示结论或同时展示推理 |

### 16.2 具体可以做的事

**科研向**

1. **文献调研助手**：英文关键词 → 公共库召回原文片段 → 喂给 `sendMsg` 做综述式归纳，比手动翻 PDF 快一个量级。
2. **私有资料问答**：课题组论文、报告、实验记录先转成 Markdown，用 `ask.mjs --file` 本地挑段注入即可（实测 202 段文档只喂相关 2 段，答案按 `[本地N]` 溯源、材料没有的会拒答）。要进平台 MyLibrary 只能在网页端手动上传，上传后再用 `top_k` 检索 —— 见 15.5，开发者密钥没有上传权限。
3. **批量数据抽取**：从一批论文摘要/正文里抽矿物名称、元素比值（如 Fe/Si、Mg/Si）、构造背景、年龄数据，结构化成表格。RPM 1000 的配额适合跑几千条规模的批处理。
4. **术语解释与教学**：地学概念的一句话到一段的分级解释，`reasoning_content` 可直接用作板书式的推导过程。
5. **写作辅助**：摘要润色、审稿意见回复稿、图表说明文字初稿。

**工程向**

6. **嵌进你自己的系统**：`generate` + `sendMsg` 就是一个完整的带会话记忆的后端对话服务，前端只需消费 SSE。
7. **Notebook / 脚本流水线**：配合 pandas 做"检索 → 抽取 → 落表"的文献计量分析。
8. **RAG 中间件**：只用 `top_k`/`top_k_common` 当纯向量检索层，把召回结果喂给别家模型。
9. **定时监控**：定期问一批固定问题，追踪模型回答的变化（做模型回归测试）。

### 16.3 不适合做的事

- **当通用 OpenAI 替代品**：`chat/completions` 目前服务端不可用，且模型不可指定；通用能力不如直接接 OpenAI/DeepSeek。
- **要求严格事实准确性**：实测回答中出现过"郯庐断裂带是否属于俯冲带"这类自我怀疑的推理，地学细节仍需人工核对，务必保留 `document_id` 做溯源。
- **依赖返回元数据做引用格式**：`year`/`journal`/`authors` 实测都不返回，只能拿到 `title`，生成规范引用需自己补。
- **用中文查公共库**：纯中文 0 命中；混排查询命中靠的是拉丁片段，别把它当成中文检索可用。
- **不设阈值直接采信 RAG 结果**：不相关也会返回满 `topK` 条。
- **塞超长 prompt**：18 万字级别的输入服务端不报错也不返回，会一直挂到客户端超时；单次要喂很多材料时改成分批归纳。
- **拿 `sessionId` 当可信输入**：服务端不校验 id，传错只会得到空回答，调用方自己确认 id 来自 `generate` 的返回。

---

*本文档为官方开发者文档的结构化整理版，并叠加 2026-09-29 实测校正；接口以 GeoGPT 官方最新线上版本为准。*
