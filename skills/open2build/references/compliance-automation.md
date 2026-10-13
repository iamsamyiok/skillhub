# 合规自动化参考

## Python 项目一次性配置

```bash
# 自己的 LICENSE（建议 Apache-2.0 或 MIT；choosealicense.com 选模板）

# 第三方声明（每次加依赖后重新生成）
pip install pip-licenses
pip-licenses --format=markdown --output-file=THIRD-PARTY-NOTICES.md

# SBOM（欧盟 CRA 合规基础）
pip install cyclonedx-bom
cyclonedx-py requirements -o sbom.cdx.json

# 漏洞审计（CI 门禁）
pip install pip-audit
pip-audit -r requirements.txt --strict
```

## 其他生态对应

| 生态 | 漏洞审计 | SBOM |
|---|---|---|
| Node | `npm audit` / `osv-scanner` | `@cyclonedx/cyclonedx-npm` |
| Rust | `cargo audit` | `cargo cyclonedx` |
| Go | `govulncheck` | `cyclonedx-gomod` |
| 容器/全语言 | `trivy fs` | `syft` |

## CI 门禁最小配置（GitHub Actions）

```yaml
- name: Security audit
  run: pip install pip-audit && pip-audit --strict
- name: License report
  run: pip install pip-licenses && pip-licenses | tee licenses-report.txt
- name: SBOM
  run: pip install cyclonedx-bom && cyclonedx-py requirements -o sbom.cdx.json
```

## 发布前 checklist

- [ ] THIRD-PARTY-NOTICES.md 与 lockfile 一致
- [ ] 许可证红线零命中
- [ ] 片段复制来源注释齐全（`grep -r "Adapted from" --include="*.py"` 抽查）
- [ ] SBOM 已生成归档
- [ ] 自己的 LICENSE 存在

## 维护节奏

| 节奏 | 动作 |
|---|---|
| 每周 | Renovate/Dependabot 升级 PR 评估 |
| 每季 | 依赖健康度重打分 |
| 每年 | 许可证变更复查（BSL 化浪潮是真实风险） |
| 事件驱动 | 上游安全公告 48h 内评估 |

弃用预案模板：`若 [X] 停维/换许可证：适配器已隔离，切 [备选Y]，预计 N 人日。`
