---
name: coding-principles
version: 2.1.0
category: 工程规范
tags: [Coding Principle, MCP, Skill, Agent友好, 人类友好, 双通道, 插件化, 模块化, 原子化, 层级化, 接口标准化, 变化隔离, 可观测性, 容错降级, Next.js, Python, Rust]
description: 生成 Agent 与人类同时好用的程序——面向 MCP/Skill 类双受众工程的核心规范（七条铁律，每条 = Agent 可执行硬规则 + 紧随的人类自然语言说明）：接口双通道输出 Schema+人类备注、日志双通道输出 JSON+纯文本摘要、扩展强制走插拔式标准接口禁改核心宿主、仅允许一次性临时 MCP 极简豁免埋点（无白名单）。适配 Next.js / Python / Rust。附 Agent Skill 典型范例与 DeepSeek-Harness 风格宿主程序示例（examples/）。
---

# Coding Principles — Agent 与人类同时好用的程序（七条铁律）

> **目标**：写出的程序，AI Agent 调起来**结构可靠可解析**，人类读起来**一眼知道在干什么**。两类读者不是二选一，而是**每一层都双份输出**。
> **硬约束等级**：`MUST` = 违反即打回；`SHOULD` = 除非有书面理由；`MAY` = 自由裁量。
> **适用**：MCP server、Agent Skill、以及一切"给 AI 用也给人类用"的服务与工具。三栈适配见 §5。

## 0. 最高原则：双受众，双通道，核心不可变

**Dual-Audience Dual-Channel + Frozen Core**

```
HARD: 每一个对外契约（接口、日志、错误、事件）必须同时输出两个通道：
      ① Agent 通道——严格可机器解析的结构化格式（Schema/JSON/类型化错误码）
      ② 人类通道——同内容的自然语言摘要/备注，紧邻结构化数据
HARD: 一切新功能只能以标准 MCP/插件接口接入；禁止修改核心宿主（host）代码。
      宿主的公开契约变更 = 新版本发布流程，不属于日常迭代。
HARD: 不设白名单例外机制。唯一豁免 = §7 一次性临时 MCP 极简豁免埋点。
```

> 🧑 **给人的一句话**：写代码时想象两个读者——一个是不睡觉的机器人（要格式严格），一个是三个月后忘了上下文的你自己（要人话说明）。每个接口、每行日志都同时伺候这两个读者；加功能永远加插件，不动发动机。

**为什么双通道不是冗余**：Agent 通道保证可靠性（schema 校验失败即失败，不猜），人类通道保证可维护性（排障时不用反序列化就知道发生了什么）。两通道由同一数据源渲染，**禁止手工写两份**——手工双份必然漂移，用"结构化数据 → 渲染函数"的单源方式产出。

## 1. 七条铁律（每条 = 硬规则 + 人话）

### 1.1 模块化 Modularization

```
MUST: MCP/Skill 的每个工具(tools/)、资源(resources/)、提示(prompts/)各自独立目录，
      目录即边界；跨目录 import 宿主内部实现视为违规。
MUST: 工具之间禁止互相调用；协作只能通过宿主事件总线或宿主路由转发。
```

> 🧑 **人话**：一个工具一个文件夹，工具之间不互相"借代码"，它们只跟宿主说话——就像公司的员工各管各的摊子，有事找老板协调，不私下串门。这样任何一个工具坏了、换了、删了，别人都不受牵连。

### 1.2 原子化 Atomicity

```
MUST: 每个工具做且只做一件事；一次调用要么完整成功，要么完整失败并返回结构化错误，
      不得留下半成品状态（写了一半的文件、改了一半的记录）。
MUST: 有副作用的工具必须声明幂等键(req.idempotency_key)或提供 dry_run 参数。
```

> 🧑 **人话**：每个工具是"一口锅端"——要么全熟要么没下锅，不能端上来半生不熟。凡是会改东西的工具，都得支持"先演练一遍"（dry_run），让人和 Agent 都敢放心调。

### 1.3 层级化 Layering

```
MUST: 五层架构，只许上层依赖下层：
      L5 入口层(stdio/HTTP 入口, CLI) → L4 宿主层(注册/路由/事件) →
      L3 服务层(存储/网络/外部API) → L2 领域层(纯逻辑+类型, 零IO) → L1 契约层(schema/错误码, 冻结)
MUST: L1 对所有层只读；L2 不得 import 任何带 IO 的模块；依赖注入，禁全局单例。
```

> 🧑 **人话**：代码分五层楼，楼上的可以叫楼下的干活，楼下不能指挥楼上，更不能跨三层喊话。最底层是"宪法"（数据长什么样、错误怎么算），所有人遵守但没人能改。依赖都是"点名传递"的，不搞谁都能改的全局变量。

### 1.4 接口标准化 Standardized Interface（双通道核心）

