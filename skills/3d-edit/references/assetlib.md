# assetlib 手册 — SimReady 物体资产库（v1.3+）

2,595 个真实感日常物件 GLB，来自 NVIDIA SimReady Assets（CC BY 4.0），经 `codepawl/simready-glb`
项目的 glb 档转换（网页可用、带物理元数据）。定位：**日常物件检索复用优先，程序化手搓兜底**。
真实感（PBR 材质/真实比例/细节量）手搓追不上，且省 token；查无的物件（长尾如药品、虚构设备）
或需要参数化变体族（一族 20 个仅尺寸不同的零件）时走原程序化路线。

## 何时查库

| 场景 | 做法 |
|---|---|
| S 档主体是日常物（杯/壶/工具箱/医疗器/食品/家具件） | 先 search，命中直接做主体 |
| 数字孪生/厂区里的设备件（灭火器/扳手/监视器/轮椅） | 先 search 命中的配菜件，标准结构件仍走 recipes 注册表 |
| 城市场景配菜（路边的消防栓、店招物件） | search 命中即用；注意 drawCalls 预算（每件 GLB 独立 draw） |
| 建筑地标/地形/水面/车流 | 仍走程序化（库覆盖的是"物件"，宏大城市件不在库里） |
| 库覆盖弱项（庭院户外家具/遮阳伞/躺椅/烧烤架/布艺软装/植被单体） | 两轮换词检索无果后果断转程序化（实测强项：汽修/工业安全/医疗/厨房/办公；别在长尾品类上连环空搜） |

## 检索与下载（Python 3.8+ 标准库，零第三方依赖）

```bash
# 中英文皆可，中文走别名表（最长匹配分词）+ IDF 加权
python3 assetlib/search.py 马克杯 -n 5            # 人看：表格式输出
python3 assetlib/search.py 灭火器 -n 3 --json     # 机器看：JSON 数组（agent 集成用这个）
python3 assetlib/search.py safety helmet --cat 工业与安全
python3 assetlib/search.py apple --url            # 附 HF 在线缩略图链接（人工比对用）

# 下载到 assetlib/cache/glb/（断点跳过；--thumb 同时下缩略图 webp）
python3 assetlib/fetch.py kitchenware_mug_c01 --thumb
# 配菜交付直接下到项目 assets/（fetch 后免手动拷贝）
python3 assetlib/fetch.py furniture_table_coffee_low_a01 --dest /workspace/你的项目/assets
```

检索词习惯：优先口语词（马克杯/手套/温度计/显示屏）；类别浏览用 `--cat`（192 个类别，如
厨房用品/工业与安全/医疗设备/食品饮料/家具）；`rigid_bodies/joints` 字段非零表示带物理元数据
（本 skill 不做物理，仅作真实度参考）。

## 目录字段（catalog.jsonl，每行一个物件）

| 字段 | 用途 |
|---|---|
| `id` / `name` | 稳定 id 与英文名（fetch 用 id） |
| `category` / `zh` | 192 类别中文名 / 物件中文别名列表 |
| `name_tokens` / `tokens` | 检索用（勿手改，search.py 消费） |
| `glb_url` / `thumb_url` | HF 直链（fetch.py 用；运行时加载一律走本地 cache，不直连） |
| `size_mb` / `triangles` | 性能预算：S 档主体选 triangles ≤ 15 万；配菜 ≤ 3 万 |
| `bounds` `[x,y,z]` | 包围盒（米制），归一化前先读它预估比例 |
| `rigid_bodies` / `joints` / `collision_hulls` | SimReady 物理元数据计数（three.js 忽略，仅参考） |
| `license` | 固定 `CC-BY-4.0`，交付页须署名（见文末） |

## 加载配方（关键：meshopt 解码器必须挂）

库内 GLB 的 required 扩展是 `EXT_meshopt_compression` + `KHR_mesh_quantization` +
`EXT_texture_webp`——量化与 WebP 三者原生支持，**meshopt 必须显式挂 decoder，否则 load 直接报错**：

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
```

`KHR_physics_rigid_bodies` 是非必需扩展，GLTFLoader 自动忽略（本 skill 无物理，符合边界）。

## 归一化与落地（S 档铁律：1 单位 = 1 米）

GLB 原生米制，但别信库的绝对尺寸直接上架——按 S 档需求归一到实物目标尺寸并落地：

```js
loader.load('assetlib/cache/glb/kitchenware_mug_c01.glb', gltf => {
  const obj = gltf.scene;
  const b = new THREE.Box3().setFromObject(obj), s = new THREE.Vector3(); b.getSize(s);
  obj.scale.setScalar(TARGET_HEIGHT_M / s.y);      // TARGET 来自用户需求或实物尺寸表
  b.setFromObject(obj);
  obj.position.set(X, -b.min.y, Z);                // min.y 归零落地；X/Z 按布局
  obj.rotation.y = ROT;                            // 朝向
  SCENE.reg('prop_mug', obj);                      // 照常进实体表，后续 P2 可改色/显隐
});
```

同款多件：`obj.clone()` 克隆后各自归一化落位（共享几何与贴图，显存不翻倍）。
加载完成的物件照走三级编辑：P2 实体改 `color`/`visible`，改尺寸/位置公式属 P3。

## 夜景打光与无头验证（GLB 场景实战要点，来自别墅庭院 M 档 5 轮迭代）

**物理光单位量级表**：three r155+ 默认物理光单位，点光 `decay=2` 真实平方衰减——真实 PBR 材质上
1.5~2.2 的强度近乎不可见（程序化 emissive 材质会蒙混过关，GLB 不会，一上 GLB 就现原形）。实测一次到位：

| 灯位 | 强度量级 |
|---|---|
| 室内点光（穿透玻璃界面） | 6 |
| 水下灯 | 9（贴水面下 0.15~0.2，配开口壳） |
| 庭院矮柱灯/串灯 | 2.6~4 |
| 火盆/装饰摇曳光 | 4~6（强度随时间正弦扰动） |

环境同步抬：hemisphere 光 + 微弱 ambient，`toneMappingExposure` 1.1~1.2。

**发光容器必须开口壳**：点光源放进实心 Box（泳池池体/灯箱）= 光完全封死，控制台无任何报错。
像素统计实证：封死时泳池冷光 8 px → 改开口壳（四壁片+池底）后 268 px。凡"里面藏灯"的几何体一律
拆成开口壳再加光。

**无头验证 rAF 早停**：swiftshader + `--virtual-time-budget` 下 rAF 在 GLB 异步加载完成前停帧 →
截图里物件集体消失。兜底：loadProps 全部 settle 后强制 `composer.render()` 补一帧（对交互浏览器
零影响）。多机位验证用 URL hash `#p1~#p6` 直达（模板内置，加载即 snap）。

