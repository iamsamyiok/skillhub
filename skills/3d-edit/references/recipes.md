# 3D 场景配方库（recipes）

按需 grep 本文件的 `##` 标题取用。所有配方零外链素材、可复现（种子随机）。

## 种子随机与噪声（万物的地基）

```js
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// 值噪声：hash(坐标)，同坐标恒定 → 换 seed 换世界，演示可复现
function vnoise(x,y){const s=Math.sin(x*127.1+y*311.7+SEED*0.001)*43758.5453;return s-Math.floor(s)}
// fBm：2~4 倍频叠加得到"有细节的"噪声；倍频>5 收益递减且变糊
```
规则：**任何随机都必须走 rand()/noise()，禁止 Math.random()**——否则自检循环两轮画面不同，无法对比修改效果。

## 山地/滨水地形高度场

- 地形 = `PlaneGeometry(宽,深,128,128)`，顶点 y 赋 `fbm(x*0.004, z*0.004)*高差`，`computeVertexNormals()`。
- 建筑落地前先采样地形高：`h = terrainHeight(x,z)`，盒子底部压到 h，否则"悬空楼"（最常见穿帮）。
- 等高城市+山城混合：`finalH = plainH*(1-mountainMask) + mountainH*mountainMask`，mask 用远离市中心的径向函数。
- 真实数据：DEM( GeoTIFF )本地难解，改用网格化高程表双线性插值喂给 terrainHeight 即可（用户可提供水库/厂区实测标高）。

## Instancing（宏大 = draw call 恒定）

- 同类物体 > 50 个必须 `InstancedMesh`；千级 → 个位数 draw call。
- 单位盒先 `geo.translate(0,0.5,0)` 把支点移脚底，再 `makeScale(w,h,d).setPosition(x,y,z)`——顺序错了物体会陷地/悬浮。
- 每实例色差用 `setColorAt`（材质 color 必须设 0xffffff 白底，否则乘色变暗）。
- 需要不同几何（塔+冠+裙楼）：做 2~3 个 InstancedMesh 分组，不要合并成大杂烩。

## 程序化素材（Canvas/DataTexture 代替贴图文件）

- 窗光贴图：canvas 画随机亮灭小方格 → `CanvasTexture` 作 `emissiveMap`；`magFilter=NearestFilter` 保持锐利。
- 屋顶/路面：canvas 画 2~4px 噪点条纹，重复 `wrapS/T = RepeatWrapping`。
- 关键认知：**远景细节全靠贴图，不靠几何**。盒子楼+窗光贴图 视觉完胜 精细建模楼。

## 水面

- 低配：`MeshStandardMaterial({roughness:0.15, metalness:0.85, color:深蓝})` + 自发光微光，夜景足够。
- 顶点动画：PlaneGeometry 细分 96+，每帧位移 `y = sin(x*0.08+t)*a + sin(z*0.05-t*0.7)*b`（两三个波叠加，别真用 FFT）。
- 反射倒影（夜景假反射，性价比之王）：把城市 `scale.y=-1` 复制一份压到水面下 + 半透明，水面对象 alpha 0.85。真 `Reflector` 开销翻倍，慎用。

## 天空与云

- 天空 = 大球 `BackSide` + 渐变 shader（模板已含）。日景换三色渐变：天顶蓝→地平白。
- 太阳：`Sprite` + canvas 径向渐变贴图，别用真实球体。
- 云：2 个大 Plane 交叉叠 `透明 canvas 噪声团`，缓慢 uv 偏移。日景神器，10 行代码。

## 夜景氛围三板斧（精美感 80% 在此）

1. **冷暖对比**：环境/建筑体 = 冷蓝，窗光/车灯/街灯 = 暖橙。全图禁止单一色相。
2. **雾**：`FogExp2(0x071018, 0.001~0.002)` 制造远近层次；雾色取天空地平线色，否则地平线出现"脏边"。
3. **Bloom**：`UnrealBloomPass(strength 0.6~1.0, radius 0.5~0.7, threshold 0.5~0.65)`。
   threshold 过高→灯不发光；过低→全糊。自发光物体用 `MeshBasicMaterial` 或高 `emissiveIntensity`。
