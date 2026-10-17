#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  混合约束机器学习模型（自动生成 by hybrid_build.py）
#  融合: rcml 白盒先验(冻结结构 + 硬护栏)  +  XGBoost 残差(补抓交互/非线性)
#  配方: water_dosing_hybrid
#  思想: https://github.com/chenglou/handwired
#  最终预测 = clip(先验 + 残差, floor, cap) —— 安全边界由白盒焊死。
# ============================================================================
import csv
import json
import math
import os
import argparse
import itertools

# ---- XGBoost 为可选依赖: 缺失时本模型自动降级为纯 rcml(仅白盒先验) ----
try:
    import pandas as pd
    import xgboost as xgb
    _HAVE_XGB = True
except Exception:
    _HAVE_XGB = False

RECIPE = json.loads(r"""{"name": "water_dosing_hybrid", "output": {"id": "dose", "floor": 0, "cap": 60}, "fusion": {"residual_method": "xgboost", "xgb_params": {"n_estimators": 300, "learning_rate": 0.05, "max_depth": 4}}, "inputs": [{"id": "turbidity", "label": "进水浊度", "type": "numeric", "range": [0, 80], "sign": "positive"}, {"id": "flow", "label": "进水流量", "type": "numeric", "range": [0, 1000], "sign": "positive"}, {"id": "temp", "label": "水温", "type": "numeric", "range": [2, 35], "sign": "negative"}, {"id": "cod", "label": "进水COD", "type": "numeric", "range": [0, 400], "sign": "positive"}, {"id": "cold", "label": "低温工况", "type": "binary", "sign": "positive"}, {"id": "newbatch", "label": "新药剂批次", "type": "binary", "sign": "free"}]}""")

relu = lambda x: max(0.0, x)

# ---- 配方派生常量 ----------------------------------------------------------
RAW_KEYS = [inp["id"] for inp in RECIPE["inputs"]] + ["base"]
POS = {inp["id"] for inp in RECIPE["inputs"] if inp.get("sign") == "positive"}
NEG = {inp["id"] for inp in RECIPE["inputs"] if inp.get("sign") == "negative"}
FREE = {inp["id"] for inp in RECIPE["inputs"] if inp.get("sign") == "free"}
FLOOR = RECIPE["output"].get("floor", None)
CAP = RECIPE["output"].get("cap", None)
OUT_ID = RECIPE["output"]["id"]
INPUT_IDS = [inp["id"] for inp in RECIPE["inputs"]]
FUSION = RECIPE.get("fusion", {}) or {}
RES_METHOD = (FUSION.get("residual_method") or "xgboost").lower()
XGB_PARAMS = FUSION.get("xgb_params", {}) or {}

# 单调性方向: 供 XGBoost monotone_constraints (positive=+1 / negative=-1 / free=0)
MONO = tuple(1 if i.get("sign") == "positive" else (-1 if i.get("sign") == "negative" else 0)
             for i in RECIPE["inputs"])


def _range(inp):
    """输入扫描/外推范围。"""
    t = inp.get("type", "numeric")
    if t == "binary":
        return (0.0, 1.0)
    if t == "ordinal":
        base = float(inp.get("base", 1))
        levels = inp.get("levels", 5)
        return (base, base + levels - 1)
    rg = inp.get("range")
    if rg:
        return (float(rg[0]), float(rg[1]))
    knee = inp.get("knee")
    return (float(knee) if knee is not None else 0.0, 100.0)


def encode(sample):
    """原始样本( dict: input_id -> value ) -> 因子 dict（含 ReLU 膝点/选择器）。"""
    f = {}
    for inp in RECIPE["inputs"]:
        iid = inp["id"]
        x = float(sample.get(iid, 0))
        t = inp.get("type", "numeric")
        if t == "ordinal":
            f[iid] = relu(x - float(inp.get("base", 1)))
        elif t == "numeric":
            knee = inp.get("knee", None)
            f[iid] = relu(x - float(knee)) if knee is not None else x
        else:  # binary
            f[iid] = x
    return f


def coef(r, k):
    """把 raw 参数映射成实际系数；符号约束在结构里冻结。"""
    if k in NEG:
        return -relu(r[k])
    if k in FREE:
        return r[k]
    return relu(r[k])


def prior_forward(r, f):
    """白盒先验前向：加权和（结构/符号/膝点冻结，只 r 里的幅度可训）。无护栏。"""
    d = r["base"]
    for inp in RECIPE["inputs"]:
        iid = inp["id"]
        d += coef(r, iid) * f[iid]
    return d


