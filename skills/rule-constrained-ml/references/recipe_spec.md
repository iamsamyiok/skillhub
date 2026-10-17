# 三、配方规范（recipe_spec）

配方（recipe）是声明式 YAML/JSON，描述"明规则"。`rcml_build.py` 读它渲染出
自包含模型文件。**配方里只写结构/符号/地板/膝点，不写具体系数**——系数由数据训练。

## 顶层结构

```yaml
name: <英文名>            # 决定生成文件名 model_<name>.py
description: <一句话>
output:
  id: <因变量列名>        # CSV 中须同名
  floor: <数字|null>      # 硬地板: 最终输出 >= floor; null 关闭
inputs:
  - id: <特征id>
    label: <中文标签>
    type: <ordinal|numeric|binary>
    sign: <positive|negative|free>
    # 其余字段按 type 选填
```

## input 字段

| 字段 | 适用 type | 含义 | 默认值 |
|------|-----------|------|--------|
| `id` | 全部 | 特征标识，也是 CSV 列名 | 必填 |
| `label` | 全部 | 中文标签（报告用） | = id |
| `type` | 全部 | `ordinal` 有序档 / `numeric` 连续 / `binary` 0或1 | `numeric` |
| `sign` | 全部 | `positive` ≥0 冻结 / `negative` ≤0 受限 / `free` 无约束 | — |
| `base` | ordinal | 编码 `max(x - base, 0)` | 1 |
| `levels` | ordinal | 档位数（扫描范围 = base..base+levels-1） | 5 |
| `knee` | numeric | 膝点，编码 `max(x - knee, 0)`；省略则直接用 x | 无 |
| `range` | numeric | 扫描/外推范围 `[lo, hi]` | `[knee或0, 100]` |

## 编码规则（生成代码自动套用）

| type | 因子 f[id] |
|------|-----------|
| ordinal | `max(x - base, 0)` |
| numeric（有 knee） | `max(x - knee, 0)` |
| numeric（无 knee） | `x` |
| binary | `x` |

## 符号 → 系数映射（结构层冻结，永不翻转）

| sign | 实际系数 | 训练时 |
|------|---------|--------|
| positive | `relu(raw)` | 只调幅度，恒 ≥ 0 |
| negative | `-relu(raw)` | 只调幅度，恒 ≤ 0（受限可变） |
| free | `raw` | 无约束（慎用，放弃可解释保障） |

## 示例（完整可跑，见 scripts/recipe_example_deposit.yaml）

```yaml
name: deposit_estimator
output: { id: deposit_wan, floor: 0 }
inputs:
  - { id: occ,    label: 收入能级, type: ordinal, base: 1, levels: 5, sign: positive }
  - { id: age,    label: 年龄,     type: numeric, knee: 35,           sign: positive }
  - { id: house,  label: 自有住房, type: binary,                        sign: positive }
  - { id: child,  label: 有子女,   type: binary,                        sign: negative }
  - { id: cons,   label: 消费档,   type: ordinal, base: 1, levels: 3,   sign: negative }
```

> 生成模型后：`python model_deposit_estimator.py --demo` 自测；
> `python model_deposit_estimator.py --data x.csv --export-weights w.json` 真实训练；
> `python rcml_validate.py recipe.yaml --weights w.json` 独立审计。
