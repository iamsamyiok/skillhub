#!/usr/bin/env python3
"""skill_updater: 基于 AutoSkill/SkillEvo (vendored) 的本地 skill 自进化更新器.

编排流程对齐 SkillEvo runner 原版算法:
  1. SQLite 反馈库装载 replay 样本 (不足则 incubating), 按 dev_split_ratio 双折分割
     (mutate_dev 指导变异 / promotion_test 独立验收, 避免过拟合)
  2. EvalCompiler 从 description+正文+迭代备注启发式编译 <=6 条二元规则
     (programmatic 确定性校验 + llm_binary 严格判定), 外加一条 description 符合性硬规则
  3. VariantGenerator 混合变异 (启发式约束追加 + LLM 改写, instructions-only)
  4. mutate_dev 上评估选最优, promotion_test 上重复评估 (promotion_repeats)
  5. _should_promote: 分数超过 champion + min_score_delta 且 hard_failures 不升才晋升
     (归档旧版 -> 写回 -> 版本 bump -> champion 注册 -> 关键词索引增量更新)
熔断: 连续 N 轮 (默认 2) 未晋升则终止. YAML 元数据冻结 (仅 version 允许 bump).

核心算法来源: ECNU-ICALK/AutoSkill (MIT), 见 skillevo/NOTICE.md.

用法:
  python3 evolve.py <skill_id> [--note "迭代备注"] [--root SKILLS_DIR]
                    [--config config.yaml] [--dry-run]
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import random
import sqlite3
import sys
import time
from pathlib import Path

import httpx
import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from skillevo.config import SkillEvoConfig  # noqa: E402
from skillevo.evals import EvalCompiler, RuleEngine  # noqa: E402
from skillevo.io_utils import read_json, write_json  # noqa: E402
from skillevo.models import (  # noqa: E402
    LineageRecord,
    ReplaySample,
    SkillSnapshot,
    SkillVariant,
    VariantSummary,
)
from skillevo.mutators import VariantGenerator  # noqa: E402
from skillevo.registry import get_champion, set_champion  # noqa: E402


def log(msg: str) -> None:
    print(f"[skill_updater] {msg}", flush=True)


def now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- SKILL.md IO

def parse_skill_md(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    import re

    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, re.S)
    if not m:
        raise SystemExit(f"{path}: 未找到 YAML frontmatter (--- ... ---)")
    meta = yaml.safe_load(m.group(1))
    if not isinstance(meta, dict):
        raise SystemExit(f"{path}: frontmatter 不是有效映射")
    if not str(meta.get("description") or "").strip():
        raise SystemExit(f"{path}: 缺少 description, 无法编译判定规则")
    return meta, m.group(2)


def dump_skill_md(meta: dict, body: str) -> str:
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=100)
    return f"---\n{fm}---\n{body.strip()}\n"


def bump_version(version: str) -> str:
    import re

    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", str(version or "").strip())
    if not m:
        return "v0.1.0"
    return f"v{m.group(1)}.{m.group(2)}.{int(m.group(3)) + 1}"


# ---------------------------------------------------------------- LLM (OpenAI 兼容)

class LLM:
    def __init__(self, cfg: dict):
        key = os.environ.get(str(cfg.get("api_key_env") or "").strip(), "") or "sk-noauth"
        self.base = str(cfg.get("base_url") or "").rstrip("/")
        self.model = str(cfg.get("model") or "default")
        self.temperature = float(cfg.get("temperature", 0.3))
        self.timeout = float(cfg.get("timeout", 180))
        self.max_tokens = int(cfg.get("max_tokens", 4096))
        self.client = httpx.Client(
            base_url=self.base,
            headers={"Authorization": f"Bearer {key}"},
            timeout=self.timeout,
        )

    def complete(self, *, system: str, user: str, temperature: float | None = None,
                 retries: int = 2) -> str:
        """SkillEvo LLM 接口约定: complete(system=, user=, temperature=)."""
        payload = {
            "model": self.model,
            "temperature": self.temperature if temperature is None else temperature,
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        last = None
        for i in range(retries + 1):
            try:
                r = self.client.post("/chat/completions", json=payload)
                r.raise_for_status()
                return str(r.json()["choices"][0]["message"]["content"])
            except Exception as e:  # noqa: BLE001
                last = e
                log(f"LLM 调用失败 (第 {i + 1} 次): {e}")
                # 429 限流: 等过 RPM 窗口再试 (免费档常见 60s 窗口)
                wait = 70 if "429" in str(e) else 2 * (i + 1)
                time.sleep(wait)
        raise SystemExit(f"LLM 不可用: {last}")


# ---------------------------------------------------------------- SQLite 反馈库

class FeedbackDB:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS samples (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              skill_id TEXT NOT NULL,
              input_text TEXT NOT NULL,
              note TEXT DEFAULT '',
              source TEXT DEFAULT 'manual',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evolutions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              skill_id TEXT NOT NULL,
              from_version TEXT, to_version TEXT,
              result TEXT NOT NULL,
              detail TEXT DEFAULT '',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS breaker_state (
              skill_id TEXT PRIMARY KEY,
              consecutive_failures INTEGER DEFAULT 0,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS keywords (
              skill_id TEXT NOT NULL, term TEXT NOT NULL, tf INTEGER NOT NULL,
              PRIMARY KEY (skill_id, term)
            );
            """
        )
        self.conn.commit()

    def samples(self, skill_id: str, limit: int) -> list[tuple[str, str]]:
        rows = self.conn.execute(
            "SELECT input_text, note FROM samples WHERE skill_id=? ORDER BY id DESC LIMIT ?",
            (skill_id, limit),
        ).fetchall()
        return [(r[0], r[1] or "") for r in rows]

    def add_sample(self, skill_id: str, text: str, note: str = "", source: str = "manual") -> None:
        self.conn.execute(
            "INSERT INTO samples(skill_id,input_text,note,source,created_at) VALUES(?,?,?,?,?)",
            (skill_id, text, note, source, now_iso()),
        )
        self.conn.commit()

    def record(self, skill_id: str, frm: str, to: str, result: str, detail: str = "") -> None:
        self.conn.execute(
            "INSERT INTO evolutions(skill_id,from_version,to_version,result,detail,created_at)"
            " VALUES(?,?,?,?,?,?)",
            (skill_id, frm, to, result, detail[:2000], now_iso()),
        )
        self.conn.commit()

    def breaker_fail(self, skill_id: str) -> int:
        self.conn.execute(
            "INSERT INTO breaker_state(skill_id,consecutive_failures,updated_at) VALUES(?,1,?)"
            " ON CONFLICT(skill_id) DO UPDATE SET consecutive_failures=consecutive_failures+1,"
            " updated_at=excluded.updated_at",
            (skill_id, now_iso()),
        )
        self.conn.commit()
        return self.breaker_count(skill_id)

    def breaker_reset(self, skill_id: str) -> None:
        self.conn.execute(
            "INSERT INTO breaker_state(skill_id,consecutive_failures,updated_at) VALUES(?,0,?)"
            " ON CONFLICT(skill_id) DO UPDATE SET consecutive_failures=0, updated_at=excluded.updated_at",
            (skill_id, now_iso()),
        )
        self.conn.commit()

    def breaker_count(self, skill_id: str) -> int:
        row = self.conn.execute(
            "SELECT consecutive_failures FROM breaker_state WHERE skill_id=?", (skill_id,)
        ).fetchone()
        return int(row[0]) if row else 0

    def rebuild_keyword_index(self, skill_id: str, text: str) -> int:
        import re

        self.conn.execute("DELETE FROM keywords WHERE skill_id=?", (skill_id,))
        terms: dict[str, int] = {}
        for tok in re.findall(r"[\w\u4e00-\u9fff]+", text.lower()):
            if len(tok) < 2:
                continue
            terms[tok] = terms.get(tok, 0) + 1
        self.conn.executemany(
            "INSERT OR REPLACE INTO keywords(skill_id,term,tf) VALUES(?,?,?)",
            [(skill_id, t, n) for t, n in terms.items()],
        )
        self.conn.commit()
        return len(terms)