def clip(d):
    """硬护栏：地板 + 上限（rcml 焊死，XGBoost 也绕不过）。"""
    if FLOOR is not None:
        d = max(d, float(FLOOR))
    if CAP is not None:
        d = min(d, float(CAP))
    return d


def prior_value(r, sample):
    """白盒先验预测（含护栏），用作残差目标基线。"""
    return clip(prior_forward(r, encode(sample)))


def train_prior(samples, y, epochs=4000, lr=5e-4, init=1.0):
    """仅更新 raw 参数；符号/地板/膝点由结构保证, 永不翻转。"""
    r = {k: float(init) for k in RAW_KEYS}
    n = max(1, len(samples))
    for ep in range(epochs):
        grad = {k: 0.0 for k in RAW_KEYS}
        loss = 0.0
        for s, yt in zip(samples, y):
            yh = prior_value(r, s)
            dd = (yh - yt)
            loss += 0.5 * (yh - yt) ** 2
            for k in RAW_KEYS:
                wk = 1.0 if (k in FREE) else (1.0 if r[k] > 0 else 0.0)
                fk = 1.0 if k == "base" else encode(s)[k]
                if k in NEG:
                    grad[k] += dd * (-fk) * wk
                else:
                    grad[k] += dd * fk * wk
        for k in RAW_KEYS:
            r[k] -= lr * grad[k] / n
        if ep % 1000 == 0:
            print(f"  [prior] epoch {ep:5d}  loss={loss/n:.3f}")
    return r


def to_df(X):
    """样本列表 -> XGBoost 用的 DataFrame（列=配方输入顺序, 原始数值）。"""
    return pd.DataFrame([{iid: float(s.get(iid, 0)) for iid in INPUT_IDS} for s in X])


def train_residual(X, res):
    """训练 XGBoost 残差；继承配方单调方向。缺失依赖或关闭时返回 None。"""
    if RES_METHOD in ("none", "off", "false"):
        return None
    if not _HAVE_XGB:
        print("  [warn] 未装 xgboost(pip install xgboost)，残差模块关闭，退化为纯 rcml 白盒先验。")
        return None
    params = dict(n_estimators=300, learning_rate=0.05, max_depth=4,
                  tree_method="hist", monotone_constraints=MONO)
    params.update(XGB_PARAMS or {})
    m = xgb.XGBRegressor(**params)
    m.fit(to_df(X), res)
    return m


