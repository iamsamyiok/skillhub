# cad&svg-edit Changelog

## 4.0.0 (2026-10-19)

新增 **A++. SOLIDCRAFT 3D 后端**（借鉴 SolidCraft 项目研究，tangency-labs/solidcraft v0.16.2 实测接入）：

- `scripts/solidcraft-bridge.mjs`（新增，零依赖 Node）：
  - `doctor`：二进制探测（SOLIDCRAFT_CLI → PATH → solidcraft-*/bin 目录扫描）+ box 40×30×20→volume 24000 解析式冒烟
  - `run <job.json> [--verbose]`：JSON 命令数组驱动参数化建模（草图/拉伸/旋转/圆角/抽壳/阵列/镜像），save.{step,stl,obj,3mf,igs} 多格式导出（file.export），save.design 落 .solidcraft 设计容器，export.png 无头渲染复核图；输出 measure{volume,area,faces,edges,vertices} 与 result.json
  - `eval <part.step|stl>`：外部 STEP/STL 反测体积/面积/拓扑计数（STEP AP203/214/242 导入）
  - `verify`：解析式体积/面积相对容差断言（tol 1e-3，网格测量偏差 1e-6 量级）+ faces/edges/vertices/bodies 精确断言
  - `snapshot` / `commands`：无头渲染（--view iso|top|front...）与 404+ 命令目录查询
- **cadcraft-bridge.mjs 四项增强**（抄 SolidCraft MCP failed.index/checkpoint/measure 语义）：
  - 失败自动二分探针定位首条失败命令：`ERR 命令 #N (命令名) 失败`；最近成功态保留为 `<name>.checkpoint.dxf`
  - `verify --geometry` 几何断言：circle（圆心+半径命中）、polar_pattern（环上 count 个圆心 + 步进角断言，法兰孔位专用）、distance（两点距）
  - `run --quiet`：省略逐命令 acks（大图省 token），保留 handles 与产物清单
  - query 几何 center 兼容 {x,y,z} 与 [x,y] 两种返回形态
- **语料库回归** `test/corpus/` + `scripts/run-corpus.mjs`（抄 SolidCraft design file corpus 模式）：job.json + .expected.json 成对锁死计数/几何/体积 oracle；条目：flange-cc（2D 计数+几何）、flange3d（π·10·(150²−40²−8·12²) 解析式）、bracket3d（L 型解析式）；引擎二进制缺失自动 SKIP
- SKILL.md：路由表 A++ 行（3D 实体/STEP/STL/参数化重建；STEP/STL 读入校核）、A++ 全章节（环境检测/job 格式/命令词汇表/六步闭环/验证协议/已知坑 5 条——extrude 必须显式 profiles point 否则内圆不成为孔、file.save 只存设计容器、网格化测量容差、坐标系差异）、语料库纪律章节
- test/run-tests.js：+6 项（sc-bridge 降级/verify 正反/端到端/解析式断言 + 语料库回归），19 项全过

## 3.0.1 (2026-10-15)
## 3.0.1 (2026-10-15)

已知坑增补（来自"云顶华庭"标准层平面图实战，105 命令 0 错误、verify 一次修正通过）：

- 坑 6：verify 期望表的类型映射——`rectang` 产出 Polyline（按 Line 断言必 fail）、`copy`/`array`/`offset` 逐条增实体；首次 fail 先 `query --type` 审计实际分布再修期望，勿急改 job（实证：预估 Line 40 实际 53、Polyline 32 = rectang 13 + offset 2，修正期望后 pass）
- 坑 7：文字标注碰撞——多 text 图纸 PNG 复核专查包围盒重叠，标注点选图元间空白带（实证：UNIT-A 标签压 BED 标注，调 at 坐标重跑即愈）
- 坑 5 扩充：图内标注直接用英文/拼音最稳（SHX 不读 CJK），中文放交付说明

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
