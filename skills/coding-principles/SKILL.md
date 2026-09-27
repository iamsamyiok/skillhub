---
name: coding-principles
version: 1.0.0
category: 工程规范
tags: [Coding Principle, 插件化, 模块化, 原子化, 层级化, 接口标准化, 变化隔离, 可观测性, 容错降级, Next.js, Python, Rust]
description: 长期迭代插件化项目的核心工程规范（七条铁律）：模块化/原子化/层级化/接口标准化/变化隔离/可观测性/容错降级。核心规则=一切新功能只能通过标准化插件接口接入，禁止修改核心主体代码（无白名单例外，仅临时一次性脚本可极简豁免）。附 DeepSeek Honey 风格插件宿主示例。适用于 Next.js / Python / Rust 三栈项目。
---

# Coding Principles — 插件化项目七条铁律

> 面向**长期迭代**的多语言插件化项目。本文件是硬约束，不是建议：任何违反下列规则的新代码，评审一律打回。

## 0. 最高原则：核心不可变，一切皆插件

**新功能只能通过标准化插件接口接入。不允许修改核心主体代码。**

- "核心主体"（kernel）只做一件事：**注册插件、调度生命周期、广播事件**。它自身冻结在 `core/` 目录，其公开 API 变更需要最高评审级别。
- 判断标准——如果你实现一个新功能时发现"必须改 core 才行"，这本身就是设计缺陷信号：**先扩展插件接口，再写插件**；接口扩展属于 core 的受控演进，属于例外流程（见 §8）。
- 不设"白名单例外机制"：不存在"特殊项目允许直改核心"的名单。唯一的豁免通道是 **§8 临时一次性脚本**，且不可转正。

## 1. 七条工程铁律

### 1.1 模块化 Modularization
- 每个插件/模块 = **独立目录 + 独立依赖声明 + 独立生命周期**。目录即边界：跨目录 import 核心内部文件视为违规。
- 模块只能依赖：核心公开 API、标准库、自己的 `deps`。**禁止插件间横向 import**——插件协作只能通过核心事件总线或显式声明的服务接口。
- 多语言同构规则：Next.js（`plugins/<name>/index.ts` 只从 `@core/api` 导入）、Python（包内相对导入仅限自身，跨插件走 `host.emit/on`）、Rust（插件 crate 不依赖其他插件 crate，只依赖 `kernel` trait crate）。

### 1.2 原子化 Atomicity
- 一个模块只做**一件事**，一件事必须做完做对（失败要么回滚要么显式降级，不留半成品状态）。
- 函数级原子：单函数不超过 80 行 / 单一职责 / 纯函数优先；副作用集中在模块顶层的 `lifecycle` 钩子里。
- 提交级原子：一次 commit/PR 只含一个插件的一个变更意图；混合"修 bug + 加功能"的 PR 打回。

### 1.3 层级化 Layering
固定五层，**只允许上层依赖下层，禁止反向与跨层**：

```
L5 应用层     (app/ 页面、CLI 入口、任务编排)
L4 编排层     (orchestrator: 插件注册、事件总线、调度)
L3 服务层     (services: 持久化、队列、外部网关——皆为可替换实现)
L2 领域层     (domain: 纯业务逻辑与类型定义，零副作用)
L1 内核层     (core: 接口契约、错误体系、生命周期协议——冻结)
```
- 插件挂在 L2/L3 之间，通过 L4 注册；L1 对所有层只读。
- 依赖注入而非全局单例：Next.js 用 context/provider 传递，Python 用构造参数，Rust 用 trait object / 泛型参数。

### 1.4 接口标准化 Standardized Interface
- 每个插件**必须**实现统一生命周期协议（声明式清单 + 四钩子）：

```jsonc
// plugin.manifest.json —— 三栈同构的插件身份证
{
  "name": "renderer-svg",          // 全局唯一，kebab-case
  "version": "1.0.0",              // semver
  "hooks": ["init", "activate", "invoke", "deactivate"],
  "provides": ["render.svg"],      // 对外暴露的能力点
  "consumes": ["bus.render"],      // 依赖的核心事件/服务
  "permissions": ["fs.read:assets"]// 最小权限声明
}
```

