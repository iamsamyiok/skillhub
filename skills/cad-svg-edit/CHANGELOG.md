# cad&svg-edit Changelog

## 3.0.0 (2026-10-13)

新增 **A+ CADCRAFT 后端**：接入 [CADCraft](https://github.com/storytold/cadcraft)（storytold，MIT OR Apache-2.0）真实 CAD 引擎，精确工程图能力全面升级；二进制缺失时自动落回原 JS 引擎，v2 全部能力保留。

- `scripts/cadcraft-bridge.mjs`（新增，零依赖 Node）：
  - `doctor`：二进制探测（CADCRAFT_CLI → PATH → 常见目录扫描，CADCRAFT_SCAN=0 可关）+ circle→dxf 冒烟；缺失退出码 2 附安装指引
  - `run <job.json>`：JSON 命令数组驱动绘图（贪心分批 + `--save` 链式会话），`HANDLE`/`HANDLE[n]` 占位符自动解析为已收集 handle；输出 DXF + SVG + PNG 三产物与逐命令 ack
  - `verify <dxf> --expect`：实体计数断言（info counts 对比），输出 pass/missing/extra/untracked，失败退出码 1
  - `query`：按类型/图层/窗口查实体（handle + geometry）
  - `convert`：DXF→SVG/PNG，支持 `--window` 取景
  - `info`：DXF/DWG 摘要（counts/layers/dimStyles/extents）
- SKILL.md：路由表新增 A+ 行与降级铁律；新章节含命令词汇表（绘制/标注/编辑/辅助 ~35 条 JSON 签名）、handle 占位协议、六步工作流、验证协议、读入路由（DXF/DWG → info+convert+编辑）、已知坑（associative array 吸收源实体、圆 offset 同心、Y 向上坐标系差异、有损保存声明）
- `examples/flange-cc.job.json`：法兰盘示例（同心圆 + 8 孔极坐标阵列 + 半径标注 + 文字），几何断言精确通过（孔均布 R100、45° 步进、r=12）
- `test/run-tests.js`：新增 7 项 bridge 测试（降级路径/run/verify 正反/query/convert/坏占位符），二进制缺失时自动 SKIP；13 项全过
- Attribution：CADCraft MIT OR Apache-2.0，bridge 为原创封装

## 2.1.0

（见 git 历史：零硬编码路径、doctor 自检、回归测试）

## 2.0.0

（见 git 历史：cad-creat 与 svg-edit 融合，双路由）