# ---------------------------------------------------------------- 编排 (对齐 SkillEvo runner)

def to_replay_samples(skill_id: str, rows: list[tuple[str, str]]) -> list[ReplaySample]:
    out = []
    for i, (text, _note) in enumerate(rows):
        out.append(
            ReplaySample(
                sample_id=f"{skill_id}:s{i}",
                lineage_id=skill_id,
                user_id="local",
                skill_id=skill_id,
                source_type="offline",
                split="",  # split 在分割步骤赋值
                messages=[{"role": "user", "content": text}],
            )
        )
    return out


def split_dev_promotion(samples: list[ReplaySample], ratio: float, seed: int = 7) -> tuple[list, list]:
    """双折分割: mutate_dev 指导变异 / promotion_test 独立验收 (原版 dev_split_ratio)."""
    shuffled = list(samples)
    random.Random(seed).shuffle(shuffled)
    n_dev = max(1, int(len(shuffled) * ratio))
    if n_dev >= len(shuffled):
        n_dev = len(shuffled) - 1  # 保证 promotion 至少 1 条
    dev, promo = shuffled[:n_dev], shuffled[n_dev:]
    for s in dev:
        s.split = "mutate_dev"
    for s in promo:
        s.split = "promotion_test"
    return dev, promo


def evaluate_variant(engine: RuleEngine, config: SkillEvoConfig, llm: LLM,
                     variant: SkillVariant, samples: list[ReplaySample],
                     rules: list, split: str, repeats: int) -> VariantSummary:
    """照搬 runner._evaluate_variant: responder 生成输出 -> 逐规则评估 -> 汇总."""
    outputs_total = 0.0
    rules_total = passed = hard_fail = 0
    n_evals = 0
    for repeat_idx in range(max(1, repeats)):
        for sample in samples:
            history = "\n\n".join(f"[{m.get('role','user')}] {m.get('content','')}"
                                  for m in sample.messages)
            user = ("Replay the following conversation with the skill instructions already"
                    f" injected.\n\nConversation:\n{history}\n\nRespond to the latest user message.")
            response = llm.complete(system=variant.snapshot.instructions, user=user,
                                    temperature=0.0)[: config.response_max_chars]
            outcomes = [engine.evaluate(rule=rule, response_text=response, sample=sample,
                                        variant=variant.snapshot) for rule in rules]
            outputs_total += sum(o.score for o in outcomes)
            rules_total += len(outcomes)
            passed += sum(1 for o in outcomes if o.passed)
            hard_fail += sum(1 for o in outcomes if o.hard and not o.passed)
            n_evals += 1
    return VariantSummary(
        variant_id=variant.variant_id, label=variant.label, split=split,
        sample_count=n_evals, total_score=outputs_total,
        average_score=outputs_total / max(1, n_evals),
        hard_failures=hard_fail, passed_rules=passed, total_rules=rules_total,
    )