- 附加：`renderer.toneMapping = ACESFilmicToneMapping` 一行免费电影感。

## 车流 / 人流 / 生活感

- 车 = 发光小盒 `MeshBasicMaterial`，沿主干道 x 匀速移动，越界折返；一条路 30~40 辆即可。
- 街灯 = 稀疏的暖色 `Points` 或极小发光盒，密度宁低勿高（高了像蚊香）。
- 生活感来自"少量运动物"：画面里只要有一个东西在动，整城就活了。

## 路网与路灯（地面要素对，实测 3 轮收敛）

- **路网走贴图不走几何**：次街网格+主干道沥青+中心虚线+边线全烧进一张 2048px CanvasTexture，
  一块透明平面承载（y 高于地面、低于水面顶 → 河上自动被盖住形成"路到河口为止"）；
  路口天然无 z-fighting，draw call +1。贴图必须 `SRGBColorSpace`，`anisotropy` 拉满（斜视角标线不糊）。
- **退线铁律**：建筑半宽 ≤ cell/2 − 路面半宽 − 人行道(0.3~0.5)。加路前先收窄楼体 footprint 公式，
  否则楼压路、路灯穿楼（pick 落点反查能立刻抓到：命中的是 bld-* 就说明要素被楼吞了）。
- **路灯**：灯杆（Cylinder `translate(0,0.5,0)` 支点脚底）+ 灯头（Sphere，MeshBasicMaterial
  color=暖窗色×lampGlow）两个 InstancedMesh；主干道两侧对称布点，间距 2×cell 宁疏勿密；
  布点判定用 nearRiver（isRiver + cell×0.8 水缘余量），否则灯站进水里。
- **车/路/灯共享同一 majorCoords()**：车流只跑主干道才可信；过河口 `c.visible=!nearRiver(...)`
  隐没，避免"灯在水上飘"。注意：主循环逐帧写 visible 的组，实体要注册**组对象**而非 lazy children。
- 参数化：roadPeriod/lampSpacing 走 rebuild，lampGlow 走 hot（apply 改灯头材质色）。

## 地标建模（塔/桥/立交/车站）

- 组合基本体：电视塔 = 细圆柱+锥+环；桥 = 长盒+等距塔柱实例+`CatmullRomCurve3` 拉索管( TubeGeometry )；轻轨穿楼 = 轨道管 + 一列车(5 节盒实例沿 curve `getPointAt(t)` 跑)。
- 地标必须出现在至少 2 个预设机位的画面里，否则"宏大"无锚点。
- 命名地标（如"李子坝站"）：HUD 文字标注 + `Sprite` 标签挂到建筑上即可，不要试图建真模型。

## 交互与运镜（"可交互"的便宜实现）

- `OrbitControls` + `enableDamping`；`maxPolarAngle = PI*0.495` 防钻地。
- 数字键预设机位：`{p:[相机位], t:[注视点]}` 数组 + 1.6s easeOutCubic lerp（模板已含）。
- 电影感自动巡城：`CatmullRomCurve3` 闭环 + 相机沿曲线跑 + `lookAt` 城市中心；与 OrbitControls 互斥（按 0 键切换手动/自动）。
- 点击拾取：`Raycaster` 实例化拾取 `instanceId` → HUD 显示"X 区 X 栋 高 XXm"，数字孪生演示的标配。

## HUD / UI（精致感最后 10%）

- 固定一角等宽字体：标题、操作提示、图例；`text-shadow:0 1px 4px #000` 保证可读。
- 数据面板（风速/水位/区划统计）放右上，与左下操作提示对角平衡。
- 禁止用 3D 文字做标题（丑且贵），HTML overlay 永远更好。

