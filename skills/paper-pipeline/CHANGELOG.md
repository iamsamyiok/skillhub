# paper-pipeline Changelog

## 1.0.0 (2026-10-12)

首个版本：证据驱动的学术写作流水线，融合 Open Academic Paper Gen（证据先行、三层核验）与 Academic Research Skills（苏格拉底成题、评审团）的公开设计，代码为原创实现。

- `scripts/paperkit.py`：零第三方依赖引擎（Python 3.9+ stdlib）
  - `search`：OpenAlex / Crossref / arXiv / Semantic Scholar 四源真实检索，NFKD 归一去重，引用数+新近度+相关度混合评分，`author+year+titleword` 引用 key 自动分配（同名冲突加 a/b 后缀，停用词首词跳过）
  - `verify`：三层引用核验——Check1 key 解析（代码）、Check2 Crossref 元数据（网络）、Check3 原文证据定位（pdftotext/pypdf 分页抽取 + 相似度定位 + 页码锚点），另附未引用数字/专名句提示；`--offline` 跳过网络层
  - `export`：cited-only 参考文献（BibTeX / RIS / Markdown），幽灵 key 明示跳过
  - `fulltext`：OA PDF 抓取与 `.paperkit/` 分页文本缓存
  - `doctor`：四源连通性 + PDF 解析能力自检
- `SKILL.md`：模式路由（quick / lit-review / full / revision / verify-only）→ 九阶段流水线（对齐→检索→筛选→证据表→创新性诊断→大纲→逐段写作→评审团→三层核验+完整性门禁）；评审团含主编、领域审稿人、方法审稿人、魔鬼代言人；交付前 7 项完整性自述
- `test/run-tests.py`：12 项离线测试（key 规则、幻觉标记、cited-only 导出、RIS/BibTeX 结构、冲突后缀），全部通过
- 沙箱实网验证：真实检索建池、含真/假 key 的草稿核验（幻觉 key 正确标记、证据定位返回页码/摘要锚点）、三种样式导出
- Attribution：引擎设计融合自 OAPG (AGPL-3.0) 与 ARS (CC BY-NC 4.0) 公开设计，限非商业用途
