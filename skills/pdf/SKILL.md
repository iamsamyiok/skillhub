---
name: pdf-rust
description: ⚡极速 Rust 版 PDF 工具（性能比官方 Python 版快 1.5x~399x，8/8 基准全胜）。纯 Rust PDF 编辑工具集（pdfctl）。当用户需要处理 PDF 时使用：合并、拆分、提取页、删除页、重排、旋转、读取信息、元数据读写、加密/解密（RC4/AES）、文本提取、表格提取、结构校验、添加水印、从 JSON 规格创建 PDF、OCR 扫描件解析（MinerU 云 API）、提取内嵌图片、AcroForm 表单填写。触发词包括 "PDF"、"合并 PDF"、"拆分 PDF"、"PDF 加密"、"PDF 解密"、"提取 PDF 页"、"PDF 水印"、"PDF 表格"、"提取表格"、"创建 PDF"、"生成 PDF"、"OCR"、"扫描件"、"识别 PDF 文字"、"提取图片"、"填表"、"表单"、"pdfctl"、"性能强"、"极速"。本 skill 不依赖 Python/poppler，单二进制即开即用；OCR 经 MinerU 云 API（文件上传 mineru.net，stderr 有提示）；仅 PDF→图片渲染不在能力范围内（见「双轨路由」）。
version: "1.2.1"
allowed-tools: Read, Write, Bash
---

# pdf-rust — Rust PDF 编辑工具集