| 钩子 | 语义 | 约束 |
|---|---|---|
| `init(ctx)` | 读配置、校验权限 | 幂等，不得产生副作用 |
| `activate(ctx)` | 注册事件监听/路由 | 必须可重复调用后自恢复 |
| `invoke(req)` | 执行业务 | **唯一允许抛错的钩子**，错误必须是标准化错误码 |
| `deactivate()` | 释放资源 | 保证进程可干净退出/热替换 |

- 错误也走标准接口：`{ code, plugin, retryable, detail }`，禁止裸字符串异常跨边界。
- 三栈契约源：接口以 **JSON Schema / TypeScript 类型 / Rust trait** 三份保持等价，改动需三处同 PR。

### 1.5 变化隔离 Isolation of Change
- **变化频率不同的东西不许放在一起**：配置>插件>核心，稳定度递增。
- 每个插件自带 `tests/`（至少覆盖 invoke 正常路径 + 一条失败路径），核心 CI 只跑"契约测试"（对所有插件跑同一套生命周期测试），插件自身测试随插件目录走。
- 破坏性接口变更 = 插件版本主号升级 + 核心提供旧版 shim 一个大版本周期；**禁止在核心里写"为某个插件特判"的 if**——这是变化隔离的红线。

### 1.6 可观测性 Observability
- 三支柱内建，不是事后补：
  - **日志**：结构化 JSON（`ts, level, plugin, code, msg`），禁止 console.log/print! 裸输出进主干。
  - **指标**：每个插件自动获得 `invoke_count / invoke_ms / error_count` 三项基础指标（由 L4 统一采集，插件零成本）。
  - **追踪**：跨插件请求携带 `trace_id`，事件总线自动注入。
- 插件健康分：连续失败 → 自动标记 degraded 并上报（衔接 §1.7）。

### 1.7 容错降级 Graceful Degradation
- **插件崩溃不拖垮核心**：`invoke` 在隔离上下文执行（JS: try/catch + timeout；Python: 子进程/asyncio task + 超时；Rust: `catch_unwind` + 隔离任务），失败返回标准错误，宿主继续运行。
- **三级降级**：`正常 → degraded(禁用出错插件,事件广播告警) → offline(功能下线但核心可用)`。降级由失败率阈值自动触发，恢复需探活成功 N 次。
- 关键路径必须有**静态兜底**：插件不可用时，L5 必须仍能渲染/响应出"缺少该能力"的明确提示，而不是白屏或 panic。
- 启动顺序容错：任一插件 init 失败只跳过自身，不阻断其余插件与核心启动。

## 2. DeepSeek-Honey 风格插件宿主示例

> 示例语言 Python（最直观）；同构的 TS/Rust 骨架见 §3 对照表。`honey = 甜头`：插件带来能力，宿主保持干净。

