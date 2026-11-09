---
name: hybrid-constrained-ml
description: 把"规则约束下的机器学习(rcml)白盒先验"与"XGBoost 残差"融合——用同一份声明式配方，冻结你相信正确的结构(符号/膝点/地板/上限)并只训幅度系数，再用 XGBoost 拟合"真实−先验"的残差补抓交互/非线性，最终预测经 clip(floor,cap) 硬护栏。既保留 rcml 的可解释、可审计、安全约束永不翻转，又获得 XGBoost 的精度与灵活；小数据友好、分布外安全。触发词："融合建模"、"rcml+XGBoost"、"白盒+黑盒"、"规则约束机器学习融合"、"可解释+梯度提升"、"约束下回归带残差"、"安全约束建模"、"handwired+xgboost"。覆盖 界定→写配方→标签→生成模型→训练→约束审计→交付 全链路，内置三道人工关卡。
version: "1.0.0"
category: 开发工具
tags: [融合建模, 规则约束机器学习, XGBoost, 可解释模型, 白盒, handwired, 约束建模, 混合模型, 残差学习, 安全护栏]
allowed-tools: Read, Write, Edit, Bash
---

# 融合约束机器学习（hybrid-constrained-ml）

> 思想来源：Cheng Lou 的 **handwired** —— https://github.com/chenglou/handwired
> 本 skill = **rcml 白盒先验（rule-constrained-ml 的超集）** + **XGBoost 残差** 的融合。
> 核心：**结构和安全交白盒(rcml)，精度和灵活交黑盒(XGBoost)，二者用一道 `clip(floor,cap)` 护栏缝合。**

## 一、定位与边界（诚实声明）

**本 skill 做什么**：用一份声明式配方把"你相信一定对的结构"冻结，再用 rcml 只训幅度系数产出可解释白盒先验；然后让 XGBoost 去学"真实 − 先验"的残差，补抓白盒纯加性骨架抓不到的交互项/非线性；最后 `clip` 焊死地板与上限。**纯 rcml 是死板的，纯 XGBoost 是不可控的，本 skill 取中间且更稳的那条路。**

**本 skill 不做什么**（如实告知）：
- 不替代无结构的纯拟合——若**完全没有先验结构**，直接 XGBoost/GBM 更省事更准。
- 不解决"标签从哪来"——`(x, y_true)` 配对数据是用户必须自己采集/合规获取的硬前提。
- 不保证合规——涉及个人/敏感字段（资产、健康）须用户自行过 PIPL 与算法伦理审查；**本 skill 仅为方法演示**。
- **XGBoost 为可选依赖**：未安装时自动降级为纯 rcml 白盒先验（仅打印 warn，不报错）。

**适用**：有先验结构 + (小数据 | 要保安全硬约束 | 要可解释) + 想进一步补抓交互/非线性。
**不适用**：纯无结构拟合、无法获取标签、未过合规。当 `residual_method: none` 时本 skill 完全等价于纯 rcml。

## 二、融合思想（一图）

```
        ┌──── 你相信"一定对"的结构 ──── rcml 白盒先验: 冻结 符号/膝点/地板/上限, 只训幅度 ────┐
真实 y ─┤                                                                                      │
        └──── 残差 = y − y_prior ──► XGBoost 残差: 抓交互/非线性(继承单调方向) ──────────────────┘
                                     │
        合成 = clip( y_prior + 残差 , floor , cap )   ← 安全边界由白盒焊死, XGBoost 绕不过
```

**四种融合模式（本 skill 落地 模式 1 + 2）**：
1. **rcml 先验 + XGBoost 残差（加性）** ← 主推，`fusion.residual_method: xgboost`
2. **安全壳包裹**：任意黑盒外 `clip(floor,cap)` 即可后装硬约束
3. handwired 控制架构 + ML 叶节点（高阶）
4. 自定义损失正则（把单调/非负作为 XGBoost 正则，软约束）

## 三、前置依赖检查（S0）

| 依赖 | 必需性 | 用途 |
|------|--------|------|
| Python 3.10+ | 必需 | 运行生成器/模型 |
| PyYAML（`pip install pyyaml`） | 建议 | 读 YAML 配方；缺则可用 JSON |
| XGBoost（`pip install xgboost`） | **残差可选** | 残差模块；缺失自动降级纯白盒 |
| 标签数据（CSV） | **必需** | 训练唯一硬前提 |
| 领域先验 | **必需** | 落成 recipe 的明规则 |

> 生成出的模型文件仅用标准库 + 可选 pandas/xgboost，**零重型依赖**；XGBoost 缺失也能跑白盒先验。

## 四、工作流（七步 + 三道人工关卡）

```
S0 依赖自检 ──► S1 界定系统 ──G1──► S2 写配方(明规则+融合声明) ──►
S3 标签数据 ──G2──► S4 hybrid_build 生成模型 ──► S5 训练+自检 ──►
S6 约束审计 ──G3──► S7 交付报告
```