基于 [lopdf](https://crates.io/crates/lopdf) 0.45 的纯 Rust 命令行工具 `pdfctl`，**零 Python 依赖、零系统库依赖**，单二进制分发。

> **⚡ 性能强（已实测，非营销话术）**：与官方 Python 版 `pdf` skill（pypdf / pdfplumber / reportlab）做**同固件、同口径、双侧实测**，8 项性能基准 **8/8 全胜**，加速比 **1.5x ~ 399x**。Rust 单二进制无解释器冷启动，进程启动即满速。实测对照（100 页英文 + 50 页中文固件，3 次取中位数）：

| 任务 | pdfctl (Rust) | Python 原版 | 加速 |
|------|--------------:|------------:|:----:|
| 文本提取（100 页英文） | **17 ms** | 6829 ms | **399x** |
| 水印 | **4 ms** | 271 ms | **62x** |
| 合并（150 页） | **5 ms** | 160 ms | **33x** |
| 元数据写入（中文） | **3 ms** | 141 ms | **45x** |
| 结构组合（旋转+删+提取+重排） | **13 ms** | 198 ms | **15x** |
| 加解密往返 | **40 ms** | 213 ms | **5.4x** |
| 拆分逐页（→100 文件） | **41 ms** | 164 ms | **4.0x** |
| 中文文本提取（50 页） | **17 ms** | 1277 ms | **76x** |
| PDF→图片渲染 | ❌ 不支持 | ✅ | 原版独占（双轨路由） |

> 质量同样占优或持平：表格提取与 pdfplumber **逐格一致**、表单填写**完全平手**、内嵌图片**像素级零差异**、中文 OCR **仅本工具可用**（tesseract 缺 chi_sim 且无法联网补齐）。完整数据见仓库根 `pdf-rust-v1.2-对比评估报告.md`（154/154 项测试通过）。

## 二进制位置

优先使用随包预编译二进制（按平台选择）：

| 平台 | 路径 |
|------|------|
| Linux x86_64 | `<skill-directory>/bin/pdfctl-linux-x86_64`（随包预编译，154/154 测试通过） |
| Windows x86_64 | 随包源码本机构建：`cd <skill-directory> && ./build.sh --windows` |

> Windows 二进制未能在打包环境交叉编译（沙箱无法访问 rust-lang.org CDN 且无 mingw 链接器）。
> Windows 本机构建只需 Rust 工具链（https://rustup.rs）+ MSYS2 的 `pacman -S mingw-w64-x86-64-gcc`，
> 或改用 MSVC：`rustup target add x86_64-pc-windows-msvc`（需 VS Build Tools）后 `cargo build --release`。
> 构建产物即 `pdfctl.exe`，命令与参数完全一致。

调用时把对应路径作为 `pdfctl` 使用，例如：

```bash
PDFCTL="<skill-directory>/bin/pdfctl-linux-x86_64"
"$PDFCTL" info input.pdf
```

## 通用约定

- **所有命令默认输出 JSON**（`text` 命令默认输出纯文本，加 `--json` 输出结构化报告）。
- **页范围语法**（1-based）：`all`、`1-3,5`、`3-end`、单页 `2`。
- **输出文件**：`-o/--output` 缺省 = 原地覆盖输入（先写临时文件再原子替换，防写一半损坏）。
- **加密文档**：任何命令加 `--password <密码>`（用户密码或所有者密码均可；空密码可打开时可省略）。
- **退出码**：`0` 成功；`1` 运行错误（stderr 有 `error:` 开头的可读信息）；`2` 参数错误；`3` validate 发现问题。
- 处理失败时**不要把半成品文件交给用户**——先读 stderr 的错误信息，向用户报告原因（如密码错误、页码越界）。

## 命令速查

| 命令 | 用途 | 关键参数 |
|------|------|---------|
| `info` | 页数/版本/页面尺寸/元数据/加密状态/书签数/linearized | `--password` |
| `merge` | 合并多个 PDF，保持输入顺序 | `-o out.pdf a.pdf b.pdf`；`--no-outline` 丢弃书签 |
| `split` | 拆分：`--each` 逐页 / `--ranges "1-3,5"` 按段 | `-o 目录`、`--prefix 前缀` |
| `extract` | 提取指定页为**单个**新 PDF | `-o out.pdf --pages "2-3,5"` |
| `delete` | 删除指定页（至少保留 1 页） | `--pages "2,4"` |
| `reorder` | 重排（须覆盖全部页，禁重复） | 位置参数如 `5,4,3,2,1` |
| `rotate` | 旋转（可叠加，支持负角） | `-p 90`、`--pages 1-3` |
| `metadata get` | 读 Info 元数据（含自定义字段） | |
| `metadata set` | 写元数据；空串=删该字段；`--clear` 清空；`--now` 更新 ModDate | `--title/--author/--subject/--keywords/--creator/--producer` |
| `encrypt` | 加密：`rc4-40`/`rc4-128`/`aes-128`/`aes-256`（默认 aes-256） | `--user-pw`/`--owner-pw`/`--method`/`--no-print`/`--no-copy` 等 |
| `decrypt` | 解密为明文 | `--password` |
| `text` | 提取文本（默认纯文本到 stdout） | `--json`、`-o out.txt`、`--pages`、`--limit-mb 64` |
| `validate` | 结构校验，输出问题列表 | 发现问题退出码 3 |
| `watermark` | 中央斜向半透明水印，**支持中文** | `-t "文字"`、`--angle 45`、`--opacity 0.15`、`--size 48`、`--color "r,g,b"` |
| `table` | 提取表格为结构化数据（lines/text 两策略） | `--strategy lines\|text`、`--format json\|csv\|markdown`、`--pages`、`-o`、`--password` |
| `create` | 从 JSON 规格生成 PDF（标题/段落/列表/表格/分页） | `spec.json -o out.pdf`、`--font ttf路径`（中文必填）、`--font-bold ttf路径`；规格内含 `page_size`/`margin_mm`/`font_size`/`meta` |
| `ocr` | MinerU 云端 OCR/文档解析（扫描件、复杂表格、公式） | `--pages`、`--language ch`、`--format markdown\|text\|json`、`--token`（或 `MINERU_TOKEN`）、`--is-ocr`、`--timeout` |
| `images` | 提取内嵌图片（DCT 直出 jpg，Flate 封装 png） | `--pages`、`-o 目录`、`--min-size 16`、`--password` |
| `forms` | AcroForm 表单：`list` 字段清单 / `set` 填写 | `--field "字段名=值"`（可重复）、`-o`、`--password` |

## 典型用法

```bash
# 看结构
pdfctl info report.pdf

# 合并（顺序即参数顺序）
pdfctl merge -o combined.pdf cover.pdf body.pdf appendix.pdf

# 拆出每页
pdfctl split big.pdf -o pages/ --each

# 只要 3-7 页另存
pdfctl extract big.pdf -o section.pdf --pages 3-7

# 加密后发给别人（对方用 u123 打开）
pdfctl encrypt report.pdf -o report_enc.pdf --user-pw u123 --owner-pw keep-secret --method aes-256

# 去掉打开密码
pdfctl decrypt report_enc.pdf -o report_plain.pdf --password u123

# 提取全文（中文 PDF 亦可，依赖字体 ToUnicode/预定义 CMap）
pdfctl text paper.pdf -o paper.txt

# 盖水印
pdfctl watermark draft.pdf -o marked.pdf -t "内部资料" --opacity 0.12

# 提取表格（水务报表/招标文件场景）：有线表格用 lines，无边框表格用 text
pdfctl table report.pdf --strategy lines --format markdown -o tables.md
pdfctl table report.pdf --strategy text --format csv -o tables.csv --pages 2-3

# 从 JSON 规格创建 PDF（拉丁文走内置字体；中文必须 --font 指定 TTF/TTC）
pdfctl create spec.json -o report.pdf
pdfctl create spec.json -o 报告.pdf --font /usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc

# OCR 扫描件/图片型 PDF（调用 MinerU 云 API，文件上传 mineru.net，stderr 有提示；
# 设置 MINERU_TOKEN 环境变量或用 --token 走标准版，200MB/200 页/2000 页每日）
pdfctl ocr scan.pdf -o scan.md
pdfctl ocr scan.pdf -o scan.md --pages 1-5 --format json
pdfctl ocr scan.pdf -o scan.md --token sk-xxxx --timeout 180   # 单次覆盖 token

# 提取内嵌图片
pdfctl images report.pdf -o imgs/
pdfctl images report.pdf -o imgs/ --pages 3 --min-size 10000

# 填写表单（先 list 看字段全名，再 set；复选框传 on）
pdfctl forms list form.pdf
pdfctl forms set form.pdf --field "单位名称=A 石化" --field "signed=on" -o filled.pdf
```

## 能力边界（诚实声明）

| 能力 | 状态 |
|------|------|
| 页树操作（增删改序/合并/拆分/旋转） | ✅ 核心能力，pypdf 交叉验证 |
| 加解密（RC4-40/128、AES-128/256） | ✅ lopdf 原生，pypdf 互验 |
| Info 元数据读写（中文 UTF-16BE） | ✅ |
| 文本提取 | ✅ lopdf 内置提取器；**依赖 PDF 自带 ToUnicode 或预定义 CMap**，无映射的 CID 字体（极少见）该页提取失败并明确报告 |
| 水印 | ✅ Type0/UniGB-UCS2-H 非嵌入方案；极端阅读器若不支持字体替换可能不显示 |
| 表格提取 | ✅ pdfsink-rs（pdfplumber 风格四策略，lines 与 pdfplumber 一致）；合并单元格/斜线表头退化为多格，如实反映 |
| PDF 创建 | ✅ printpdf JSON 规格驱动；内置字体仅 ASCII，中文需 `--font` TTF；CFF 轮廓 OTF 有兼容性警告 |
| 表单（AcroForm） | ✅ `forms list/set`：字段树遍历、UTF-16BE 中文读写、NeedAppearances；**不自绘 appearance stream**，视觉呈现依赖阅读器重绘 |
| OCR | ✅ MinerU 云 API（`ocr`）：双模式自适应，扫描件/表格/公式结构化输出；**文件上传 mineru.net**，stderr 每次提示；JPX/CCITT/JBIG2 压缩的图片型扫描件依赖 MinerU 云端解码 |
| 提取内嵌图片 | ✅ DCTDecode 直出 jpg / FlateDecode 封装 png；ASCII85/Hex 过滤器链已支持；JPX/CCITT/LZW 与 CMYK/Indexed 色彩空间在报告中如实标注 skipped |
| PDF → 图片渲染 | ❌ 不支持（需渲染引擎/C 依赖，按双轨策略留原版） |
| PDF/A、PDF/UA 合规转换 | ❌ 不支持 |

## 双轨路由（pdf-rust vs 原版 pdf skill）

两个 skill 并存、明确分工。**本 skill 负责结构、内容创作与 OCR；原版 pdf skill 仅保留渲染类重依赖任务**：

| 任务 | 走哪边 | 理由 |
|------|--------|------|
| 合并/拆分/增删/旋转/元数据/加解密/水印/文本提取 | **pdf-rust** | 零依赖单二进制，确定性输出，149 项测试全过 |
| 表格提取（水务报表、招标文件、数据表） | **pdf-rust** `table` | lines/text 双策略，text 策略与 pdfplumber 逐字节一致 |
| 从结构化内容创建 PDF | **pdf-rust** `create` | JSON 规格驱动，支持中文 TTF 嵌入，可被 `table` 回读 |
| OCR 扫描件 / 复杂表格公式解析 | **pdf-rust** `ocr` | MinerU 云 API，免登录每日 1 万页/IP；文件上传 mineru.net（见专项说明） |
| 提取内嵌图片 | **pdf-rust** `images` | DCT/Flate/A85 链路全覆盖，无重编码损耗 |
| AcroForm 表单填写 | **pdf-rust** `forms` | list/set 全覆盖，中文 UTF-16BE 编码，pypdf 回读验证 |
| PDF→图片渲染（转 PNG 预览） | 原版 pdf skill | 需渲染引擎（pypdfium2/pdfium C 依赖），破坏零依赖原则； MinerU 云端已覆盖“给模型看”的渲染需求 |

> 关键生产任务（投标文件、报奖材料）首次使用时建议双轨交叉验证：pdf-rust 产出 + pypdf 读回检查，稳定后单轨。

## ocr 命令专项说明（MinerU 云 API）

- **双模式自适应**：配置 `MINERU_TOKEN`（或 `--token`）走**标准版 vlm**（每日 2000 页，200MB/200 页，表格/公式/跨页合并全支持）；无 Token 走**免登录轻量版**（每日 1 万页/IP，10MB/20 页，禁表格公式识别）。
- **本地裁页**：`--pages` 非全文档时先本地裁出子 PDF 再上传（毫秒级、省额度）。
- **合规提示**：每次执行 stderr 都会提示"文件将上传至 mineru.net"。**涉密文件（投标/财务测算）请评估后使用**；不能外传的场景请改用原版 pdf skill 的本地 tesseract 链路。
- **输出**：`--format markdown`（默认，结构化 Markdown 含表格/公式）/ `text`（去标记纯文本）/ `json`（含 mode/uploaded_bytes/extra_files 报告）。
- **额度与排队**：免登录版 IP 限流（429 即稍后重试）；大文件自动排队，`--timeout` 控制轮询总时长（默认 300s）。
- **失败兜底**：超限/超页/网络失败均有明确中文错误；OCR 未触发返回空内容时报告会提示加 `--is-ocr` 重试。

## table 命令专项说明

- **策略选择**：`lines`（默认）靠表格线定位，适合 reportlab/Word 导出的有线表格；`text` 靠文字对齐聚类，适合无边框报表。两者都检不出时先 `pdfctl text` 看该页文本结构。
- **输出**：`--format json`（默认，含每表 `shape` 行列数）/ `csv`（每个表一段，逗号分隔，标准转义）/ `markdown`（表格转 Markdown 表格）。
- **加密文档**：先自动解密到输出目录旁的临时文件再提取，完成后**自动删除临时文件**；任一步失败同样清理，不会残留明文。行为与 pypdf 解密结果一致。
- **识别局限**：单元格内多行文字会以换行形式保留在同一单元格；斜线表头、跨行跨列合并单元格会退化为多格输出（如实反映，不猜测合并关系）。

## create 命令专项说明

- **JSON 规格**：`{title, meta:{author,subject,keywords}, page_size:"a4"|[w,h]mm, margin_mm:18, font_size:11, blocks:[...]}`；块类型 `heading`（level 1-3）/ `paragraph` / `list` / `table`（header+rows）/ `pagebreak` / `spacer`。
- **文档标题**：`title` 会渲染为首页顶部**居中加粗大标题**（字号 = font_size×2.1），同时写入 Info /Title（UTF-16BE 规范编码，中文不乱码）。标题后自动留距再接 blocks 内容。
- **中文字体**：内置字体仅可靠支持 ASCII。**文本含中文时必须 `--font` 指定 TTF/TTC**（如 NotoSansCJK-Regular.ttc），否则 stderr 明确警告并可能乱码；`--font-bold` 可另指定粗体（缺省用正文字体描粗模拟）。**优先选 TrueType 轮廓字体**（如 wqy-zenhei.ttc）：CFF 轮廓字体（Noto CJK 系列）无 hmtx 宽度表，字符水平步进不可靠，会导致字符重叠、文本提取粘连、表格回读错乱——stderr 会发出警告，此时换 TrueType 即可。
- **表格排版**：列宽按内容自适应（自然宽度封顶后等比缩放，下限 8mm），窄列超宽时 stderr 警告；表格跨页自动重复表头。
- **自闭环**：create 生成的表格可被 `pdfctl table` 原样提取（测试 T19 验证），适合"规格→PDF→数据回读"工作流。

## 处理加密文档的注意事项

- lopdf 对「加密文档 + 未提供密码」的 `Document::load` 也会返回 Ok（对象保持密文）。**pdfctl 已在加载后强制检查 trailer /Encrypt 并拒绝操作**，不会产出损坏文件。
- 加密源做 delete/merge/extract 等操作：加 `--password`，输出为**明文** PDF（这是合理默认；如仍需加密，对输出再跑 `encrypt`）。
- `--owner-pw` 缺省为空意味着「空密码可按所有者身份打开」——这是 PDF 规范行为，与 pypdf 一致。

## 构建（二进制缺失或换平台时）

```bash
cd <skill-directory>
./build.sh              # 当前平台（Linux/macOS）
./build.sh --windows    # 交叉编译 Windows（需 mingw-w64；或装 MSVC 工具链后改 target 为 x86_64-pc-windows-msvc）
./build.sh --all        # 两个平台
```

## 自检

```bash
python3 tests/run_tests.py    # 154 项交叉验证（需 pypdf + reportlab + pdftoppm）
```

## 目录结构

```
pdf-rust/
├── SKILL.md                 # 本文件（agent 指令）
├── README.md                # 架构说明与扩展指南（如何新增命令）
├── Cargo.toml               # Rust 项目（锁定 lopdf 0.45 / pdfsink-rs 0.2.10 / printpdf 0.8.2）
├── Cargo.lock               # 依赖版本锁定（可复现构建）
├── build.sh                 # 一键构建（当前平台/Windows/全部）
├── bin/                     # 预编译二进制（Linux x86_64；Windows 见「二进制位置」）
├── src/
│   ├── main.rs              # CLI 定义与分发
│   ├── common.rs            # 页范围解析/加载/GC/merge 重映射/页树重建/大纲清理
│   └── commands/            # 每命令一个模块
└── tests/
    ├── make_fixtures.py     # 测试固件生成（多页/中文/书签/表格/加密）
    ├── run_tests.py         # 交叉验证测试套件（154 项）
    └── benchmark.py         # 性能基准（与原版 pdf skill 对比）
```