```python
# core/kernel.py — L1 内核：冻结。全文件只有一个职责：管理插件生命周期 + 广播事件。
from __future__ import annotations
import importlib, json, logging, time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("kernel")

@dataclass
class PluginMeta:
    name: str
    version: str
    provides: list[str]
    consumes: list[str]
    permissions: list[str]

@dataclass
class InvokeResult:
    ok: bool
    data: Any = None
    error: dict | None = None   # {"code","plugin","retryable","detail"}

class Kernel:
    """插件宿主。核心纪律：本文件永不修改——加功能=写新插件或扩 L4。"""
    def __init__(self, plugins_dir: Path, config: dict[str, Any] | None = None):
        self.plugins_dir = plugins_dir
        self.config = config or {}
        self._registry: dict[str, Any] = {}          # name -> plugin instance
        self._metas: dict[str, PluginMeta] = {}
        self._routes: dict[str, Callable] = {}       # provides -> invoke
        self._listeners: dict[str, list[Callable]] = {}
        self._health: dict[str, dict] = {}           # name -> {fail, ok, status}
        self._trace: str = ""

    # ---------- 生命周期 ----------
    def load_all(self) -> list[str]:
        loaded, skipped = [], []
        for manifest in sorted(self.plugins_dir.glob("*/plugin.manifest.json")):
            try:
                self._load_one(manifest.parent)
                loaded.append(manifest.parent.name)
            except Exception as e:                       # 1.7 启动容错:单个失败不阻断
                log.warning("plugin init failed, skipped: %s (%s)", manifest.parent.name, e)
                skipped.append(manifest.parent.name)
        log.info("kernel load: %d loaded, %d skipped", len(loaded), len(skipped))
        return loaded

    def _load_one(self, pdir: Path) -> None:
        meta_raw = json.loads((pdir / "plugin.manifest.json").read_text("utf-8"))
        meta = PluginMeta(**{k: meta_raw[k] for k in
                             ("name", "version", "provides", "consumes", "permissions")})
        mod = importlib.import_module(f"{pdir.name}.plugin")
        inst = mod.Plugin()                              # 插件必须导出 Plugin 类
        inst.init(_Ctx(self, meta))                      # 1.4 四钩子协议
        self._registry[meta.name] = inst
        self._metas[meta.name] = meta
        self._health[meta.name] = {"fail": 0, "ok": 0, "status": "normal"}
        for cap in meta.provides:
            self._routes[cap] = meta.name

    def deactivate(self, name: str) -> None:
        inst = self._registry.pop(name, None)
        if inst:
            inst.deactivate() if hasattr(inst, "deactivate") else None
            for cap in self._metas[name].provides:
                self._routes.pop(cap, None)
            self._health[name]["status"] = "offline"

    # ---------- 事件总线 (1.1 插件协作唯一通道) ----------
    def on(self, topic: str, fn: Callable) -> None:
        self._listeners.setdefault(topic, []).append(fn)

    def emit(self, topic: str, payload: Any) -> None:
        for fn in self._listeners.get(topic, []):
            try:
                fn(payload)
            except Exception as e:
                log.error("listener error on %s: %s", topic, e)   # 观测但不传染

    # ---------- 统一调用入口 (隔离执行 + 三级降级) ----------
    def invoke(self, capability: str, req: dict) -> InvokeResult:
        name = self._routes.get(capability)
        if not name:
            return InvokeResult(False, error={"code": "E_NO_PLUGIN", "plugin": "-",
                                              "retryable": False,
                                              "detail": f"no plugin provides {capability}"})
        h = self._health[name]
        if h["status"] == "offline":
            return InvokeResult(False, error={"code": "E_OFFLINE", "plugin": name,
                                              "retryable": False,
                                              "detail": "plugin degraded to offline"})
        t0 = time.time()
        trace = self._trace = f"{name}-{int(t0*1000)}"
        try:
            data = self._registry[name].invoke(req)       # 1.7 隔离:异常只属于该插件
            h["ok"] += 1
            self.emit(f"bus.{capability}", {"trace": trace, "ok": True})
            return InvokeResult(True, data=data)
        except Exception as e:
            h["fail"] += 1
            err = {"code": "E_PLUGIN_FAIL", "plugin": name, "retryable": True,
                   "detail": str(e)[:300]}
            self.emit(f"bus.{capability}", {"trace": trace, "ok": False, "err": err})
            if h["fail"] >= 5 and h["fail"] > h["ok"]:    # 1.7 自动降级
                h["status"] = "offline"
                self.deactivate(name)
                log.error("plugin degraded to offline: %s", name)
            return InvokeResult(False, error=err)
        finally:
            log.info(json.dumps({"ts": time.time(), "level": "info", "plugin": name,
                                 "code": "invoke", "trace": trace,
                                 "ms": round((time.time()-t0)*1000, 1)}))  # 1.6 结构化日志


@dataclass
class _Ctx:
    """注入给插件的上下文——插件能看到的一切,只能来自这里(1.3 层级化)。"""
    kernel: Kernel
    meta: PluginMeta
    def config(self, key: str, default=None):   # 只读自己插件的配置段
        return self.kernel.config.get(self.meta.name, {}).get(key, default)
    def on(self, topic: str, fn: Callable): self.kernel.on(topic, fn)
    def emit(self, topic: str, payload: Any): self.kernel.emit(topic, payload)
```