class HybridModel:
    """融合模型：白盒先验 + XGBoost 残差，预测经硬护栏。"""

    def __init__(self):
        self.r = None
        self.res = None

    def fit(self, samples, y, epochs=4000, lr=5e-4, init=1.0):
        print("=== [1/2] 训练 rcml 白盒先验 (冻结结构, 只训幅度) ===")
        self.r = train_prior(samples, y, epochs=epochs, lr=lr, init=init)
        yp = [prior_value(self.r, s) for s in samples]
        residual = [a - b for a, b in zip(y, yp)]
        print("=== [2/2] 训练 XGBoost 残差 (单调方向对齐配方符号) ===")
        self.res = train_residual(samples, residual)
        if self.res is None:
            print("  (残差模块未启用, 本模型等价于纯 rcml 白盒先验)")
        return self

    def predict(self, sample):
        d = prior_forward(self.r, encode(sample))
        if self.res is not None:
            d += float(self.res.predict(to_df([sample]))[0])
        return clip(d)

    def predict_prior_only(self, sample):
        return prior_value(self.r, sample)

    def rules_report(self):
        print("\n--- 白盒先验可读规则 (幅度系数 + 符号域) ---")
        print(f"  [base] 基础缓冲 = {self.r['base']:.3f}  (>=0 冻结)")
        for inp in RECIPE["inputs"]:
            iid = inp["id"]
            c = coef(self.r, iid)
            sgn = inp.get("sign")
            tag = "受限<=0" if sgn == "negative" else ("无约束" if sgn == "free" else ">=0")
            print(f"  [{iid}] {inp.get('label', iid):>8} 系数 = {c:9.3f}  ({tag})")
        if FLOOR is not None:
            print(f"  [floor] 最终 = max(加权和+残差, {FLOOR})  (硬地板, 冻结)")
        if CAP is not None:
            print(f"  [cap]   最终 = min(前述, {CAP})  (硬上限, 冻结)")
        print(f"  [residual] XGBoost 残差模块: {'启用' if self.res is not None else '未启用(纯白盒)'}")

    def audit(self):
        """约束合规审计：符号域 / 单调性 / 护栏边界扫描（含 XGBoost 残差后）。"""
        print("\n=== 约束合规审计 ===")
        ok_all = True
        print("[1] 符号域检查 (白盒先验):")
        for inp in RECIPE["inputs"]:
            iid = inp["id"]
            c = coef(self.r, iid)
            sgn = inp.get("sign")
            bad = (sgn == "positive" and c < -1e-9) or (sgn == "negative" and c > 1e-9)
            ok_all &= not bad
            print(f"    {iid:>8} coef={c:9.3f}  sign={str(sgn):>8}  {'OK' if not bad else 'FAIL'}")
        print("[2] 单调性检查 (positive 输入随信号单调不降):")
        for inp in RECIPE["inputs"]:
            if inp.get("sign") != "positive":
                continue
            iid = inp["id"]
            lo, hi = _range(inp)
            steps = min(50, max(2, int(hi - lo)))
            prev, mono = None, True
            for i in range(steps + 1):
                v = lo + (hi - lo) * i / steps
                s = _default_sample()
                s[iid] = v
                val = predict(self.r, self.res, s)
                if prev is not None and val < prev - 1e-6:
                    mono = False
                prev = val
            print(f"    {iid:>8}: {'单调OK' if mono else 'FAIL(非单调)'}")
            ok_all &= mono
        print("[3] 护栏边界扫描 (极端外推组合, 含 XGBoost 残差后):")
        worst, best = 1e9, -1e9
        endpoints = []
        for inp in RECIPE["inputs"]:
            lo, hi = _range(inp)
            endpoints.append([lo, hi])
        for combo in itertools.product(*endpoints):
            s = {inp["id"]: v for inp, v in zip(RECIPE["inputs"], combo)}
            val = predict(self.r, self.res, s)
            if val < worst:
                worst = val
            if val > best:
                best = val
        floor_str = f">= {FLOOR}" if FLOOR is not None else "无"
        cap_str = f"<= {CAP}" if CAP is not None else "无"
        floor_ok = (FLOOR is None) or (worst >= float(FLOOR) - 1e-9)
        cap_ok = (CAP is None) or (best <= float(CAP) + 1e-9)
        ok_all &= (floor_ok and cap_ok)
        print(f"    最小预测={worst:.3f}  地板{floor_str}  {'OK' if floor_ok else 'FAIL'}")
        print(f"    最大预测={best:.3f}  上限{cap_str}  {'OK' if cap_ok else 'FAIL(越界)'}")
        print("=== 审计结论:", "全部通过" if ok_all else "存在违规(见上)", "===")
        return ok_all


def predict(r, res_model, sample):
    """模块级预测（供审计/脚本复用）。"""
    d = prior_forward(r, encode(sample))
    if res_model is not None:
        d += float(res_model.predict(to_df([sample]))[0])
    return clip(d)


def _default_sample():
    s = {}
    for inp in RECIPE["inputs"]:
        lo, hi = _range(inp)
        s[inp["id"]] = lo if inp.get("type") == "binary" else (lo + hi) / 2.0
    return s


def load_data_csv(path):
    """CSV 列名须匹配 input id + output id。"""
    samples, y = [], []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            samples.append({inp["id"]: float(row[inp["id"]]) for inp in RECIPE["inputs"]})
            y.append(float(row[OUT_ID]))
    return samples, y


def save_weights(r, res_model, path):
    """导出权重: r(白盒幅度) -> json; XGBoost 残差模型 -> 同级 .xgb.json。"""
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"r": r, "residual_method": RES_METHOD}, fh, ensure_ascii=False, indent=2)
    if res_model is not None:
        xgb_path = os.path.splitext(path)[0] + ".xgb.json"
        res_model.get_booster().save_model(xgb_path)  # XGBoost 原生 JSON 模型
        print(f">>> XGBoost 残差模型已导出: {xgb_path}")


def load_weights(path):
    """载入权重: 读 r + 同级 .xgb.json(若存在)。"""
    with open(path, "r", encoding="utf-8") as fh:
        blob = json.load(fh)
    r = blob["r"]
    res_model = None
    xgb_path = os.path.splitext(path)[0] + ".xgb.json"
    if os.path.exists(xgb_path) and _HAVE_XGB:
        res_model = xgb.XGBRegressor()
        res_model.load_model(xgb_path)
    elif os.path.exists(xgb_path) and not _HAVE_XGB:
        print("  [warn] 权重含 XGBoost 残差, 但本环境未装 xgboost, 残差将不生效。")
    return r, res_model


