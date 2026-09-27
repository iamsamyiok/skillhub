# DeepSeek-Harness 风格程序示例 — 双受众 MCP 宿主 `harness.py`

> **什么是 DeepSeek 风格的 harness**：DeepSeek 的 agent harness 以"小而硬的调度核 + 全部能力外挂"著称——主循环只负责**收消息 → 查路由 → 隔离执行 → 结构化回包**，一切业务在工具/插件里，宿主看不见任何业务词。这份示例就是该理念在本 skill 七铁律上的落地：**约 130 行的可运行 MCP 宿主，冻结后永不因加功能而修改**。
> 与 §2 honey-mcp 的差异：honey-mcp 示范"最小可运行"，harness.py 示范"生产骨架"——多了**工具状态机、重试退避、事件回放、human 渲染器注册表**四处生产件。

```
harness/
├── harness.py        # 本文件: L4 调度核(冻结)
├── contracts.py      # L1: 错误码/双通道渲染器(冻结)
├── tools/*/          # 插件: manifest.json + tool.py
└── tests/            # 契约测试
```

## harness.py 全文（约 130 行，逐段标注铁律落点）

```python
"""harness.py — DeepSeek 风格双受众 MCP 调度核
设计承诺: 本文件只认识 manifest 与 route, 不认识任何业务名词 (1.5 变化隔离)。
新增能力 = 新增 tools/<name>/, 本文件 diff 为零。"""
from __future__ import annotations
import asyncio, importlib, json, logging, random, time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from contracts import render, ToolError          # L1 契约(冻结)

LOG = logging.getLogger("harness")               # 1.6 双通道: JSON handler 见 bootstrap()

# ---------------- L1 数据契约(冻结) ----------------

@dataclass
class Manifest:                                  # 1.4 接口标准化的宿主侧锚点
    name: str; version: str
    inputSchema: dict
    use_when: str; avoid_when: str; cost_hint: str; human_summary: str
    timeout_s: float = 10.0
    max_retries: int = 0                         # >0 则宿主代为重试(仅幂等工具声明)

    @staticmethod
    def load(p: Path) -> "Manifest":
        return Manifest(**json.loads(p.read_text("utf-8")))

@dataclass
class Health:                                    # 1.7 三级降级状态机
    fail: int = 0; ok: int = 0; status: str = "normal"
    def on_ok(self): self.ok += 1; self.fail = 0
    def on_fail(self) -> str:                    # 返回迁移后的状态
        self.fail += 1
        if self.status == "normal" and self.fail >= 3:  self.status = "degraded"
        if self.status == "degraded" and self.fail >= 6: self.status = "offline"
        return self.status

@dataclass
class Slot:                                      # 一个已装载工具的全部宿主知识
    mf: Manifest
    run: Callable
    health: Health = field(default_factory=Health)
    inflight: int = 0

# ---------------- L4 调度核(冻结) ----------------

class Harness:
    def __init__(self, tools_root: Path, human_renderer: Callable[[dict], str] | None = None):
        self.tools_root = tools_root
        self.slots: dict[str, Slot] = {}
        self._events: list[dict] = []            # 1.6 事件回放缓冲(供 Agent 追查)
        self.human_renderer = human_renderer or (lambda out: out.get("human", ""))

    # -- 装载(1.7 启动容错: 单工具失败不阻断) --
    def load_all(self) -> dict[str, str]:
        report = {}
        for d in sorted(p for p in self.tools_root.iterdir() if p.is_dir()):
            try:
                mf = Manifest.load(d / "manifest.json")
                mod = importlib.import_module(f"tools.{d.name}.tool")
                slot = Slot(mf=mf, run=mod.run)
                self.slots[mf.name] = slot
                report[mf.name] = "loaded"
            except Exception as e:
                report[d.name] = f"skipped: {e}"          # 跳过而非退出
                LOG.warning("load skip %s: %s", d.name, e)
        return report

    # -- 发现(1.4 Agent 通道: list_tools 由 manifest 渲染, 宿主零业务词) --
    def describe(self) -> list[dict]:
        out = []
        for n, s in self.slots.items():
            out.append({"name": n, "description":
                        f'{s.mf.human_summary} | 适用: {s.mf.use_when} | 状态: {s.health.status}',
                        "inputSchema": s.mf.inputSchema})
        return out

    # -- 核心: 隔离执行 + 重试 + 降级 + 双通道日志 --
    async def invoke(self, name: str, req: dict) -> dict:
        s = self.slots.get(name)
        if s is None:
            return {"error": {"code": "E_NO_TOOL", "retryable": False,
                              "human": f"没有 {name} 工具",
                              "detail": f"可用: {', '.join(self.slots) or '无'}"}}
        if s.health.status == "offline":
            return {"error": {"code": "E_OFFLINE", "retryable": False,
                              "human": f"{name} 已停用",
                              "detail": "连续失败触发降级; 修复后重载宿主"}}

        tries = s.mf.max_retries + 1
        last = None
        for attempt in range(1, tries + 1):              # 1.7 宿主代重试(仅幂等工具)
            s.inflight += 1
            t0 = time.time()
            try:
                out = await asyncio.wait_for(
                    asyncio.to_thread(s.run, req, self._ctx(name)), timeout=s.mf.timeout_s)
                s.health.on_ok()
                self._emit(name, ok=True, ms=(time.time()-t0)*1000, attempt=attempt)
                return out
            except ToolError as e:                       # 业务错误: 不重试, 直接双通道回包
                s.health.on_fail()
                self._emit(name, ok=False, attempt=attempt, err=e.code)
                return e.payload()
            except Exception as e:                       # 系统错误: 按声明重试(退避)
                last = e
                s.health.on_fail()
                self._emit(name, ok=False, attempt=attempt, err=type(e).__name__)
                if attempt < tries:
                    await asyncio.sleep(min(2 ** attempt, 5) + random.random() * 0.3)
            finally:
                s.inflight -= 1
        # 走到这说明重试耗尽
        st = s.health.status
        human = f"{name} 连续 {tries} 次执行失败" + (f"(已{st})" if st != "normal" else "")
        return {"error": {"code": "E_TOOL_FAIL", "retryable": st != "offline",
                          "human": human, "detail": str(last)[:300]}}

    # -- 上下文(1.3 层级化: 插件能看到的一切由此注入, 无全局单例) --
    def _ctx(self, name: str) -> "Ctx":
        return Ctx(self, name)

    # -- 事件缓冲(1.6 可观测性: Agent 可回放近 200 条) --
    def _emit(self, name, ok, ms=None, attempt=1, err=None):
        ev = {"ts": round(time.time(), 3), "tool": name, "ok": ok,
              "ms": round(ms, 1) if ms else None, "attempt": attempt, "err": err,
              "human": (f"{name} 成功({ms:.2f}s)" if ok and ms
                        else f"{name} 第{attempt}次失败: {err}")}
        self._events.append(ev); self._events[:] = self._events[-200:]
        LOG.info(json.dumps(ev, ensure_ascii=False))

    def recent_events(self, n: int = 20) -> list[dict]:
        return self._events[-n:]


@dataclass
class Ctx:                                          # 1.3 注入式上下文: 插件的唯一世界线
    h: Harness
    name: str
    def log(self, human: str, **fields):             # 插件侧双通道日志(单源)
        LOG.info(json.dumps({"tool": self.name, "human": human, **fields},
                            ensure_ascii=False))
    def events(self, n: int = 20): return self.h.recent_events(n)

def bootstrap(level="INFO"):
    logging.basicConfig(level=level)                 # 生产: 换 JSON handler(1.6)

# ---------------- MCP stdio 装配(同样冻结, 仅做协议翻译) ----------------
async def serve_mcp(h: Harness):
    from mcp.server import Server
    from mcp.types import Tool, TextContent
    import mcp.server.stdio
    srv = Server("deepseek-style-harness")

    @srv.list_tools()
    async def _list():
        return [Tool(name=t["name"], description=t["description"],
                     inputSchema=t["inputSchema"]) for t in h.describe()]

    @srv.call_tool()
    async def _call(name, args):
        out = await h.invoke(name, args or {})
        text = h.human_renderer(out)                 # 人类通道摘要(单源渲染器)
        return [TextContent(type="text",
                            text=(text + "\n" if text else "") +
                                 json.dumps(out, ensure_ascii=False))]

    await mcp.server.stdio.stdio_server(srv)

if __name__ == "__main__":
    bootstrap()
    h = Harness(Path(__file__).parent / "tools")
    print(json.dumps(h.load_all(), ensure_ascii=False))
    asyncio.run(serve_mcp(h))
```

