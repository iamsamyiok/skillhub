# 配方（recipe）YAML 规范

配方是声明式的：把"你相信正确的结构"写成 YAML，**不含任何具体数字**（只有方向/膝点/边界这些结构）。具体涨多少，交给数据。

## 顶层结构

```yaml
name: my_model            # 模型 id（生成文件名 model_<name>.py）
output:
  id: y                   # 因变量列名（CSV 也用它）
  floor: 0                # 硬地板(可选): 最终预测恒 >= floor
  cap: 60                 # 硬上限(可选): 最终预测恒 <= cap
fusion:
  residual_method: xgboost   # xgboost | none(降级纯白盒)
  xgb_params:                # 可选, 覆盖 XGBoost 超参
    n_estimators: 300
    learning_rate: 0.05
    max_depth: 4
inputs:
  - id: x1
    label: 名称
    type: numeric | ordinal | binary
    sign: positive | negative | free
    knee: 35          # numeric/ordinal 可选: ReLU 膝点
    range: [0, 80]    # numeric 可选: 扫描/外推范围
    base: 1           # ordinal 可选: 基准能级(默认1)
    levels: 5         # ordinal 可选: 能级档数
```

## 字段含义

### output
| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | ✅ | 因变量 id（也是 CSV 输出列名） |
| `floor` | 否 | 硬地板：最终 `clip` 保证 `>= floor`（如存款≥0） |
| `cap` | 否 | 硬上限：最终 `clip` 保证 `<= cap`（如投加≤60） |

### fusion
| 字段 | 必需 | 说明 |
|------|------|------|
| `residual_method` | 否 | `xgboost`（默认）或 `none`（纯白盒退化） |
| `xgb_params` | 否 | 传给 `XGBRegressor` 的超参覆盖 |

### inputs[].sign（符号约束 —— 结构冻结，训练永不翻转）
- `positive`：该因素与输出**同向**（系数 `>=0`）
- `negative`：该因素与输出**反向**（系数 `<=0`）
- `free`：方向未知，交数据判定（系数无约束）

> `sign` 同时驱动两件事：① 白盒先验的系数符号域；② XGBoost 残差的 `monotone_constraints`（同向输入上残差单调不降）。

### inputs[].type
- `numeric`：连续；可配 `knee`（ReLU 膝点，膝点前不算贡献）、`range`（扫描范围）。
- `ordinal`：有序档位；`f = relu(x - base)`，可配 `base`/`levels`/`range`。
- `binary`：0/1 开关。

## 设计心法

- **能确定的全冻结**：符号、膝点、地板、上限——这些是"你相信一定对"的。
- **没把握的交出去**：幅度系数（白盒可训）+ 残差（XGBoost 学）。
- **`free` 谨慎用**：只有确实不知道方向时才标 free，否则尽量用 positive/negative 给模型先验。

## JSON 等价

配方也接受 `.json`（同结构）。无 PyYAML 时退回 JSON 解析。
