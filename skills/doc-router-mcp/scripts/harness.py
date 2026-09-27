#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""harness.py — doc-router MCP 调度核 (coding-principles v2.1 实战)
四大社区痛点的宿主级对策(本文件为冻结核, 加功能=加 tools/ 目录):
  P1 工具过载        → 语义路由: Agent 只见 1 个入口工具 `doc_q`, 宿主持有 N 个实现
  P2 输出冗长烧token → 双模输出: 默认 human 摘要(compact), meta.with_detail=true 才全量
  P3 无状态长任务    → 任务句柄: returns {task_id,status_url} 立即返回, poll 查询
  P4 描述投毒/rug-pull → manifest 锁定: 启动时固化 sha256, list_tools 时校验, 变更即拒载
"""
from __future__ import annotations
import asyncio, hashlib, importlib, json, logging, sys, time, uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LOG = logging.getLogger("doc-router")

# ---------------- L1 契约(contracts 内联于单文件, 冻结) ----------------

from contracts import render, ToolError   # L1 契约单源: 宿主与全部工具共用同一定义

# ---------------- 数据契约 ----------------

@dataclass
class Manifest:
    name: str; version: str; capabilities: list[str]
    inputSchema: dict; use_when: str; avoid_when: str
    cost_hint: str; human_summary: str
    timeout_s: float = 10.0; max_retries: int = 0; sha256: str = ""

    @staticmethod
    def load(p: Path) -> "Manifest":
        raw = json.loads(p.read_text("utf-8"))
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        return Manifest(**{**raw, "sha256": sha})

@dataclass
class Health:
    fail: int = 0; ok: int = 0; status: str = "normal"
    def on_ok(self): self.ok += 1; self.fail = 0
    def on_fail(self) -> str:
        self.fail += 1
        if self.status == "normal" and self.fail >= 3: self.status = "degraded"
        if self.status == "degraded" and self.fail >= 6: self.status = "offline"
        return self.status

@dataclass
class Task:                                    # P3: 长任务句柄
    id: str; kind: str; status: str = "running"
    result: Any = None; error: dict | None = None
    created: float = field(default_factory=time.time)

# ---------------- L4 调度核(冻结) ----------------

class Harness:
    def __init__(self, tools_root: Path):
        self.tools_root = tools_root
        self.slots: dict[str, dict] = {}       # name -> {mf, run, health, sha}
        self.by_cap: dict[str, str] = {}       # capability -> tool name (P1 路由表)
        self.tasks: dict[str, Task] = {}       # P3 任务表
        self.events: list[dict] = []           # 1.6 事件回放(≤200)

    # -- 装载(P4: manifest sha 锁定, 运行期校验) --
    def load_all(self) -> dict:
        report = {}
        for d in sorted(p for p in self.tools_root.iterdir() if p.is_dir()):
            try:
                mf = Manifest.load(d / "manifest.json")
                sha_now = mf.sha256
                mod = importlib.import_module(f"tools.{d.name}.tool")
                self.slots[mf.name] = {"mf": mf, "run": mod.run,
                                       "health": Health(), "sha": sha_now}
                for cap in mf.capabilities:
                    self.by_cap[cap] = mf.name
                report[mf.name] = "loaded"
            except Exception as e:
                report[d.name] = f"skipped: {e}"
        return report

    def _verify_integrity(self, name: str) -> dict | None:
        """P4 反 rug-pull: 工具执行前校验 manifest 是否被换过。"""
        s = self.slots.get(name)
        mf_path = self.tools_root / name / "manifest.json"
        try:
            if hashlib.sha256(mf_path.read_bytes()).hexdigest() != s["sha"]:
                LOG.error("INTEGRITY FAIL: %s manifest changed on disk", name)
                s["health"].status = "offline"
                return {"error": {"code": "E_INTEGRITY", "retryable": False,
                                  "human": f"{name} 的清单文件在运行期间被修改,已自动停用",
                                  "detail": "manifest sha256 与装载时不符(疑似 rug-pull);确认变更合法后重启宿主"}}
        except OSError as e:
            return {"error": {"code": "E_INTEGRITY_IO", "retryable": False,
                              "human": f"{name} 清单不可读", "detail": str(e)[:150]}}
        return None

    # -- P1 语义路由: Agent 只看到 route 入口 --
    async def route(self, req: dict) -> dict:
        cap = (req.get("capability") or "").strip()
        if cap not in self.by_cap:
            avail = "\n".join(f"  {k}: {self.slots[self.by_cap[k]]['mf'].use_when}"
                              for k in sorted(self.by_cap))
            return {"error": {"code": "E_NO_CAPABILITY", "retryable": False,
                              "human": f"没有能力点 '{cap}'",
                              "detail": f"可选能力点:\n{avail}\n宿主刻意只暴露一个入口工具,"
                                        f"请先按 use_when 选择 capability 再调用"}}
        name = self.by_cap[cap]
        s = self.slots[name]
        if s["health"].status == "offline":
            return {"error": {"code": "E_OFFLINE", "retryable": False,
                              "human": f"'{cap}' 所在工具 {name} 已停用",
                              "detail": "连续失败触发降级; 修复后重启宿主恢复"}}
        # P4 完整性检查(每次执行前)
        bad = self._verify_integrity(name)
        if bad:
            return bad
        # P2 双模输出: 默认 compact —— 工具返回 full 时宿主裁剪
        compact = not (req.get("meta") or {}).get("with_detail", False)
        tries = s["mf"].max_retries + 1
        last = None
        for attempt in range(1, tries + 1):
            s["inflight"] = True
            t0 = time.time()
            try:
                out = await asyncio.wait_for(asyncio.to_thread(s["run"], req, None),
                                             timeout=s["mf"].timeout_s)
                s["health"].on_ok()
                self._emit(name, True, (time.time()-t0)*1000, attempt)
                if compact and isinstance(out, dict):
                    out = {**out, "result": {k: ("…%d项省略" % len(v) if k == "rows" and
                            isinstance(v, list) and len(v) > 5 else v)
                            for k, v in out["result"].items()}}
                return out
            except ToolError as e:
                s["health"].on_fail(); self._emit(name, False, attempt=attempt, err=e.code)
                return e.payload                        # 属性非方法(1.4 契约)
            except Exception as e:
                last = e
                s["health"].on_fail(); self._emit(name, False, attempt=attempt, err=type(e).__name__)
                if attempt < tries:
                    await asyncio.sleep(min(2 ** attempt, 5))
        return {"error": {"code": "E_TOOL_FAIL", "retryable": True,
                          "human": f"{name} 重试 {tries} 次仍失败",
                          "detail": str(last)[:300]}}

    # -- P3 长任务: 立即返回句柄 --
    def spawn_task(self, kind: str, coro) -> dict:
        tid = uuid.uuid4().hex[:12]
        self.tasks[tid] = Task(id=tid, kind=kind)
        async def _run():
            t = self.tasks[tid]
            try:
                t.result = await coro; t.status = "done"
            except Exception as e:
                t.error = {"code": "E_TASK_FAIL", "human": f"任务 {kind} 失败",
                           "detail": str(e)[:200]}; t.status = "failed"
        asyncio.get_event_loop().create_task(_run())
        return {"result": {"task_id": tid, "status": "running",
                           "poll_hint": "用 capability='task.poll' 查询进度"},
                "human": f"长任务已受理(句柄 {tid}), 用 task.poll 查询"}

    def poll(self, task_id: str) -> dict:
        t = self.tasks.get(task_id)
        if not t:
            raise ToolError("E_NO_TASK", human=f"任务 {task_id} 不存在",
                            detail="task_id 由 spawn 类工具返回; 重启宿主会清空任务表")
        body = {"task_id": t.id, "kind": t.kind, "status": t.status}
        if t.status == "done": body["result"] = t.result
        if t.error: body["error"] = t.error
        return {"result": body, "human": f"任务 {t.kind} 状态: {t.status}"}

    def recent_events(self, n: int = 20) -> list[dict]:
        return self.events[-n:]

    def _emit(self, name, ok, ms=None, attempt=1, err=None):
        ev = {"ts": round(time.time(), 3), "tool": name, "ok": ok,
              "ms": round(ms, 1) if ms else None, "attempt": attempt, "err": err,
              "human": (f"{name} 成功({ms:.2f}s)" if ok and ms
                        else f"{name} 第{attempt}次失败: {err}")}
        self.events.append(ev); self.events[:] = self.events[-200:]
        LOG.info(json.dumps(ev, ensure_ascii=False))
