# 寻找与评估开源项目

## 搜索渠道（按命中率排序）

1. **反向搜索**：找实现同类功能的知名项目，读它的依赖清单——
   被成熟项目依赖的库经过了实战筛选
2. **awesome 列表**：`awesome-{领域}`（awesome-rag / awesome-mcp …）
3. **GitHub Topic 过滤**：`topic:rag language:python sort:stars`，
   加 `pushed:>YYYY-MM-DD` 过滤死项目
4. **生态地图**：CNCF Landscape、State of JS/Data、Papers with Code
5. **逆向学习**："X 产品的 Y 功能怎么实现？"→ 查技术博客/开源组件
6. **HN/技术周刊时间线**：早期红利与风向

## 评估记分卡（候选需 ≥ 7/10）

| 维度 | 权重 | 要点 |
|---|---|---|
| 维护活跃度 | 20% | 最近提交<3月；issue 响应；release 节奏 |
| 社区规模 | 15% | 贡献者>5 比 stars 可靠 |
| 许可证 | 15% | 阶段1 结论 |
| 文档质量 | 10% | 30 分钟能跑通 quickstart？ |
| API 稳定性 | 10% | 破坏性变更历史；semver |
| 依赖健康度 | 10% | 传递依赖数量与质量 |
| 抽象契合度 | 10% | 与模块卡片匹配？ |
| 安全历史 | 5% | CVE 历史与响应 |
| 替代品存在 | 5% | 有 2+ 备选 = 议价能力 |

## 快速体检

```bash
python scripts/repo_health.py owner/repo [owner2/repo2 ...]
# 提高速率请设置 GITHUB_TOKEN 环境变量（只读权限即可）

gh repo view OWNER/REPO --json pushedAt,stargazerCount,licenseInfo
gh api "repos/OWNER/REPO/commits?per_page=5" --jq '.[].commit.committer.date'
```

## 危险信号

- 单一维护者 + 半年无动态
- README 只有安装没有使用文档
- issue 区大量未回应的崩溃报告
- 依赖链上存在"僵尸库"
- 名字与知名项目高度相似（typosquatting 投毒）