def pick_best_variant(baseline: SkillVariant, baseline_sum: VariantSummary,
                      scored: list[tuple[SkillVariant, VariantSummary]]):
    """照搬 runner._pick_best_variant: 均分高者优先, 平分时 hard 失败少者优先."""
    best_v, best_s = baseline, baseline_sum
    for v, s in scored:
        if s.average_score > best_s.average_score + 1e-9:
            best_v, best_s = v, s
        elif abs(s.average_score - best_s.average_score) <= 1e-9 and s.hard_failures < best_s.hard_failures:
            best_v, best_s = v, s
    return best_v, best_s


def should_promote(config: SkillEvoConfig, champion: VariantSummary,
                   candidate: VariantSummary) -> bool:
    """照搬 runner._should_promote."""
    if candidate.sample_count <= 0:
        return False
    if candidate.average_score < champion.average_score + float(config.min_score_delta):
        return False
    if candidate.hard_failures > champion.hard_failures:
        return False
    return True


def summary_brief(s: VariantSummary) -> str:
    return (f"avg={s.average_score:.2f} hard_fail={s.hard_failures} "
            f"passed={s.passed_rules}/{s.total_rules}")


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser(description="AutoSkill/SkillEvo 风格 skill 自进化更新器")
    ap.add_argument("skill_id")
    ap.add_argument("--note", default="", help="迭代备注 (编译为需求规则)")
    ap.add_argument("--root", default=str(SCRIPT_DIR.parent / "skills"),
                    help="skills 根目录 (其下为 <skill_id>/SKILL.md)")
    ap.add_argument("--config", default=str(SCRIPT_DIR / "config.yaml"))
    ap.add_argument("--add-sample", default=None, help="向反馈库追加回放样本后退出")
    ap.add_argument("--add-note", default=None, help="向反馈库追加一条持久需求备注后退出")
    ap.add_argument("--dry-run", action="store_true", help="测试通过也不写盘")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    root = Path(args.root).resolve()
    skill_md = root / args.skill_id / "SKILL.md"
    if not skill_md.exists():
        log(f"错误: 未找到 {skill_md}")
        return 2

    db = FeedbackDB(root / cfg["paths"]["feedback_db"])
    if args.add_sample:
        db.add_sample(args.skill_id, args.add_sample, note=args.note)
        log(f"样本已入反馈库: {args.skill_id}")
        return 0
    if args.add_note:
        db.add_sample(args.skill_id, f"[需求] {args.add_note}", note=args.add_note,
                      source="requirement")
        log(f"需求备注已入库: {args.skill_id}")
        return 0

    # ---- SkillEvo 组件装配 ----
    bcfg = cfg.get("breaker", {})
    rcfg = cfg.get("replay", {})
    seed = int(rcfg.get("split_seed", 7))
    config = SkillEvoConfig(
        evo_root=root / ".skillevo",
        store_path=root,
        mutation_mode=str(rcfg.get("mutation_mode", "hybrid")),
        mutation_budget=max(4, int(rcfg.get("mutation_budget", 6))),
        min_replay_samples=max(2, int(rcfg.get("min_samples", 2))),
        dev_split_ratio=float(rcfg.get("dev_split_ratio", 0.7)),
        promotion_repeats=max(1, int(rcfg.get("promotion_repeats", 3))),
        min_score_delta=float(rcfg.get("min_score_delta", 0.05)),
        max_eval_rules=int(rcfg.get("max_eval_rules", 6)),
    )
    llm = LLM(cfg.get("llm", {}))

    # [1] 解析当前 skill
    meta, body = parse_skill_md(skill_md)
    old_ver = str(meta.get("version") or "")
    desc = str(meta["description"])
    snapshot = SkillSnapshot(
        skill_id=args.skill_id, user_id="local", name=str(meta.get("name") or args.skill_id),
        description=desc, instructions=body, version=old_ver,
        tags=[str(t) for t in (meta.get("tags") or [])],
        triggers=[str(t) for t in (meta.get("triggers") or [])], metadata={},
    )
    lineage = LineageRecord(
        lineage_id=args.skill_id, user_id="local", skill_id=args.skill_id,
        skill_name=snapshot.name, current_version=old_ver,
    )
    log(f"目标: {args.skill_id} @ {old_ver or '无版本'}")

    # [2] replay 样本 + 双折分割
    rows = db.samples(args.skill_id, int(rcfg.get("max_samples", 12)))
    if len(rows) < config.min_replay_samples:
        db.record(args.skill_id, old_ver, old_ver, "incubating",
                  f"样本 {len(rows)}/{config.min_replay_samples} 不足")
        log(f"incubating: replay 样本 {len(rows)} < {config.min_replay_samples}, 不执行更新")
        return 0
    dev_samples, promo_samples = split_dev_promotion(
        to_replay_samples(args.skill_id, rows), config.dev_split_ratio, seed)
    log(f"replay 池: dev={len(dev_samples)} promotion={len(promo_samples)}")

    # [3] 编译判定规则 (原版 EvalCompiler + description 符合性硬规则 + 迭代备注需求)
    requirement_texts = ([f"本轮迭代要求: {args.note}"] if args.note else [])
    rules = EvalCompiler(config=config, requirement_texts=requirement_texts).compile(
        skill=snapshot, lineage=lineage)
    rules.append(type(rules[0])(
        rule_id="matches_description", label="Output matches skill description",
        kind="llm_binary", scope="response", hard=True,
        description="Response must behave consistently with the skill description.",
        params={"mode": "requirement",
                "requirement_text": f"输出行为必须严格符合该 skill 的描述与用途: {desc}"},
        provenance={"source": "description"},
    ))
    prog = sum(1 for r in rules if r.kind == "programmatic")
    log(f"判定规则: {len(rules)} 条 (programmatic={prog}, llm_binary={len(rules) - prog})")

    engine = RuleEngine(judge_llm=llm)
    baseline = SkillVariant(variant_id="baseline", parent_variant_id="-",
                            lineage_id=args.skill_id, label="baseline",
                            mutation_type="none", notes="", snapshot=snapshot)

    # [4] baseline 基准 (mutate_dev)
    baseline_dev = evaluate_variant(engine, config, llm, baseline, dev_samples, rules,
                                    "mutate_dev", config.mutate_repeats)
    log(f"baseline dev: {summary_brief(baseline_dev)}")

    # [5] 混合变异 -> dev 上评估 -> 选最优
    # budget=规则数+1: 保证 heuristic 占满后 LLM 变异仍能进入候选 (否则 LLM 分支被跳过)
    import dataclasses

    gen_cfg = dataclasses.replace(config, mutation_budget=len(rules) + 1)
    gen = VariantGenerator(config=gen_cfg, mutator_llm=llm)
    candidates = gen.generate(lineage_id=args.skill_id, base=snapshot, eval_rules=rules,
                              failing_samples=dev_samples)
    log(f"候选变异: {len(candidates)} 个")
    scored = []
    for v in candidates:
        s = evaluate_variant(engine, config, llm, v, dev_samples, rules,
                             "mutate_dev", config.mutate_repeats)
        log(f"  [{v.label}] dev: {summary_brief(s)}")
        scored.append((v, s))
    best_v, best_dev = pick_best_variant(baseline, baseline_dev, scored)
    if best_v.variant_id == "baseline":
        if args.dry_run:
            log("[dry-run] 无晋升候选; 跳过熔断计数")
            return 1
        n = db.breaker_fail(args.skill_id)
        trip = int(bcfg.get("max_consecutive_failures", 2))
        detail = "候选在 mutate_dev 上均未超过 baseline"
        if n >= trip:
            db.record(args.skill_id, old_ver, old_ver, "breaker_trip", detail)
            log(f"熔断: 连续 {n} 轮无晋升, 终止 (保留 {old_ver})")
            return 4
        db.record(args.skill_id, old_ver, old_ver, "no_improvement", detail)
        log(f"无晋升候选 ({n}/{trip}); 保留 {old_ver}")
        return 1

    # [6] promotion_test 独立验收 (双折, repeats)
    base_promo = evaluate_variant(engine, config, llm, baseline, promo_samples, rules,
                                  "promotion_test", config.promotion_repeats)
    cand_promo = evaluate_variant(engine, config, llm, best_v, promo_samples, rules,
                                  "promotion_test", config.promotion_repeats)
    log(f"promotion: baseline {summary_brief(base_promo)} | candidate {summary_brief(cand_promo)}")

    # champion 语义: 优先持久 champion, 首跑用当轮 baseline
    champ = get_champion(config, args.skill_id)
    champ_summary = None
    if champ and isinstance(champ.get("summary"), dict) and champ["summary"].get("sample_count"):
        cs = champ["summary"]
        champ_summary = VariantSummary(
            variant_id="champion", label="champion", split="promotion_test",
            sample_count=int(cs.get("sample_count", 0)), total_score=float(cs.get("total_score", 0)),
            average_score=float(cs.get("average_score", 0)), hard_failures=int(cs.get("hard_failures", 0)),
            passed_rules=int(cs.get("passed_rules", 0)), total_rules=int(cs.get("total_rules", 0)))
    judge_base = champ_summary or base_promo
    if not should_promote(config, judge_base, cand_promo):
        if args.dry_run:
            log("[dry-run] 候选未达晋升阈值; 跳过熔断计数")
            return 1
        n = db.breaker_fail(args.skill_id)
        trip = int(bcfg.get("max_consecutive_failures", 2))
        db.record(args.skill_id, old_ver, old_ver, "not_promoted",
                  f"promotion 未达标: cand_avg={cand_promo.average_score:.2f} "
                  f"champ_avg={judge_base.average_score:.2f} hard_fail={cand_promo.hard_failures}")
        if n >= trip:
            log(f"熔断: 连续 {n} 轮未晋升, 终止 (保留 {old_ver})")
            return 4
        log(f"候选未达晋升阈值 ({n}/{trip}); 保留 {old_ver}")
        return 1

    # [7] 晋升: 归档 -> 写回 -> bump -> champion -> 索引
    new_ver = bump_version(old_ver)
    new_body = best_v.snapshot.instructions
    log(f"晋升条件满足. {'[dry-run] 跳过写入' if args.dry_run else f'{old_ver} -> {new_ver}'}")
    if not args.dry_run:
        archive_dir = (root / cfg["paths"]["archive"]).resolve() / args.skill_id
        archive_dir.mkdir(parents=True, exist_ok=True)
        (archive_dir / f"{old_ver or 'unversioned'}-SKILL.md").write_text(
            skill_md.read_text(encoding="utf-8"), encoding="utf-8")
        (archive_dir / "history.jsonl").open("a", encoding="utf-8").write(
            json.dumps({"from": old_ver, "to": new_ver, "note": args.note,
                        "mutation": best_v.label, "avg_gain": round(
                            cand_promo.average_score - base_promo.average_score, 3),
                        "at": now_iso()}, ensure_ascii=False) + "\n")
        meta = dict(meta)
        meta["version"] = new_ver
        skill_md.write_text(dump_skill_md(meta, new_body), encoding="utf-8")
        set_champion(config, lineage_id=args.skill_id, variant=best_v,
                     summary=cand_promo.to_dict())
        n_terms = db.rebuild_keyword_index(
            args.skill_id, f"{desc}\n{new_body}")
        log(f"关键词倒排索引已更新 ({n_terms} terms)")
        db.breaker_reset(args.skill_id)
        db.record(args.skill_id, old_ver, new_ver, "promoted",
                  f"{best_v.label}: {args.note[:300]}")

    print(json.dumps({
        "skill": args.skill_id, "from": old_ver, "to": bump_version(old_ver),
        "result": "promoted" if not args.dry_run else "promoted(dry-run)",
        "mutation": best_v.label, "rules": len(rules),
        "dev": f"dev={len(dev_samples)} promo={len(promo_samples)}",
        "avg_gain": round(cand_promo.average_score - base_promo.average_score, 3),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
