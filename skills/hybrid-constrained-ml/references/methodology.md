# 方法论：融合建模七步 + 决策树

## 一、何时用本 skill（决策树）

```
有"已知一定对"的领域结构(方向/安全/单调)? ──否──► 直接用纯 XGBoost/GBM 更省事
        │是
有(小数据 | 要保安全硬约束 | 要可解释)? ──否──► 普通 ML 更合适
        │是
想进一步补抓 交互/非线性(纯加性白盒抓不到)? 
   ├─是─► ✅ 本 skill 融合模式(rcml先验 + XGBoost残差)
   └─否─► 纯 rcml(rule-constrained-ml) 已够
```

> 本 skill ≈ rcml 的超集：当 `residual_method: none` 时完全退化为纯 rcml 白盒先验。

## 二、七步工作流（三道人工关卡）

```
S0 依赖自检 ──► S1 界定系统 ──G1──► S2 写配方(明规则+融合声明) ──►
S3 标签数据 ──G2──► S4 hybrid_build 生成模型 ──► S5 训练+自检 ──►
S6 独立审计 ──G3──► S7 交付报告
```

- **S1 界定**：N 个自变量（数值直用；ordinal/binary 标注）+ 1 个因变量（量纲）。
- **S2 写配方**：落 `inputs`(类型/符号/膝点/范围) + `output`(floor/cap) + `fusion`(残差方法)。
  **能确定的全冻结(sign/floor/cap/knee)，没把握的标 free 或交残差。**
- **S3 标签**：采集 `(x, y_true)`；覆盖边界；过合规（PIPL/伦理）。
- **S4 生成**：`python scripts/hybrid_build.py recipe.yaml -o model_x.py`。
- **S5 训练**：`python model_x.py --demo`（自测）或 `--data x.csv --export-weights w.json`。
- **S6 审计**：`python model_x.py --load-weights w.json --audit`（符号域/单调/护栏边界）。
- **S7 交付**：套 `templates/report_template.md`。

### 三道人工关卡（agent 必须停下等确认）

| 关卡 | 通过标准 | 产物签字 |
|------|----------|----------|
| **G1 明规则确认** | 用户确认 recipe 的变量、符号、地板、上限、膝点符合领域真实 | recipe.yaml |
| **G2 数据合规确认** | 用户确认标签来源合法、覆盖边界、无隐私违规 | 数据说明 |
| **G3 交付确认** | 约束审计全通过 + 报告可读规则已审阅 | report.md |

## 三、融合模式速查

| 模式 | 配置 | 何时用 |
|------|------|--------|
| 1 残差加性 | `fusion.residual_method: xgboost` | 主推：补抓交互/非线性，同时保安全 |
| 2 安全壳 | 任意黑盒外 `clip(floor,cap)` | 给已有模型后装硬约束 |
| 退化纯白盒 | `fusion.residual_method: none` | 无 xgboost / 只需可解释先验 |

## 四、依赖

- **必需**：Python 3.10+。
- **建议**：PyYAML（`pip install pyyaml`）；缺则可用 JSON 配方。
- **残差可选**：XGBoost（`pip install xgboost`）。**缺失时自动降级为纯 rcml 白盒先验**，不报错。
- 生成出的模型文件仅用标准库 + 可选 pandas/xgboost，**零重型依赖**。