```
MUST: 每个工具的 inputSchema 必须是合法 JSON Schema（Agent 通道），且同一工具必须
      导出人类可读的 use_when/avoid_when/cost_hint 三个备注字段（人类通道）。
MUST: 响应体 = { result: <schema-valid data>, human: "<=3句自然语言摘要" }；
      错误体 = { code, retryable, human, detail }；human 字段与 detail 同源渲染。
MUST: 新增/修改工具必须同步更新宿主自动生成的 tools 清单（Agent 发现机制），
      人类侧同步更新 README 工具表——两者由同一脚本从 manifest 生成，禁止手写两份。
```

> 🧑 **人话**：每个工具出门自带两份说明书——给机器的是严格的参数表格（它照表格传参，错一个字段就报错），给人的是三句话"什么时候用我、什么时候别用、用我大概多贵"。返回结果也一样：机器读结构化数据，人读末尾那几行摘要。这两份说明从一个源头自动生成，绝不手工维护两份（会打架）。

### 1.5 变化隔离 Isolation of Change

```
MUST: 按变化频率分层存放——高频变(提示词/阈值/文案)进配置，中频变(工具逻辑)进插件，
      低频变(协议/schema)进 L1 并走版本发布。
MUST: 破坏性 schema 变更 = 工具版本主号 +1，宿主保留旧版 shim 一个大版本周期；
      禁止在宿主里写"为某个工具特判"的分支。
MUST: 每个工具自带 tests/（invoke 正常路径 + 一条失败路径 + schema 校验测试）；
      宿主 CI 对全部工具跑统一契约测试。
```

> 🧑 **人话**：爱变的东西和怕变的东西分开放。改提示词不动代码，改工具不碰协议；真要改协议就发新版本、老版本留一阵子让大家迁移，绝不为了迁就某一个工具在宿主里开小灶。每个工具自带自己的体检报告（测试），宿主只查大家共通的那几项。

### 1.6 可观测性 Observability（双通道核心）

```
MUST: 日志双通道——单条日志同时含 JSON 结构化字段(ts,level,tool,trace_id,code,msg,detail)
      与 human 摘要字段；输出方式：结构化进文件/流(human 字段为其中一列)，
      CLI 场景额外渲染纯文本行 [HH:MM:SS][tool] 人话摘要。
MUST: 宿主为每个工具自动采集 invoke_count / error_count / p95_ms，工具零成本获得指标。
MUST: 错误信息对 Agent 可行动：human 说"发生了什么"，detail 说"Agent 下一步该试什么"。
```

> 🧑 **人话**：日志写两套？不，写一套但长两张脸——机器读 JSON 排查链路，人打开文件直接看中文摘要行。每个工具的调用次数、耗时、出错率宿主自动记账，工具作者一行埋点代码都不用写。报错必须告诉 Agent"下一步该干嘛"，而不是只甩一句"失败了"。

### 1.7 容错降级 Graceful Degradation

```
MUST: 单个工具崩溃不得影响宿主与其他工具：宿主以隔离上下文执行 invoke
      (JS: try/catch+timeout | Python: asyncio.wait_for | Rust: catch_unwind+tokio timeout)，
      失败返回结构化错误后继续服务。
MUST: 三级降级 normal → degraded(连续失败N次自动禁用+广播告警) → offline；
      恢复需探活连续成功 M 次。宿主列出租户可用的工具子集时必须标记各工具当前状态。
MUST: 关键路径提供静态兜底：某工具 offline 时，Agent 收到的错误必须含替代建议
      (human: "X 工具不可用,可改用 Y 或稍后重试")。
```

> 🧑 **人话**：一个员工晕倒，公司照常营业。坏工具会被自动"停职"（degraded），反复出错就"离职"（offline），但宿主活得好好的一切照旧——而且会明明白白告诉你"这个工具坏了，你可以先用那个替代"。停职的员工连续体检合格还能复职。

## 2. MCP 插件最小示例（Agent 生成，人类 3 分钟看懂）

> **配套范例库 `examples/`**（同样遵循本 skill，可直接抄骨架）：
> ① [`examples/agent-skill-md-catalog.md`](examples/agent-skill-md-catalog.md) — **Agent Skill 典型范例**：SKILL.md+manifest+实现+测试 四件套，示范"Skill 形态"的双通道写法（frontmatter=Agent 契约，正文=人类说明），含幂等与失败路径测试。
> ② [`examples/deepseek-harness-example.md`](examples/deepseek-harness-example.md) — **DeepSeek-Harness 风格程序示例**：约 130 行生产级调度核（健康状态机/声明式重试/事件回放/human 渲染器注入），示范"宿主冻结、能力外挂"的完整形态。