**统计读数时机**：`renderer.info` 在 `props loaded` 日志之前是陈旧值（实证：7 件在途时读 7,020 tris，
真值 361,536）。核对 drawCalls/tris 一律以 loaded 之后的锚点日志为准。

**drawCalls 估算**：每件 GLB 按 2~4 个 draw call 计入预算（多 primitive/多材质各一 draw；实测 7 件
+100 余）。M 档 120 行预算要为 GLB 配菜留余量或明示超线理由（真机 GPU 简单材质数百 draw 无压力，
swiftshader 才是慢的那个）。

**transmission 玻璃慎选**：`transmission` 材质（玻璃器皿）在无环境贴图的夜景里近黑；夜间场景优先
不透明/釉面物件，或给 `scene.environment` 补微弱 envmap 再选它。

## 单文件交付：base64 内嵌

单 HTML 交付时把 GLB 内嵌（体积 +33%；单件 0.5~3MB 可接受，一页 >3 件建议改相对路径 +
本地 HTTP 打开——与 module 脚本本就要求的 http 服务一致）：

```bash
python3 - <<'PY' > mug_b64.txt
import base64, pathlib
print(base64.b64encode(pathlib.Path('assetlib/cache/glb/kitchenware_mug_c01.glb').read_bytes()).decode())
PY
```

```js
// 外链版与单文件版同一条代码路径（实测 villa-courtyard）：__GLB_B64__ 存在走 parse，否则走 load
const b64 = window.__GLB_B64__ || null;
const jobs = SPECS.map(spec => new Promise(res => {
  const ok = gltf => res({ spec, gltf });
  const bad = err => { console.error('[3d-edit] prop fail', spec.file, String(err)); res(null); };
  if (b64 && b64[spec.file]) {
    try { loader.parse(Uint8Array.from(atob(b64[spec.file]), c => c.charCodeAt(0)).buffer, '', ok, bad); }
    catch (e) { bad(e); }
  } else loader.load(spec.file, ok, undefined, bad);
}));
```

注入方式：构建时把 `<script>window.__GLB_B64__ = {"assets/xx.glb": "…"}</script>` 插在
`<script type="module">` 之前（python 十行脚本，键与 SPECS[].file 一致即可命中）。

## 档位取舍（默认 glb 档，其余按需）

catalog 只登记 `glb/` 档（全精度、meshopt 压缩）。数据集另有 `glb_ktx2/`（贴图 KTX2，体积约
-40%，需再挂 `KTX2Loader` + basis_transcoder，CDN addons 有）、`lods/`（多级细节，大场景用）、
`mobile/` 与 `engine/`（USD）。S 档单件/几件配菜用 glb 档即可，别为省流量引入 KTX2 链路；
确需时 URL 把 `resolve/main/glb/` 换成 `resolve/main/glb_ktx2/` 同名文件。

## 离线与缓存

- 首次 `fetch.py` 需联网（HuggingFace 直链）；之后全程离线（cache/ 已在 skill 目录内，`.gitignore` 忽略不入库）
- 换机器/清缓存后重跑 `fetch.py <id>` 即可；`--force` 强制重下

## 目录再生（库更新时）

`assetlib/raw/` 的三份元数据（metadata/manifest/thumbs_metadata.jsonl，共 3.5MB）体积原因未随 skill
分发。再生：按 `build_catalog.py` 顶部注释的 URL 从 `codepawl/simready-glb` 下载 raw 三件到
`assetlib/raw/`，然后 `python3 assetlib/build_catalog.py` 重建 catalog.jsonl（含 192 类别中文映射与
物件中英别名表，均在 build_catalog.py 内维护，查无的词优先补别名表而不是改打分）。

## 许可与署名（CC BY 4.0，交付必做）

使用库内资产的场景，交付页 HUD 或页脚加一行：

```
3D assets: NVIDIA SimReady Assets (github.com/NVIDIA-Omniverse/simready-assets), CC BY 4.0
```

截图/PNG 交付同样带上（图注或文件说明里）。程序化生成部分无此要求。