def demo(epochs=4000, lr=5e-4, n=600, seed=7):
    """通用自测: 合成真系数(遵守符号) + 交互项, 验证 融合>纯rcml 且护栏受保。"""
    print(">>> DEMO: 合成数据自测 (随机真系数遵守符号 + 结构化交互项)")
    import random
    random.seed(seed)
    true_r = {}
    for k in RAW_KEYS:
        if k == "base":
            true_r[k] = random.uniform(1, 5)
        elif k in NEG:
            true_r[k] = random.uniform(0.5, 3)
        elif k in FREE:
            true_r[k] = random.uniform(-2, 2)
        else:
            true_r[k] = random.uniform(0.5, 4)
    pos_ids = [i["id"] for i in RECIPE["inputs"] if i.get("sign") == "positive"]
    inter = (pos_ids[0], pos_ids[1]) if len(pos_ids) >= 2 else None
    k_inter = 0.4 if inter else 0.0
    samples = []
    for _ in range(n):
        s = {}
        for inp in RECIPE["inputs"]:
            lo, hi = _range(inp)
            if inp.get("type") == "binary":
                s[inp["id"]] = float(random.randint(0, 1))
            elif inp.get("type") == "ordinal":
                s[inp["id"]] = float(random.randint(int(lo), int(hi)))
            else:
                s[inp["id"]] = random.uniform(lo, hi)
        samples.append(s)
    y = []
    for s in samples:
        f = encode(s)
        d = true_r["base"]
        for inp in RECIPE["inputs"]:
            d += coef(true_r, inp["id"]) * f[inp["id"]]
        if inter:
            d += k_inter * f[inter[0]] * f[inter[1]]
        if FLOOR is not None:
            d = max(d, float(FLOOR))
        if CAP is not None:
            d = min(d, float(CAP))
        y.append(d + random.gauss(0, 3))
    model = HybridModel().fit(samples, y, epochs=epochs, lr=lr)
    model.rules_report()
    model.audit()
    model_no = HybridModel()
    model_no.r = train_prior(samples, y, epochs=epochs, lr=lr)
    model_no.res = None
    m_hyb = _mse([model.predict(s) for s in samples], y)
    m_rc = _mse([model_no.predict(s) for s in samples], y)
    print(f"\n>>> 训练集 MSE: 融合={m_hyb:.3f}  纯rcml={m_rc:.3f}  "
          f"融合相对纯rcml {'降低' if m_hyb < m_rc else '升高'} {abs(1 - m_hyb/m_rc):.1%}")
    return model


def _mse(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) / max(1, len(a))


def main():
    ap = argparse.ArgumentParser(description="混合约束机器学习模型 (rcml先验+XGBoost残差, 自动生成)")
    ap.add_argument("--demo", action="store_true", help="运行合成数据自测")
    ap.add_argument("--data", help="训练 CSV(列名=input id + output id)")
    ap.add_argument("--epochs", type=int, default=4000)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--init", type=float, default=1.0)
    ap.add_argument("--load-weights", help="载入已训练权重 json(+同级.xgb.json)后只做审计/预测")
    ap.add_argument("--export-weights", help="训练后导出权重 json")
    ap.add_argument("--audit", action="store_true", help="对当前权重做约束合规审计")
    args = ap.parse_args()

    if args.load_weights:
        r, res_model = load_weights(args.load_weights)
        m = HybridModel(); m.r = r; m.res = res_model
        if args.audit or not args.data:
            m.rules_report(); m.audit()
        return
    if args.demo:
        demo(epochs=args.epochs, lr=args.lr)
        return
    if args.data:
        samples, y = load_data_csv(args.data)
        print(f">>> 载入 {len(samples)} 条样本, 开始训练(白盒幅度 + XGBoost 残差)...")
        model = HybridModel().fit(samples, y, epochs=args.epochs, lr=args.lr, init=args.init)
        model.rules_report()
        model.audit()
        if args.export_weights:
            save_weights(model.r, model.res, args.export_weights)
            print(f">>> 权重已导出: {args.export_weights}")
        return
    print("无操作。用法: --demo | --data file.csv [--epochs N --lr X --export-weights w.json] | --load-weights w.json --audit")


if __name__ == "__main__":
    main()
