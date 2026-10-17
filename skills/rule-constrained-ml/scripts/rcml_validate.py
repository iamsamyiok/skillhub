# -*- coding: utf-8 -*-
"""
rcml_validate.py —— 独立的"规则合规审计"工具

只依赖 (配方 recipe + 训练后权重 weights.json) 复现前向与约束检查,
不加载任何训练代码。用途: 合规/审计场景——审计师只看"规则"与"训出的系数",
复核模型是否满足声明的安全/单调性/非负约束, 而不必信任训练脚本。

用法:
  python rcml_validate.py recipe.yaml --weights w.json
  python rcml_validate.py recipe.yaml --weights w.json --csv data.csv --mse
"""
import argparse
import csv
import itertools
import json
import math

try:
    import yaml
except ImportError:
    yaml = None


def load_recipe(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if path.endswith(".json"):
        return json.loads(text)
    if yaml is None:
        return json.loads(text)
    return yaml.safe_load(text)


def load_weights(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def relu(x):
    return max(0.0, x)


def derive(recipe):
    neg = {i["id"] for i in recipe["inputs"] if i.get("sign") == "negative"}
    free = {i["id"] for i in recipe["inputs"] if i.get("sign") == "free"}
    floor = recipe["output"].get("floor", None)
    out_id = recipe["output"]["id"]
    return neg, free, floor, out_id


def coef(r, k, neg, free):
    if k in neg:
        return -relu(r[k])
    if k in free:
        return r[k]
    return relu(r[k])


def encode(recipe, sample):
    f = {}
    for inp in recipe["inputs"]:
        iid = inp["id"]
        x = float(sample.get(iid, 0))
        t = inp.get("type", "numeric")
        if t == "ordinal":
            f[iid] = relu(x - float(inp.get("base", 1)))
        elif t == "numeric":
            knee = inp.get("knee", None)
            f[iid] = relu(x - float(knee)) if knee is not None else x
        else:
            f[iid] = x
    return f


def forward(recipe, r, f, floor, cap):
    d = r["base"]
    for inp in recipe["inputs"]:
        iid = inp["id"]
        d += coef(r, iid, *derive(recipe)[:2]) * f[iid]
    if floor is not None:
        d = max(d, float(floor))
    if cap is not None:
        d = min(d, float(cap))
    return d


def _range(inp):
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


def audit(recipe, r):
    neg, free, floor, out_id = derive(recipe)
    cap = recipe["output"].get("cap", None)
    print("=== 独立合规审计 (recipe + weights, 不含训练代码) ===")
    ok = True
    print("[1] 符号域:")
    for inp in recipe["inputs"]:
        iid = inp["id"]
        c = coef(r, iid, neg, free)
        sgn = inp.get("sign")
        bad = (sgn == "positive" and c < -1e-9) or (sgn == "negative" and c > 1e-9)
        ok &= not bad
        print(f"    {iid:>8} coef={c:9.3f} sign={str(sgn):>8} {'OK' if not bad else 'FAIL'}")
    print("[2] 单调性(positive 输入):")
    for inp in recipe["inputs"]:
        if inp.get("sign") != "positive":
            continue
        lo, hi = _range(inp)
        steps = min(50, max(2, int(hi - lo)))
        prev, mono = None, True
        for i in range(steps + 1):
            v = lo + (hi - lo) * i / steps
            s = {x["id"]: ((lo + hi) / 2.0 if x.get("type") != "binary" else 0.0)
                 for x in recipe["inputs"]}
            s[inp["id"]] = v
            val = forward(recipe, r, encode(recipe, s), floor, cap)
            if prev is not None and val < prev - 1e-6:
                mono = False
            prev = val
        ok &= mono
        print(f"    {inp['id']:>8}: {'单调OK' if mono else 'FAIL'}")
    print("[3] 地板/上限/越界扫描:")
    worst, best = 1e9, -1e9
    ends = [_range(inp) for inp in recipe["inputs"]]
    for combo in itertools.product(*ends):
        s = {inp["id"]: v for inp, v in zip(recipe["inputs"], combo)}
        val = forward(recipe, r, encode(recipe, s), floor, cap)
        worst = min(worst, val)
        best = max(best, val)
    fok = (floor is None) or (worst >= float(floor) - 1e-9)
    cok = (cap is None) or (best <= float(cap) + 1e-9)
    ok &= (fok and cok)
    print(f"    最小预测={worst:.3f} 地板>={floor} {'OK' if fok else 'FAIL'}")
    print(f"    最大预测={best:.3f} 上限<={cap} {'OK' if cok else 'FAIL(越界)'}")
    print("=== 审计结论:", "全部通过" if ok else "存在违规", "===")
    return ok


def mse_on_csv(recipe, r, csv_path):
    neg, free, floor, out_id = derive(recipe)
    samples, y = [], []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            samples.append({i["id"]: float(row[i["id"]]) for i in recipe["inputs"]})
            y.append(float(row[out_id]))
    err = sum((forward(recipe, r, encode(recipe, s), floor,
                       recipe["output"].get("cap", None)) - yt) ** 2
              for s, yt in zip(samples, y))
    m = err / max(1, len(y))
    print(f"    CSV {csv_path}: 样本 {len(y)} 条, MSE={m:.3f}")
    return m


def main():
    ap = argparse.ArgumentParser(description="rcml_validate: 独立规则合规审计")
    ap.add_argument("recipe")
    ap.add_argument("--weights", required=True)
    ap.add_argument("--csv", help="可选: 在 CSV 上报告 MSE")
    ap.add_argument("--mse", action="store_true")
    args = ap.parse_args()
    recipe = load_recipe(args.recipe)
    r = load_weights(args.weights)
    audit(recipe, r)
    if args.csv:
        mse_on_csv(recipe, r, args.csv)


if __name__ == "__main__":
    main()