```python
# plugins/echo/plugin.manifest.json
{"name": "echo", "version": "1.0.0", "provides": ["util.echo"],
 "consumes": [], "permissions": []}
```

```python
# plugins/echo/plugin.py — 一个完整插件的全部代码
class Plugin:
    def init(self, ctx):        self.ctx = ctx; ctx.on("boot", lambda p: None)
    def activate(self, ctx):    pass
    def invoke(self, req):      # 1.2 原子化:只做"回声"一件事
        text = str(req.get("text", ""))
        if not text:
            raise ValueError("text is required")     # 标准化错误:交给宿主包装
        return {"echo": text, "len": len(text)}
    def deactivate(self):       pass
```

```python
# app/main.py — L5 应用层:三行启动
from core.kernel import Kernel
from pathlib import Path
k = Kernel(Path("plugins"), config={"echo": {"upper": False}})
k.load_all()
print(k.invoke("util.echo", {"text": "hello honey"}).data)   # {'echo': 'hello honey', 'len': 11}
```

**这个示例里藏着全部七条**：kernel 100 行冻结（核心不可变）· 插件独立目录（模块化）· invoke 单一职责（原子化）· manifest 四钩子（接口标准化）· 协作只走 emit/on（变化隔离）· 结构化日志+trace+自动降级（可观测性/容错降级）。

## 3. 三栈对照速查

| 关注点 | Next.js/TS | Python | Rust |
|---|---|---|---|
| 插件形态 | `plugins/<name>/index.ts` 导出 `definePlugin()` | 包目录导出 `Plugin` 类 | 独立 crate 实现 `Plugin` trait，`libloading`/`abi_stable` 或 trait-object 静态注册 |
| 契约 | `types.ts` + zod schema | `contracts.py` + pydantic | `kernel` crate 的 trait + serde 结构 |
| 隔离执行 | try/catch + `AbortSignal.timeout` | asyncio task + `wait_for` 超时 | `tokio::spawn` + `catch_unwind` + timeout |
| 热替换 | 动态 `import()` + 路由重注册 | importlib 重载 + 重注册 | 子进程插件 + IPC（或重启式替换） |
| 结构化日志 | pino | logging + jsonFormatter | `tracing` + JSON subscriber |
| 指标埋点 | prom-client | prometheus_client | `metrics` crate |

## 4. 落地检查清单（新代码合入前逐条自问）

- [ ] 这个功能能不能是一个新插件？→ 能就必须是插件
- [ ] 我改了 `core/` 吗？→ 改了就走 §8 例外流程或重新设计接口
- [ ] 插件间有没有横向 import？→ 协作必须走事件总线
- [ ] manifest 四钩子齐了吗？错误是标准结构吗？
- [ ] 变化频繁的东西（配置/文案/阈值）有没有从代码里抽出去？
- [ ] 有没有裸 print/console.log？指标是不是宿主自动采集的？
- [ ] 把这个插件进程杀掉，核心还能启动和响应吗？（终极容错测试）
- [ ] 一次 commit 是否只做一件事？

## 8. 临时一次性脚本豁免（唯一豁免通道）

- 允许存在**极简临时脚本**：数据迁移、一次性导出、问题排查等。条件：放在 `_scratch/` 目录（不进 packages/plugins 视图）、单文件 ≤150 行、文件头注明 `# ONE-OFF 2026-09-27 <用途> <删除条件>`、**不 import 业务代码只读数据**。
- `_scratch/` 不享受 CI 豁免之外的任何便利：不允许被测试引用、不允许被生产代码 import、每周清理一次。
- **临时脚本不得演化为正式功能**——需要转正时，按第 1 节规则重写为插件，原脚本删除。这是豁免与例外的分界线。