## 性能预算（宏大 与 流畅 的分界线）

| 指标 | 安全线 | 超标手段 |
|---|---|---|
| drawCalls | < 150 | 继续合批/实例化 |
| 三角形 | < 300 万 | 降细分、盒体代替曲线 |
| 实例数 | < 10 万 | 分块+视锥剔除(默认自带) |
| Bloom | 1 个 pass | 多 pass 直接砍 |
| pixelRatio | ≤ 2 | `Math.min(devicePixelRatio,2)` |

分级预算（v1.1：按交付档位取线，超线先实测归因再动手）：

| 档位 | 典型场景 | drawCalls | 三角形 | 实例数 | 超线常见根因 |
|---|---|---|---|---|---|
| S 单物体 | 产品/装置效果图 | < 60 | < 30 万 | < 2 千 | 圆角/管分段过密、近共面薄层 |
| M 局部 | 广场/厂区/一段河街 | < 120 | < 150 万 | < 3 万 | 重复独立 Mesh 未合批、路灯逐个建 |
| L 全城 | 城市/数字孪生全域 | < 150 | < 300 万 | < 10 万 | 车流独立 Mesh（见下方归因案例） |

实测归因案例：修复 `renderer.info` 统计（autoReset=false + 每帧 reset）后发现 L 档全城模板实际 drawCalls=306，其中 280 来自**车流独立 Mesh**（模板遗留），其余仅 ~26。车流是画面里最小、最多的物体，是换 InstancedMesh 收益最高的一个（每辆车的逐帧位移改写成 `setMatrixAt`，view 更新后 `instanceMatrix.needsUpdate=true`）；预算紧时优先动它。

交付物工程化（v1.1）：模板内置 **GLB 导出**（G 键 / `CITY.saveGlb()`，二进制 glTF，可进 Blender/Unity/在线查看器；capture 服务在跑则同时落盘 .glb）与**测量模式**（M 键 / `CITY.measure()`，动态比例尺 + 场地尺寸，`perUnit` 定标 1 单位=几米）。导出 GLB 前隐藏标注层与 gizmo——GLB 会把画面里的一切原样带出。

## 真实场景改造清单（水库/厂区/管线数字孪生）

1. 用实测坐标画控制点 → `CatmullRomCurve3` 生成管线/库岸线。
2. 水面 = 真实库水位高程（喂进 y 值），雾/机位按真实尺度调 `fog` 与 `camera.far`。
3. 大坝 = 梯形截面 ExtrudeGeometry；电站厂房 = 盒组 + 屋顶斜面；设备 = 圆柱实例。
4. 汇报场景优先日景+青蓝调色（雨后可读性高），夜景只用于大屏氛围页。

## 标准件参数注册表（S/M 档复用件，v1.1）

五个高频工程件的可复用配方：**参数表 + 建模要点 + 实体注册约定**。全部零外链素材；
参数进 MANIFEST（hot 优先），实体走 `SCENE.reg` 稳定 id —— 改参数 → rebuild 即重建，
`CITY.find('跨度')` 这类口语天然命中。注册约定统一：id = `<件名>-<序号>.<部件>`，实例场景 reg 带 `{index}`。

### 桥（跨江/跨谷地标）
| 参数 | 含义 | 常用范围 |
|---|---|---|
| span | 跨度 | 80~600 |
| width | 桥面宽 | 8~40 |
| deckH | 桥面标高 | 10~80 |
| towerN | 主塔数 | 0(梁桥)/1/2 |
| cableN | 每侧拉索数 | 8~24 |

要点：桥面=长盒；塔=渐收双柱+横梁；拉索=`CatmullRomCurve3`→`TubeGeometry`(rad 0.15~0.4) 从塔顶到桥面等距锚点。
实体：`bridge.deck` / `bridge.tower-i` / `bridge.cables`(组)。地标必须在 ≥2 个预设机位出现。

