---
name: rule-constrained-ml
description: 把领域专家的确定性"明规则"(结构+符号+地板+膝点)与少量配对标签数据结合，只训练不确定的幅度系数，产出既精确又数据校准、可读可审计的混合模型。当用户有领域先验/安全约束、样本少、要可解释、不愿纯黑盒或纯规则时使用。触发词："规则约束机器学习"、"明规则+训练"、"白盒+标签数据"、"handwired"、"冻结规则训练"、"可解释模型"、"约束下回归"、"安全约束建模"。覆盖 界定→写配方→标签→生成模型→训练→约束审计→交付 全链路，内置三道人工关卡。
version: "1.0.0"
allowed-tools: Read, Write, Edit, Bash
---

# 规则约束下的机器学习（rule-constrained-ml）

> 思想来源：Cheng Lou 的 **handwired** —— https://github.com/chenglou/handwired
> 核心：**先把手头的领域知识写成一条结构化规则（明规则），再让梯度只去调你没把握的那几个幅度系数。**
> 传统两条路——纯规则（精确但死板）vs 纯模型（自适应但不可控）——本 skill 走中间地带。

## 一、定位与边界（诚实声明）

**本 skill 做什么**：把"你相信正确的结构"冻结，把"你没把握的幅度"交给数据，产出一个**可读规则 + 调好的系数**，而非黑盒权重堆。天然保证符号域、单调性、非负/上限等硬约束。

**本 skill 不做什么**（如实告知，不承诺）：
- 不替代无结构的纯拟合——若你**没有任何先验结构**，直接用回归/GBM/NN 更省事更准。
- 不解决"标签从哪来"——`(x, y_true)` 配对数据是用户必须自己采集/合规获取的硬前提。
- 不保证合规——涉及个人/敏感字段（如资产、健康）须用户自行过 PIPL 与算法伦理审查；**本 skill 仅为方法演示**。

**适用**：有先验结构 + (小数据 | 要保安全 | 要可解释)。**不适用**：纯无结构拟合、无法获取标签、未过合规。

## 二、前置依赖检查（S0，缺失即提示）

| 依赖 | 必需性 | 用途 |
|------|--------|------|
| Python 3.10+ | 必需 | 运行生成器/模型 |
| PyYAML（`pip install pyyaml`） | 建议 | 读 YAML 配方；缺则可用 JSON 配方 |
| 标签数据（CSV，列名=input id+output id） | **必需** | 训练唯一硬前提 |
| 领域先验（专家写的规则方向/约束） | **必需** | 落成 recipe 的明规则 |

> 本 skill **零重型依赖**：生成出的模型文件仅用 Python 标准库（csv/json），审计工具仅加可选 PyYAML。无需 torch/numpy。

## 三、决策：何时用本 skill

```
有"已知一定对"的领域结构(方向/安全/单调)? ──否──► 直接用回归/GBM/NN
        │是
有(小数据 | 要保安全硬约束 | 要可读可审计)? ──否──► 普通 ML 更合适
        │是
      ✅ 用本 skill：冻结结构 + 只训幅度
```

## 四、工作流（七步 + 三道人工关卡）

```
S0 依赖自检 ──► S1 界定系统 ──G1──► S2 写配方(明规则) ──► S3 标签数据 ──G2──►
S4 rcml_build 生成模型 ──► S5 训练+自检 ──► S6 rcml_validate 独立审计 ──G3──► S7 交付报告
```

**S1 界定**：列出 N 个自变量（数值直用；类别 one-hot）、1 个因变量（量纲）。
**S2 写配方**：按 references/recipe_spec.md，把每个因素的**类型、符号、膝点、地板**落成 YAML。**这是本 skill 的灵魂——能确定的全冻结，没把握的标可训练/受限。**
**S3 标签**：采集 `(x, y_true)`；覆盖边界；过合规。
**S4 生成**：`python scripts/rcml_build.py recipe.yaml -o model_<name>.py`。
**S5 训练**：`python model_<name>.py --demo`（自测）或 `--data x.csv --export-weights w.json`。
**S6 审计**：`python scripts/rcml_validate.py recipe.yaml --weights w.json [--csv x.csv]`（独立复核符号域/单调性/越界）。
**S7 交付**：套 templates/report_template.md 出报告。

### 三道人工关卡（agent 必须停下等确认）

| 关卡 | 通过标准 | 产物签字 |
|------|----------|----------|
| **G1 明规则确认** | 用户确认 recipe 的变量、符号、地板、膝点符合领域真实 | recipe.yaml |
| **G2 数据合规确认** | 用户确认标签来源合法、覆盖边界、无隐私违规 | 数据说明 |
| **G3 交付确认** | 约束审计全通过 + 报告可读规则已审阅 | report.md |

> agent 负责"从零到有"(生成/训练/校验)；人负责"从好看到能用"——尤其 G1 明规则与 G2 数据合规，必须由人把关。

## 五、目录与产物规范

```
rule-constrained-ml/
├── SKILL.md
├── references/
│   ├── philosophy.md      # handwired 思想 + 四分类法
│   ├── methodology.md     # 通用七步 + 何时用决策树
│   ├── recipe_spec.md     # 配方 YAML 规范
│   └── pitfalls.md        # 10 条常见坑
├── scripts/
│   ├── rcml_build.py      # 配方 → 自包含模型生成器
│   ├── rcml_validate.py   # 独立规则合规审计(只靠 recipe+weights)
│   └── recipe_example_deposit.yaml  # 存款演示配方
├── templates/
│   ├── recipe_template.yaml   # 配方模板
│   └── report_template.md     # 交付报告模板
└── examples/
    └── model_deposit_estimator.py  # 由示例配方生成的可运行模型(演示)
```

**每轮交付必须留存**：① `recipe.yaml`（明规则，冻结）② `w.json`（训练后幅度系数）③ `report.md`（含审计结论）。三者齐备方可独立复现与合规审计。

## 六、脚本速查

| 脚本 | 命令 | 作用 |
|------|------|------|
| `rcml_build.py` | `python scripts/rcml_build.py recipe.yaml -o model_x.py` | 配方渲染为自包含模型 |
| 生成模型 | `python model_x.py --demo` | 合成数据自测(验证方法) |
| 生成模型 | `python model_x.py --data x.csv --epochs 4000 --export-weights w.json` | 真实训练+导出权重 |
| 生成模型 | `python model_x.py --load-weights w.json --audit` | 载入权重审计 |
| `rcml_validate.py` | `python scripts/rcml_validate.py recipe.yaml --weights w.json --csv x.csv` | 独立合规审计+CSV上MSE |

## 七、最小示例（存款推导，已在 examples/ 落地）

`recipe_example_deposit.yaml` → `examples/model_deposit_estimator.py`：
输入 8 个公众可见信号（收入/城市/学历能级、年龄、住房、座驾、子女、消费），输出存款(万元)。
- **冻结**：存款≥0 地板；收入/城市/学历/住房/年龄(35岁后)同向；子女/消费/座驾反向。
- **可训**：每个因素幅度系数。
- **验证**：demo 自测恢复系数；极端外推扫描最小预测=0（地板受保）；无约束回归对照在同分布 MSE 略低但会在分布外给出负存款。

> 明规则不含任何具体数字——只有"什么该涨、什么该跌、永不负数、35 岁前不算年龄红利"这四条结构。具体涨多少跌多少，是灰盒，交给数据。
