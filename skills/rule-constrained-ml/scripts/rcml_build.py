# -*- coding: utf-8 -*-
"""
rcml_build.py —— 规则约束下的机器学习：配方 → 模型生成器

读取一份声明式「配方(recipe)」YAML/JSON，渲染出一个**完整、自包含**的
Python 模型文件（model_<name>.py）。生成的文件：
  - 把"明规则"编码成可微前向（加权求和 + ReLU 选择器 + 地板）
  - 符号约束(positive/negative)与地板(floor)在结构里冻结，绝不随训练改变
  - 只训练每个因素的「幅度系数」——把"你没把握的数"交给数据
  - 自带 train / audit(约束合规) / demo / CSV 数据接口 / 权重导入导出

用法：
  python rcml_build.py recipe.yaml                 # 生成 model_<name>.py
  python rcml_build.py recipe.yaml -o my_model.py   # 指定输出

配方规范见 references/recipe_spec.md。
核心思想源自 Cheng Lou 的 handwired: https://github.com/chenglou/handwired
"""
import argparse
import json
import os
import sys

try:
    import yaml
except ImportError:
    yaml = None


# ---------------------------------------------------------------------------
# 生成的模型文件模板（<<RECIPE_JSON>> 占位，渲染时替换；不含 f-string 大括号冲突）
# ---------------------------------------------------------------------------
MODEL_TEMPLATE = r'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  规则约束下的机器学习模型（自动生成 by rcml_build.py）
#  配方: <<NAME>>
#  思想: 把领域"明规则"(结构+符号+地板)冻结, 只训练各因素的幅度系数。
#  来源: https://github.com/chenglou/handwired
# ============================================================================
import csv
import json
import math
import argparse
import itertools

RECIPE = json.loads(r"""<<RECIPE_JSON>>""")

relu = lambda x: max(0.0, x)

# ---- 配方派生常量 ----------------------------------------------------------
RAW_KEYS = [inp["id"] for inp in RECIPE["inputs"]] + ["base"]
NEG = {inp["id"] for inp in RECIPE["inputs"] if inp.get("sign") == "negative"}
FREE = {inp["id"] for inp in RECIPE["inputs"] if inp.get("sign") == "free"}
FLOOR = RECIPE["output"].get("floor", None)
OUT_ID = RECIPE["output"]["id"]


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


def forward(r, f):
    """前向：加权和 + 地板。结构(符号/膝点/地板)冻结, 只 r 里的幅度可训。"""
    d = r["base"]
    for inp in RECIPE["inputs"]:
        iid = inp["id"]
        d += coef(r, iid) * f[iid]
    if FLOOR is not None:
        d = max(d, float(FLOOR))
    return d


def train(samples, y, epochs=4000, lr=5e-4, init=1.0):
    """仅更新 raw 参数；符号/地板/膝点由结构保证, 永不翻转。"""
    r = {k: float(init) for k in RAW_KEYS}
    n = max(1, len(samples))
    for ep in range(epochs):
        grad = {k: 0.0 for k in RAW_KEYS}
        loss = 0.0
        for s, yt in zip(samples, y):
            f = encode(s)
            d = r["base"]
            for inp in RECIPE["inputs"]:
                iid = inp["id"]
                d += coef(r, iid) * f[iid]
            if FLOOR is not None:
                yh = max(d, float(FLOOR))
                dd = (yh - yt) if d >= float(FLOOR) else 0.0
            else:
                yh = d
                dd = (yh - yt)
            loss += 0.5 * (yh - yt) ** 2
            for k in RAW_KEYS:
                wk = 1.0 if (k in FREE) else (1.0 if r[k] > 0 else 0.0)
                fk = 1.0 if k == "base" else f[k]
                if k in NEG:
                    grad[k] += dd * (-fk) * wk
                else:
                    grad[k] += dd * fk * wk
        for k in RAW_KEYS:
            r[k] -= lr * grad[k] / n
        if ep % 1000 == 0:
            print(f"  epoch {ep:5d}  loss={loss/n:.3f}")
    return r


def rules_report(r):
    """打印训练出的可读规则(幅度系数 + 符号域)。"""
    print("\n--- 训练出的可读规则 ---")
    print(f"  [base] 基础缓冲 = {r['base']:.3f}  (>=0 冻结)")
    for inp in RECIPE["inputs"]:
        iid = inp["id"]
        c = coef(r, iid)
        sgn = inp.get("sign")
        tag = "受限<=0" if sgn == "negative" else ("无约束" if sgn == "free" else ">=0")
        print(f"  [{iid}] {inp.get('label', iid):>8} 系数 = {c:9.3f}  ({tag})")
    if FLOOR is not None:
        print(f"  [floor] 最终 = max(加权和, {FLOOR})  (硬地板, 冻结)")


def _default_sample():
    s = {}
    for inp in RECIPE["inputs"]:
        lo, hi = _range(inp)
        s[inp["id"]] = lo if inp.get("type") == "binary" else (lo + hi) / 2.0
    return s