### 门式起重机（厂区/码头）
| 参数 | 含义 | 常用范围 |
|---|---|---|
| span | 轨距(跨) | 20~60 |
| liftH | 起升高度 | 10~30 |
| trolleyN | 小车数 | 1~2 |

要点：双侧刚性腿(梯形截面盒)+顶部箱梁+行走轮(实例)；吊钩组做 y 往复动画——便宜的生活感物件。
实体：`crane.gantry` / `crane.trolley` / `crane.hook`。

### 冷却塔（电厂/化工）
| 参数 | 含义 | 常用范围 |
|---|---|---|
| baseR | 底半径 | 12~45 |
| topR | 顶半径 | 0.55~0.7×baseR |
| height | 塔高 | 40~120 |
| waistY | 收腰高度 | 0.72~0.8×height |

要点：双曲线收腰剖面(12~16 点)→`LatheGeometry`；顶部蒸汽=半透明 Sprite 缓慢升腾。
实体：`tower-i.body` / `tower-i.steam`。阵列 ≥3 座才有厂区感。

### 变压器（变电站/厂区配电）
| 参数 | 含义 | 常用范围 |
|---|---|---|
| tank | 油箱 L×W×H | 3~8 × 2~4 × 2.5~5 |
| radiatorN | 散热片组 | 4~10 |
| bushingN | 套管(每相) | 3~6 |

要点：油枕圆柱横置顶 + 散热片(薄盒实例阵列) + 瓷套管(小圆柱串) + 底座槽钢；铭牌用 CanvasTexture 画拉丝+阴刻字。
实体：`transformer-i.tank` / `.radiator` / `.bushing`。

### 大坝（水库数字孪生）
| 参数 | 含义 | 常用范围 |
|---|---|---|
| crestLength | 坝顶长 | 100~900 |
| damH | 坝高 | 20~120 |
| crestWidth | 顶宽 | 5~15 |
| slope | 下游坡比 | 1:0.7~1:0.8 |
| spillwayN | 溢洪道 | 0~3 |

要点：梯形截面 `ExtrudeGeometry` 沿坝轴线；上游面竖直、下游面放坡；坝顶公路+防浪墙(薄盒)；
溢洪道=闸墩(实例)+开敞溢流面。水位面用真实库水位高程（见"真实场景改造清单"第 2 条）。
实体：`dam.body` / `dam.crest-road` / `dam.spillway-i`。


## 产品/装置效果图（小物体、写实向，如控制箱/设备一键通）

来自"溢洪预警盒子"交底书效果图任务的沉淀（比例 1 单位 = 100mm，实体尺寸建模）：