- **S1 界定**：N 个自变量（数值/binary/ordinal）+ 1 个因变量（量纲）。
- **S2 写配方**：按 references/recipe_spec.md，把每个因素的**类型、符号、膝点、范围**及 `output` 的 **floor/cap**、`fusion` 的残差方法落成 YAML。**能确定的全冻结，没把握的标 free 或交残差。**
- **S3 标签**：采集 `(x, y_true)`；覆盖边界；过合规。
- **S4 生成**：`python scripts/hybrid_build.py recipe.yaml -o model_<name>.py`。
- **S5 训练**：`python model_<name>.py --demo`（自测）或 `--data x.csv --export-weights w.json`。
- **S6 审计**：`python model_<name>.py --load-weights w.json --audit`（符号域/单调/护栏边界）。
- **S7 交付**：套 templates/report_template.md。

### 三道人工关卡（agent 必须停下等确认）

| 关卡 | 通过标准 | 产物签字 |
|------|----------|----------|
| **G1 明规则确认** | 用户确认 recipe 的变量、符号、地板、上限、膝点符合领域真实 | recipe.yaml |
| **G2 数据合规确认** | 用户确认标签来源合法、覆盖边界、无隐私违规 | 数据说明 |
| **G3 交付确认** | 约束审计全通过 + 报告可读规则已审阅 | report.md |

## 五、目录与产物规范

```
hybrid-constrained-ml/
├── SKILL.md
├── references/
│   ├── philosophy.md      # 融合哲学: 白盒保底+黑盒补强
│   ├── methodology.md     # 四模式 + 七步 + 决策树
│   ├── recipe_spec.md     # 配方 YAML 规范(含 fusion 字段)
│   └── pitfalls.md        # 10 条常见坑
├── scripts/
│   ├── hybrid_build.py            # 配方 → 自包含融合模型生成器
│   ├── recipe_deposit_hybrid.yaml # 存款演示配方(仅地板)
│   └── recipe_water_dosing_hybrid.yaml # 加药演示配方(地板+安全上限 cap=60)
├── templates/
│   ├── recipe_template.yaml   # 配方模板
│   └── report_template.md     # 交付报告模板
└── examples/
    ├── model_deposit_hybrid.py      # 由示例配方生成的存款融合模型
    └── model_water_dosing_hybrid.py # 加药融合模型(cap=60 安全红线演示)
```

**每轮交付必须留存**：① `recipe.yaml`（明规则，冻结）② `w.json` + `w.xgb.json`（白盒幅度 + XGBoost 残差模型）③ `report.md`（含审计结论）。三者齐备方可独立复现与合规审计。

## 六、脚本速查

| 脚本 | 命令 | 作用 |
|------|------|------|
| `hybrid_build.py` | `python scripts/hybrid_build.py recipe.yaml -o model_x.py` | 配方渲染为自包含融合模型 |
| 生成模型 | `python model_x.py --demo` | 合成数据自测(验证融合>纯rcml + 护栏受保) |
| 生成模型 | `python model_x.py --data x.csv --epochs 4000 --export-weights w.json` | 真实训练+导出权重(含 .xgb.json) |
| 生成模型 | `python model_x.py --load-weights w.json --audit` | 载入权重审计(符号域/单调/护栏) |

## 七、最小示例（已落地，见 examples/）

**示例 A — 存款推导**（`recipe_deposit_hybrid.yaml` → `model_deposit_hybrid.py`）：
输入 8 个公众可见信号（职业/城市/学历能级、年龄、住房、座驾、子女、消费），输出存款(万元)。
- **冻结**：存款≥0 地板；职业/城市/学历/住房/年龄(35岁后)同向；子女/消费/座驾反向。
- **融合**：XGBoost 残差补抓"收入×学历"协同红利（纯加性白盒骨架表达不了）。
- **验证（demo）**：融合训练集 MSE=9.293 vs 纯 rcml=10.511，**降 11.6%**；极端外推最小预测=0.000，地板受保。

**示例 B — 加药系统**（`recipe_water_dosing_hybrid.yaml` → `model_water_dosing_hybrid.py`）：
输入 6 个工艺变量（浊度/流量/水温/COD/低温工况/新药剂批次），输出混凝剂投加量(mg/L)。
- **冻结**：投加恒在 [0, 60]（地板≥0 + **安全上限 cap≤60**，对应"投加绝不超量"）；浊度/流量/COD/低温同向、水温反向；新批次 `sign: free`。
- **验证（demo）**：极端外推最大预测=**60.000**、最小=0.000，上限/地板均受保——**XGBoost 再怎么训也绕不过 60mg/L 安全红线**。

> 明规则不含任何具体数字——只有"什么该涨、什么该跌、永不负数、绝不超过上限、35 岁前不算年龄红利"这些结构。具体涨多少跌多少，是灰盒，交给数据。示例 B 的 `cap` 正是你加药系统"pH>9 必停泵"那类硬约束的同构实现。