> 完整可运行。Python 官方 MCP SDK；每个文件都体现"双通道"。`Honey` 命名致意 DeepSeek-Honey 风格——插件是甜头，宿主保持干净。

```
honey-mcp/
├── host.py                  # L4 宿主(冻结): 注册/路由/双通道日志/降级
├── contracts.py             # L1 契约(冻结): 错误码 + 输出渲染器(单源双通道)
├── tools/
│   ├── echo/
│   │   ├── tool.py          # 工具实现
│   │   └── manifest.json    # 双通道身份证(schema + 人话)
│   └── now/
│       ├── tool.py
│       └── manifest.json
└── tests/test_contract.py   # 契约测试(对所有工具统一跑)
```

```python
# contracts.py — L1: 错误码与"单源双通道"渲染器
from dataclasses import dataclass, asdict

@dataclass
class ToolError(Exception):
    code: str; human: str; detail: str = ""; retryable: bool = False
    def payload(self):                       # 一次构造,两通道输出(1.4)
        return {"error": {"code": self.code, "retryable": self.retryable,
                          "human": self.human, "detail": self.detail}}

def render(result: dict, human: str) -> dict:
    """所有工具返回值走这里——result 给 Agent, human 给人, 单源不漂移。"""
    return {"result": result, "human": human}
```

```json
// tools/echo/manifest.json — 双通道身份证: inputSchema 给 Agent, use_when 等给人
{
  "name": "echo",
  "version": "1.0.0",
  "inputSchema": {
    "type": "object",
    "properties": { "text": { "type": "string", "minLength": 1 } },
    "required": ["text"]
  },
  "use_when": "需要原样回显一段文本做链路验证时",
  "avoid_when": "需要变换或计算文本时",
  "cost_hint": "瞬时,无副作用",
  "human_summary": "回声工具:你说什么,它返回什么,附带字符数。"
}
```

```python
# tools/echo/tool.py — 工具实现(原子化: 只做回声; 副作用: 无)
from contracts import render, ToolError

def run(req: dict, ctx) -> dict:
    text = (req.get("text") or "").strip()
    if not text:
        # 双通道错误: human 说人话, detail 给 Agent 下一步建议
        raise ToolError("E_EMPTY_TEXT", human="text 不能为空",
                        detail="请传 {text: <非空字符串>}; 可先调用 echo 传 'ping' 验证链路")
    return render({"echo": text, "len": len(text)},
                  f"已回显 {len(text)} 个字符")          # human 摘要与数据同源
```

```python
# host.py — L4 宿主(冻结): 一切新能力=加 tools/ 目录, 本文件不改
import asyncio, importlib, json, logging, time
from pathlib import Path
from mcp.server import Server
from mcp.types import Tool, TextContent
from contracts import ToolError

log = logging.getLogger("honey.host")          # 1.6 双通道日志由 handler 落盘
H = {}                                          # name -> {run, manifest, health}

def load_tools(root="tools"):                   # 1.7 启动容错: 单个失败跳过
    for d in sorted(Path(root).iterdir()):
        mf = d / "manifest.json"
        if not mf.exists(): continue
        try:
            m = json.loads(mf.read_text("utf-8"))
            mod = importlib.import_module(f"tools.{d.name}.tool")
            H[m["name"]] = {"run": mod.run, "mf": m,
                            "health": {"fail": 0, "status": "normal"}}
        except Exception as e:
            log.warning("tool load skipped: %s (%s)", d.name, e)

async def safe_invoke(name, req):               # 1.7 隔离 + 超时 + 降级
    h = H.get(name)
    if not h:
        return {"error": {"code": "E_NO_TOOL", "retryable": False,
                          "human": f"没有 {name} 这个工具",
                          "detail": f"可用工具: {', '.join(H) or '无'}"}}
    if h["health"]["status"] != "normal":
        return {"error": {"code": "E_OFFLINE", "retryable": False,
                          "human": f"{name} 已被自动停用",
                          "detail": "连续失败触发降级; 修复后重启宿主恢复"}}
    t0 = time.time()
    try:
        out = await asyncio.wait_for(asyncio.to_thread(h["run"], req, None), timeout=10)
        h["health"]["fail"] = 0
        return out
    except ToolError as e:
        h["health"]["fail"] += 1
        return e.payload()
    except Exception as e:
        h["health"]["fail"] += 1
        if h["health"]["fail"] >= 5:            # 1.7 自动降级
            h["health"]["status"] = "offline"
            log.error("tool degraded to offline: %s", name)
        return {"error": {"code": "E_TOOL_FAIL", "retryable": True,
                          "human": f"{name} 执行出错",
                          "detail": str(e)[:300]}}
    finally:
        log.info(json.dumps({"ts": time.time(), "tool": name, "tool_trace": name,
                             "ms": round((time.time()-t0)*1000, 1),
                             "human": f"调用 {name} 用时 {time.time()-t0:.2f}s"}))

srv = Server("honey-mcp")

@srv.list_tools()
async def list_tools():                          # 1.4 Agent 发现机制: 从 manifest 生成
    return [Tool(name=n, description=f'{m["mf"]["human_summary"]} | 适用: {m["mf"]["use_when"]}',
                 inputSchema=m["mf"]["inputSchema"]) for n, m in H.items()]

@srv.call_tool()
async def call_tool(name, args):
    out = await safe_invoke(name, args or {})
    text = json.dumps(out, ensure_ascii=False)          # Agent 通道: 完整 JSON
    if "human" in out:                                   # 人类通道: 摘要置顶
        text = f"{out['human']}\n" + text
    return [TextContent(type="text", text=text)]

if __name__ == "__main__":
    load_tools()
    import mcp.server.stdio
    asyncio.run(mcp.server.stdio.stdio_server(srv))      # 一次性豁免埋点见 §7
```

