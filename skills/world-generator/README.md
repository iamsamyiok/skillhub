# world-generator

通用参数化 3D 世界生成器 —— AI 负责语义规划，程序负责几何求解。从一份 JSON 场景计划出发，一键生成可在浏览器直接打开的单文件 `world.html`（内嵌 Three.js，零外部依赖），并支持渐进细化、局部补丁与可视化交互编辑闭环。

## 核心理念

| 层 | 职责 |
|---|---|
| AI（Agent） | 语义规划：总图、分区、资产选择、参数范围、细化与补丁指令 |
| 程序（引擎） | 几何求解：坐标采样、约束满足、碰撞、高程、确定性打包 |

- **完全确定性**：同一种子 + 同一计划 → 字节级一致的输出
- **纯原语资产**：全部资产由 Three.js 基础几何参数化生成，无外部模型/纹理
- **单文件交付**：`world.html` 自包含（three + 后处理 addons + 查看器全部内嵌）

## 快速开始

```bash
# 安装依赖
npm install

# 生成一个场景（写入 scenes/villa/solved-instances.json + world.html）
node engine/index.mjs --scene scenes/villa

# 渐进细化（锚定 zone，如在泳池边加躺椅）
node engine/index.mjs --scene scenes/villa --refine refine-1.json

# 局部补丁（move / reparam / delete / add，可改 time_of_day）
node engine/index.mjs --scene scenes/villa --patch patch-1.json

# 浏览器打开
open scenes/villa/world.html
```

## 交互编辑闭环

```bash
# 启动编辑桥服务（静态托管 + POST /edit-request）
node engine/edit-server.mjs --port 8770 --root .
```

打开 `http://localhost:8770/scenes/villa/world.html#edit`：

1. 左键点选对象（可多选，再点取消，Esc 清空）
2. 底部展开输入框，写明改进意图
3. 提交 → 落盘 `scenes/villa/edit-requests/ed-NNN.json`
4. Agent 读取请求，转为 `--patch` 操作并重建
5. 页面每 2s 轮询 world.html，自动刷新看到结果

无后端静态托管时自动降级：请求 JSON 复制到剪贴板，粘贴给 Agent 即可。

编辑闭环 e2e 回归：`node engine/test-edit-flow.mjs`（需先启动 edit-server）。

## 查看器功能

- 鸟瞰/街景/环绕预设，默认整体鸟瞰机位
- 时间系统（0-24h，太阳方位/色温、天空、雾、暮光下限保护）
- ACES tone mapping + UnrealBloom 后处理
- 单张统一晶格地形：noise 基底 + flat 平台 1.4m 高度/颜色过渡带，无拼接缝
- GLB 一键导出；`#debug` 显示分区边界；`#edit` 启用编辑模式

## 质量管线

```
plan(JSON) → schema 校验 → masterplan lint（窄缝/平台高差/禁放区覆盖）
  → 参数展开 → 约束求解(600 attempts, 确定性 RNG) → 资产契约校验
  → 打包 world.html → visual-check(无头像素统计) / screenshot
```

- `plan-lint` 四规则：`seam_narrow_gap` / `platform_below_base` / `platform_step` / `missing_np_cover`
- `visual-check` 阈值：中心亮度 15-230、唯一色 ≥20、主体覆盖 ≥25%、0 控制台错误
- 回归场景：villa（总图+refine+patch）、campus（四阶段全链路）、forest（530 实例压测）、demo、bicycle

## 目录结构

见 [SKILL.md](./SKILL.md) 文件清单一节。完整 Agent 工作流（阶段 0-8）与踩坑速查表也在 SKILL.md。

## 依赖

- Node.js ≥ 18
- 运行时：`three`（打包期内嵌，产物无依赖）
- 开发校验：`playwright`（visual-check / screenshot / e2e）

## License

MIT