def audit(r):
    """约束合规审计：符号域 / 单调性 / 地板+越界扫描。供合规复核, 不依赖训练。"""
    print("\n=== 约束合规审计 ===")
    print("[1] 符号域检查:")
    ok_all = True
    for inp in RECIPE["inputs"]:
        iid = inp["id"]
        c = coef(r, iid)
        sgn = inp.get("sign")
        bad = (sgn == "positive" and c < -1e-9) or (sgn == "negative" and c > 1e-9)
        ok_all &= not bad
        print(f"    {iid:>8} coef={c:9.3f}  sign={str(sgn):>8}  {'OK' if not bad else 'FAIL'}")
    print("[2] 单调性检查(positive 输入应随信号单调不降):")
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
            val = forward(r, encode(s))
            if prev is not None and val < prev - 1e-6:
                mono = False
            prev = val
        print(f"    {iid:>8}: {'单调OK' if mono else 'FAIL(非单调)'}")
        ok_all &= mono
    print("[3] 地板 / 越界扫描(极端外推组合):")
    worst, worst_s = 1e9, None
    endpoints = []
    for inp in RECIPE["inputs"]:
        lo, hi = _range(inp)
        endpoints.append([lo, hi])
    for combo in itertools.product(*endpoints):
        s = {inp["id"]: v for inp, v in zip(RECIPE["inputs"], combo)}
        val = forward(r, encode(s))
        if val < worst:
            worst, worst_s = val, s
    floor_str = f">= {FLOOR}" if FLOOR is not None else "无"
    floor_ok = (FLOOR is None) or (worst >= float(FLOOR) - 1e-9)
    ok_all &= floor_ok
    print(f"    最小预测={worst:.3f}  地板={floor_str}  {'OK' if floor_ok else 'FAIL(越界)'}")
    print("=== 审计结论:", "全部通过" if ok_all else "存在违规(见上)", "===")
    return ok_all


def load_data_csv(path):
    """CSV 列名须匹配 input id + output id。"""
    samples, y = [], []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            samples.append({inp["id"]: float(row[inp["id"]]) for inp in RECIPE["inputs"]})
            y.append(float(row[OUT_ID]))
    return samples, y


def save_weights(r, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)


def load_weights(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def demo(epochs=4000, lr=5e-4, n=600, seed=7):
    """通用自测: 用随机真系数(遵守符号)造合成标签, 验证方法可恢复 + 约束成立。"""
    print(">>> DEMO: 合成数据自测(随机真系数, 遵守符号约束)")
    rng = math.sin  # 占位, 改用简单随机
    import random
    random.seed(seed)
    # 随机真系数(遵守符号)
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
            iid = inp["id"]
            d += coef(true_r, iid) * f[iid]
        if FLOOR is not None:
            d = max(d, float(FLOOR))
        y.append(d + random.gauss(0, 3))
    r = train(samples, y, epochs=epochs, lr=lr)
    rules_report(r)
    audit(r)
    return r


def main():
    ap = argparse.ArgumentParser(description="规则约束下的机器学习模型 (自动生成)")
    ap.add_argument("--demo", action="store_true", help="运行合成数据自测")
    ap.add_argument("--data", help="训练 CSV(列名=input id + output id)")
    ap.add_argument("--epochs", type=int, default=4000)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--init", type=float, default=1.0)
    ap.add_argument("--load-weights", help="载入已训练权重 json 后只做审计")
    ap.add_argument("--export-weights", help="训练后导出权重 json")
    ap.add_argument("--audit", action="store_true", help="对当前权重做约束合规审计")
    args = ap.parse_args()

    if args.load_weights:
        r = load_weights(args.load_weights)
        if args.audit or not args.data:
            audit(r)
        return
    if args.demo:
        demo(epochs=args.epochs, lr=args.lr)
        return
    if args.data:
        samples, y = load_data_csv(args.data)
        print(f">>> 载入 {len(samples)} 条样本, 开始训练(仅更新幅度系数)...")
        r = train(samples, y, epochs=args.epochs, lr=args.lr, init=args.init)
        rules_report(r)
        audit(r)
        if args.export_weights:
            save_weights(r, args.export_weights)
            print(f">>> 权重已导出: {args.export_weights}")
        return
    print("无操作。用法: --demo | --data file.csv [--epochs N --lr X --export-weights w.json] | --load-weights w.json --audit")


if __name__ == "__main__":
    main()
'''


def load_recipe(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if path.endswith(".json"):
        return json.loads(text)
    if yaml is None:
        # 退化为极简解析: 仅当无 yaml 时尝试 json
        return json.loads(text)
    return yaml.safe_load(text)


def build(recipe_path, out_path):
    recipe = load_recipe(recipe_path)
    name = recipe.get("name", "model")
    if not out_path:
        out_path = f"model_{name}.py"
    recipe_json = json.dumps(recipe, ensure_ascii=False)
    code = MODEL_TEMPLATE.replace("<<RECIPE_JSON>>", recipe_json).replace("<<NAME>>", name)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(code)
    print(f"已生成模型: {out_path}  (配方: {name}, 输入 {len(recipe['inputs'])} 个, 输出: {recipe['output']['id']})")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="rcml_build: 配方 -> 规则约束模型生成器")
    ap.add_argument("recipe", help="配方 YAML/JSON 路径")
    ap.add_argument("-o", "--output", help="输出模型 .py 路径")
    args = ap.parse_args()
    build(args.recipe, args.output)


if __name__ == "__main__":
    main()