```python
# tests/test_contract.py — 宿主 CI 对所有工具统一跑(1.5 变化隔离)
import json, pathlib, importlib
def test_every_tool_has_valid_manifest_and_schema():
    for mf in pathlib.Path("tools").glob("*/manifest.json"):
        m = json.loads(mf.read_text("utf-8"))
        assert {"name","version","inputSchema","use_when","avoid_when","cost_hint"} <= set(m)
        assert m["inputSchema"]["type"] == "object"
        importlib.import_module(f"tools.{mf.parent.name}.tool")   # 可导入
def test_echo_ok_and_fail():
    from tools.echo.tool import run
    assert run({"text": "ping"}, None)["result"]["echo"] == "ping"
    import pytest
    with pytest.raises(Exception): run({"text": ""}, None)      # 失败路径也要测
```

**双通道贯穿检查**：manifest（schema+use_when）· 响应（result+human）· 错误（code/human/detail）· 日志（JSON 字段+human 摘要）——四处全部单源渲染，Agent 与人类各取所需，永不漂移。

## 3. 三栈适配速查（MCP/Skill 场景）

| 关注点 | Python(官方 SDK) | Next.js/TS(@modelcontextprotocol/sdk) | Rust(rmcp/官方 rust-sdk) |
|---|---|---|---|
| 工具注册 | 装饰器 `@srv.call_tool()` + manifest 加载 | `server.setRequestHandler(ListToolsRequestSchema…)` | `rmcp` Server trait `list_tools/call_tool` |
| schema 校验 | pydantic ↔ JSON Schema | zod ↔ JSON Schema | serde + `jsonschema` crate |
| 隔离执行 | `asyncio.wait_for(to_thread)` | `AbortSignal.timeout` + try/catch | `tokio::time::timeout` + `catch_unwind` |
| 双通道日志 | logging + JSONFormatter + human 字段 | pino + human 字段 | `tracing` + JSON layer + human 字段 |
| 结构化输出 | dataclass/asdict 单源渲染 | zod.infer 类型 + render 函数 | serde Serialize + render 函数 |
| Skill 形态 | SKILL.md(给人) + scripts/(给 Agent)，SKILL.md 内含机器可解析 frontmatter | 同左 | 同左 |

## 4. 落地检查清单（合入前逐条自问）

- [ ] 新功能是新的 tools/ 目录吗？我改 host.py 了吗？（改了 = 重新设计接口）
- [ ] 工具间有没有互相 import？（协作必须走宿主路由/事件）
- [ ] inputSchema 能被 JSON Schema 校验器通过吗？use_when/avoid_when/cost_hint 写了吗？
- [ ] 响应/错误/日志三处，human 与结构化字段是同一数据源渲染的吗？
- [ ] 副作用工具支持 dry_run 或幂等键吗？
- [ ] 把这个工具的 run 函数改成必抛异常，宿主还活着吗？错误里给 Agent 替代建议了吗？
- [ ] schema 变更是不是版本 +1 且旧 shim 还在？宿主里有没有为单个工具写的特判？
- [ ] 契约测试跑过全部工具的正常+失败路径吗？

## 7. 一次性临时 MCP 极简豁免埋点（唯一豁免，无白名单）

- **定义**：排查线上问题时，临时加在宿主/工具里的**极简观测埋点**（一条 print/log），不属于功能。
- **条件（全部满足才可）**：① 放 `_scratch/` 或行内标注 `# ONE-OFF <日期> <问题> <删除条件>`；② ≤20 行；③ 只读不写（不改状态、不落库）；④ 单文件单埋点，不串成功能；⑤ **48 小时内或问题关闭后立即删除**。
- **红线**：豁免埋点**不得**演化为正式日志/功能——要转正就按 §1.6 双通道标准重写；不得出现在任何 release 分支的合并里。无任何白名单、无任何人物豁免。