```python
# tools/ping/manifest.json — 声明 max_retries 仅幂等工具可用(1.2)
{"name": "ping", "version": "1.0.0",
 "inputSchema": {"type": "object", "properties": {"msg": {"type": "string"}},
                 "required": ["msg"]},
 "use_when": "验证宿主链路", "avoid_when": "业务调用", "cost_hint": "瞬时",
 "human_summary": "链路探针: 返回 msg + 服务器时间戳。", "max_retries": 2}
```

```python
# tools/ping/tool.py
from contracts import render, ToolError
def run(req: dict, ctx) -> dict:
    msg = (req.get("msg") or "").strip()
    if not msg:
        raise ToolError("E_EMPTY", human="msg 不能为空",
                        detail='示例: {"msg": "ping"}')
    import time
    return render({"msg": msg, "ts": time.time()}, f"pong({len(msg)}字符)")
```

## 这份 harness 里值得抄的四个生产件

| 件 | honey-mcp(最小版) | harness.py(本文件) | 为什么 |
|---|---|---|---|
| 健康状态机 | fail 计数→offline | `Health` 三态迁移(normal→degraded→offline)+恢复清零 | degraded 可被 Agent 感知并规避 |
| 重试策略 | 无 | manifest 声明 `max_retries`，宿主指数退避+抖动；**仅幂等工具许声明** | 重试是宿主责任，工具只管一次执行 |
| 事件缓冲 | 无 | 近 200 条结构化事件可回放(`recent_events`) | Agent 出错后可自行追查，不靠人翻日志 |
| human 渲染器 | 工具内手写 | 宿主注册 `human_renderer`，注入式替换 CLI/HTTP 不同渲染 | 渲染与数据解耦，同一数据多种人脸 |

**冻结纪律提醒**：把 `harness.py` 与 `contracts.py` 设为只读评审区。第一个为业务改 harness 的 PR，就是本 skill §0 说的"设计缺陷信号"。