1. **棚拍质感三件套**：`RoomEnvironment + PMREMGenerator` 做不锈钢反射（`metalness .95 / roughness .3 / envMapIntensity 1.3`）+ 三点布光（key 1.4~1.7 带 PCFSoft 阴影、rim 冷色轮廓光、fill 补光）+ ACES。背景用浅色墙地（日景汇报风），别用夜景。
2. **分层共面是重灾区**：屏幕 UI 层、玻璃反光层、bezel、铭牌是近共面薄层，层间距必须 ≥0.01×场景尺度（本例 0.015~0.03），且**斜视角截图复查**——正视干净不代表没 z-fighting（摩尔纹只在非正对角度出现）。玻璃层参数宜保守：`opacity≤0.1, clearcoat≤0.6, envMapIntensity≤0.4`，否则屏幕被反射条纹毁掉。
3. **大面积单色板必须贴内容**：铭牌/面板用 CanvasTexture 画拉丝纹+阴刻文字（先画阴影字再画主体字），边框描线。空白亮板在照片里读作"未完成的白块"。
4. **软管/线缆走线配方**（三轮才收敛的坑）：CatmullRomCurve3 控制点 = 垂直段（等 x/z，逐点降 y）+ 末端**长缓弧**过渡到水平段；水平段至少 3 个单位长度并把末端引向墙根/被主体遮挡的方向（短水平段=拐杖钩）；贴地段的管心 y 抬高一个管半径（否则陷入地面）；TubeGeometry 分段数给足（≥40）。
5. **金属面白斑归因**：白斑是环境/主光的镜面反射进相机，**不是 bloom 的锅**。修法按序：挪主光位置改变反射方向 → 该材质 roughness↑/envMapIntensity↓ → 最后才微调 bloom。bloom 只负责屏幕自发光辉光（深色背景 threshold 0.95, strength 0.26~0.35；**近白棚拍背景不适用，见第 10 条**）。
6. **专利标注 Sprite**：`depthTest:false` 会穿透模型——标签坐标必须放在**模型剪影之外**（x 超出盒体半宽 ≥0.7），数字编号+名称一体画在 canvas 贴 Sprite；标注模式本身要截图目检一轮。
7. **场景状态同步进 syncState()**：背面机位隐藏墙体/遮挡物之类的逻辑抽成函数，rAF 循环与 `CITY.snap()` 都调用；只写在循环里会让 agent 截图穿墙。
8. **交付截图集**：hero（三分之四）+ 正视 + 侧视 + 背面 + 俯视 + 屏幕特写 + 标注模式，共 6~7 张，
   命名 `<场景名>-<序号>-<机位名>.png`（与 checklist「交付标准」一致，别再用 `final_*.png`），直接可插入文档。
9. **外凸件根部落在主体投影之外**（小推车扶手实测）：立管/斜撑的根部 x 若落在台面半宽之内，低机位会看见"钢管从台的体积里穿出来"。修法是把根部移到板外（`-deckL/2 - 0.018`）或走板底受力层（`y = deckTop - t - 0.03`），改完必须重拍贴地机位复核——正视/俯视看不出来。
10. **近白棚拍背景会越过 bloom threshold** → 整图乳白过曝、接触阴影被冲淡。修法是 threshold 抬到 ≥1.05 并把背景/地面的 `envMapIntensity` 压到 0.35 左右，不要靠降 exposure（会把金属高光一起杀掉）。
11. **"开关一整层"的参数用 `effect:'rebuild'`，别用 `hot`**：hot 的 `apply` 直接改对象，绕过实体的 props 记录，`CITY.entProp(id,'visible')` 和人工编辑面板会显示过期状态（表现为"参数已 true 但面板说关着"）。rebuild 会按 CONFIG 重新注册，记录与对象一致。
12. **隐藏 group 实体注册必须显式带 `props:{visible:...}`**：kit 的 `reg()` 会把 object/group 实体按 DEFV 复位成 `visible:true`，否则标注层永远关不掉。
13. **P3 源码级改几何会让旧机位失效**：扶手后倾加大后，"握把特写"预设糊成端盖微距。凡动了 `@*-rule@` 里的尺寸公式，`@presets@` 表要跟着重算并全机位重拍一轮。
14. **要能单件改色就每件事物 clone 材质**：P2 的 `--entity wheel-fl:color=…` 只对独立材质有效，四个轮共用一个材质时改一个=改全部。
15. **主体外形尺寸 D 用 Box3 实测，不要手算**（页面里 `SCENE.three` 只给实例、不给 THREE 命名空间，`Box3` 要现 import）：
    ```js
    const T = await import('three'), t = window.SCENE.three;
    t.scene.children.map(c => { const b = new T.Box3().setFromObject(c);
      return { n: c.name || c.type, size: b.getSize(new T.Vector3()).toArray().map(v => +v.toFixed(3)) }; });
    ```
    取**模型 Group** 那一行（本例 `0.913 × 0.972 × 0.511`），别取天空球/地面盘（±48、±5.2 会把 D 撑爆），
    也别取标注 Group（它比模型大一圈）。D = 最长边 = 0.972 → 相机距离带 1.36~1.75，hero 实测 1.65。

