# pdf-rust — 架构与扩展指南

纯 Rust PDF 处理生态的起点。目标：逐步替代基于 Python 的 PDF skill，形成「单二进制、零运行时依赖、可交叉编译」的 Rust 全生态。当前定位（v1.2）：**结构操作、内容创作、表单填写、内嵌图片提取、扫描件 OCR 全接管；仅 PDF 光栅化渲染按双轨策略留给原版 skill**，详见 SKILL.md「双轨路由」。

## 架构总览

```
用户/Agent
    │
    ▼
pdfctl (clap CLI)  ──►  commands/*.rs（每命令一个模块，纯函数式 run(args) -> CmdResult<()>）
                              │
                              ▼
                        common.rs（公共内核）
                              │
                              ▼
                        lopdf 0.45（纯 Rust PDF 对象模型）
                        pdfsink-rs 0.2.10（表格提取，借鉴 clark-labs-inc 的 pdfplumber 风格实现）
                        printpdf 0.8.2（PDF 创建，借鉴 ops 向量 + 页面模型）
                        mineru.rs（MinerU 云 API 客户端：ocr 命令专用，双模式自适应）
                              │
                              ▼
                        ureq 2（阻塞式 HTTPS，rustls，不引入 tokio）+ flate2（PNG/zlib）
                        ├─ 直连 mineru.net（免登录 Agent 模式 10MB/20 页；MINERU_TOKEN 标准版 200MB/200 页）
                        └─ 自研最小 zip 读取器（zip crate 2026-10 遭批量 yank，见踩坑记录 16）
```

### 分层职责

| 层 | 文件 | 职责 |
|----|------|------|
| CLI | `src/main.rs` | clap  derive 定义子命令与参数；分发到 `commands::*`；统一错误退出码 |
| 命令 | `src/commands/*.rs` | 单命令逻辑；默认输出 JSON；不触碰公共细节 |
| 内核 | `src/common.rs` | 页范围解析、安全加载/保存、可达性 GC、merge 两遍式重映射、页树扁平化重建、大纲/命名目标清理、PDF 日期、Info 字典、元数据编解码 |
| 库 | lopdf 0.45 + pdfsink-rs 0.2.10 + printpdf 0.8.2 | PDF 对象模型、流编解码、内置文本提取、加密（RC4/AES）、页树遍历；表格识别；文档创建与排版 |

### 关键设计决策（踩坑记录）

1. **两遍式 id 重映射（merge）**：先把源文档全部对象映射到新 id，再统一重写引用。单遍重映射会在「对象 2 引用对象 5，而 5 尚未分配」时漏映射，导致合并后页面渲染成另一文档的内容。此坑在 Spike 阶段发现并修复，`tests/run_tests.py` T2 的三文件合并用例守护回归。
2. **加载后必须检查 `doc.is_encrypted()`**：lopdf 对「加密文档 + 无密码」也返回 Ok（对象保持密文，仅字符串/流被加密）。若不检查，后续操作会产出结构损坏的文件。`common::load_doc` 已内置此守卫。
3. **原子保存**：所有编辑命令先写 `<out>.pdfctl-tmp` 再 rename，避免写一半损坏用户文件。
4. **split 循环用 `base.clone()`**：Document 实现了 Clone；每段从完整文档克隆出发，避免上一段 GC 删除后续段需要的页面对象。
5. **页树扁平化重建**：`rebuild_pages` 把 Pages 根的 Kids 直接指向保留页（多级页树拍平），旧中间节点由 GC 回收；同时修正每页 Parent 指向 Pages 根。
6. **可达性 GC**：从 trailer 递归标记，删除不可达对象。删除/提取/重排后调用，回收被摘页面及其资源。
7. **大纲/命名目标清理**：删页后 Dest/A 指向失效页的书签项会被摘除（支持直接数组与间接引用两种形式），失效命名目标同步清理；解析失败的保守保留。
8. **中文元数据**：PDF 文本字符串用 UTF-16BE + BOM 编码（`common` 的 `encode_pdf_string`）。
9. **中文水印**：Type0 + UniGB-UCS2-H 预定义 CMap + STSong-Light（非嵌入，阅读器字体替换）。无需嵌入 TTF，也无需解析 cmap 表。
10. **create 的字体必须注册到最终保存的文档**（printpdf）：`add_font` 返回的 `FontId` 只在同一 `PdfDocument` 实例内有效。若先注册到临时文档、再另建 `PdfDocument::new()` 排版保存，WriteText 引用的字体资源不存在，文字被静默丢弃（PDF 无字体字典、提取为空，poppler 仅报 "Unknown font tag" 语法警告、渲染正常——极具迷惑性）。正确顺序：建正式 doc → add_font → 排版 → with_pages → save。
11. **PDF 图形状态在文本间延续**（printpdf）：`Op::SetFillColor` 同时影响文本与多边形填充。表格表头画完灰色底纹后若不显式设回黑色，后续所有文字都是浅灰。每个文本段开头显式 `SetFillColor` 黑色。
12. **create 表格同行多列共享推进中的 y**：排版引擎的 y 是单游标，同行第 N 列若沿用游标会比第 1 列低 N-1 行。每列渲染前快照 `row_top`、用后恢复，行高统一以 `row_top + row_h` 推进。
13. **lopdf 0.45 WinAnsi 回退坑**：`encode_text(SimpleEncoding(b"WinAnsiEncoding"), text)` 对非 ASCII 字符（U+2022、é、中文）按 **UTF-8 原样字节**写入，内置字体下必然乱码（提取出 "â€¢"）。内置字体模式的项目符号降级为 ASCII `"- "`；非 ASCII 文本统一在 stderr 警告并引导 `--font` 指定 TTF。
14. **CFF 轮廓字体无 hmtx 宽度表**（printpdf）：printpdf 0.8.2 底层用 ttf_parser 取字符 advance，而 CFF 轮廓（Noto CJK 系列 OTF/TTC）没有 hmtx 表，宽度读不到 → 字符水平步进塌陷：渲染重叠、pypdf 提取粘连无空格、`table` 按 x 聚类回读残缺（实测 `<0014>` 单 cid、列归属全错）。TrueType 轮廓字体（wqy-zenhei.ttc）有 hmtx，一切正常。`is_cff_outline`（扫表目录：有 `CFF ` 且无 `glyf`）提前识别并在 stderr 披露；T18/T20 双字体对照守护回归。
15. **wrap 浮点边界误拆行**：表格列宽 = 内容自然宽 + 2×padding，`max_mm` 与内容测量值在浮点层面相等，`line_w + tw > max_mm` 的严格大于因累加误差（~1e-16）误触发，中文表头"评级"被拆两行（内容流可见同 x 两个文本段）。修复：两处比较加 `+ 1e-9` 容差。T20 中文闭环表头断言守护回归。
16. **zip crate 供应链事件（2026-10）**：zip 2.x 在 crates.io 遭批量 yank（135 个发布版仅 9.0.3 幸存，且发布仅 3 天即被下架），`cargo add zip` 无法解析任何可用版本。处置：弃用三方 crate，自研最小 zip 读取器（EOCD 尾部 64KB 窗口反搜 → 中央目录 → local header → flate2 解压，支持 stored/deflate 两种 method），单测用「stored+deflate 混合包 + 拒绝垃圾数据」守护。
17. **MinerU 云 API 双模式设计**：免登录 Agent 轻量版（`/api/v1/agent/parse/file`，10MB/20 页/每日 1 万页）与标准版（`/api/v4/file-urls/batch`，Bearer token，200MB/200 页/每日 2000 页）接口形态完全不同，不能简单做参数切换。实现：`MinerU::parse_file` 按有无 token 分流两套独立流程（不同的上传/轮询/结果获取端点），额度上限差异（页数/体积）也按模式分别预检。
18. **ureq 2.x 的 `send_json` 需要 json feature**：默认 feature 集不含 JSON 辅助方法。处置：显式 `send_string(&serde_json::to_string(&body).unwrap())` + `Content-Type: application/json` 头，feature 依赖最小化（Cargo.toml 已注释记录）。
19. **PDF 文本字符串的 UTF-16BE 编码**：往 AcroForm 写中文表单值时直接写 UTF-8 裸字节，pypdf 回读变成 `'é«Ÿ'` 乱码。PDF 规范（7.9.2）：文本字符串以 BOM 开头判别编码，`FE FF` = UTF-16BE，否则 PDFDocEncoding/Latin-1。修复：`encode_pdf_text` 非 ASCII 一律 `FE FF + UTF-16BE`；读取侧 `pdf_str` 按 BOM 判别。复选框 /V 可能是 Name（如 `/Off`）而非 String，读取需分类型处理。
20. **reportlab 4.4.9 的 choice() 有 bug**：`canvas.choice()`/`listbox()` 存在 `lbextras` UnboundLocalError（4.4.9 未修）。测试固件改用 reportlab textfield + pypdf 后处理注入 `/Ch` 字段的方式构造下拉框。生产代码若要做下拉框编辑，同理绕开 reportlab 的高级控件封装。
21. **ASCII85 解码的 `<` 陷阱**：`<`（值 60）是合法数据字符，仅数据**开头**的 `<~` 是定界符；`z` 仅组边界表示 4 个 0；尾组 n 字符输出 n-1 字节（与 Python `base64.a85decode` 对齐）。images 提取 reportlab 真实流时，第 4 个字符就是 `<`，误当定界符 break 导致 "incomplete deflate stream"。修复后固化为真实流回归单测。
22. **edition 2024 match ergonomics**：`for (name, &id) in &index` 混合解构模式报 E0308（默认绑定模式 + 显式 `&` 引用冲突）。改默认绑定 `(name, id)` + 体内 `*id`。
23. **printpdf 的 Info 字典不符合 PDF 规范**（2026-10 对敲 reportlab 实测发现，v1.2 修复）：a) 非 ASCII 文本字符串按 UTF-8 裸字节写入，阅读器按 PDFDocEncoding/Latin-1 解读成乱码——`create` 的中文 /Title /Author /Subject 全部乱码（pypdf 回读 `'å¤§äº­...'` 实证）；b) 创建/修改日期是 epoch 0（`D:19700101000000`）；c) Creator/Producer 留空；d) `spec.title` 只传给 `PdfDocument::new()` 作内部文档名，**页面上从不渲染**。修复：printpdf 保存后用 lopdf 重新打开重写 Info（UTF-16BE+BOM 复用 `info::encode_pdf_string`、`now_pdf_date()`、补齐 Creator/Producer），标题在排版前渲染为居中大标题。T24 守护回归。

## 如何新增一个命令（生态扩展入口）

以新增 `pdfctl compress`（示例：清理未引用对象 + 对象流压缩）为例：

1. **新建 `src/commands/compress.rs`**：
   ```rust
   //! compress：清理未引用对象并尽量压缩。
   use crate::common::*;
   use clap::Args;
   use serde::Serialize;

   #[derive(Args)]
   pub struct CompressArgs {
       pub file: String,
       #[arg(short, long)]
       pub output: Option<String>,
       #[arg(long)]
       pub password: Option<String>,
   }

   #[derive(Serialize)]
   struct CompressReport { file: String, saved_bytes: u64 }

   pub fn run(args: CompressArgs) -> CmdResult<()> {
       let mut doc = load_doc(&args.file, args.password.as_deref())?;
       gc(&mut doc);
       // 可选：doc.save_modern(&mut buf) 使用对象流 + xref 流
       let out = args.output.clone().unwrap_or_else(|| args.file.clone());
       save_atomic(&mut doc, &out)?;
       print_json(&CompressReport { file: out, saved_bytes: 0 });
       Ok(())
   }
   ```
2. **`src/commands/mod.rs`** 加 `pub mod compress;`
3. **`src/main.rs`** 的 `Command` 枚举加分支：
   ```rust
   /// 清理未引用对象
   Compress(commands::compress::CompressArgs),
   ```
   和分发臂 `Command::Compress(a) => commands::compress::run(a),`
4. **测试**：在 `tests/run_tests.py` 加下一个编号的 `@t("T20")` 用例，用 pypdf 交叉验证。
5. **文档**：SKILL.md 命令速查表加一行。

约定：
- `run(args) -> CmdResult<()>`，错误返回人类可读中文消息（main 统一打印 `error:` 并退 1）。
- 默认 JSON 输出（`print_json`），需要人类可读模式时再加 flag。
- 页参数统一走 `parse_page_ranges`；加载统一走 `load_doc`；保存统一走 `save_atomic`。
- 改公共内核时补一条「关键设计决策」。

## 能力路线图

**已完成（v1.2）**：

| 方向 | 实现 | 测试 |
|------|------|------|
| 表格提取 | `table` 命令，pdfsink-rs lines/lines_strict/text 策略 + 加密链路 | T16：与 pdfplumber 逐字节一致 |
| PDF 创建 | `create` 命令，printpdf JSON 规格 + TTF 中文嵌入 + create→table 自闭环 | T17–T20：CFF/TrueType 双字体对照 |
| 扫描件 OCR | `ocr` 命令，MinerU 云 API 客户端（mineru.rs）双模式自适应 + 本地裁页 + 额度预检 | T21：真实链路（网络不可达自动 SKIP） |
| 内嵌图片提取 | `images` 命令，过滤器链解码（A85/Hex/Flate）+ DCT 直出 + 手写 PNG 封装 | T22：JPEG/PNG 魔数 + PIL 解码验证 |
| 表单填写 | `forms` 命令，AcroForm 字段树遍历 + UTF-16BE 中文读写 + NeedAppearances | T23：pypdf 回读四字段（含中文） |

**后续候选（v2+）**：

| 方向 | 思路 | 风险 |
|------|------|------|
| 对象流压缩（`save_modern`） | lopdf 0.45 内置 `save_modern` | 低 |
| 线性化（fast web view） | 写 Linearized 字典 + 重排对象 | 中 |
| 大纲增删改 | 已有 `add_bookmark`/`delete_outlines` 可封装 | 低 |
| PDF 渲染预览 | 需引入 C 依赖（pdfium）或纯 Rust 渲染器（hayro），破坏「零系统依赖」原则 | 高，需单独决策 |
| OCR 本地模型 | MinerU 模型本地化部署（onnxruntime 或 pure-Rust 推理），摆脱网络依赖 | 高 |

## 测试策略

- **交叉验证优先**：Rust 侧输出用 pypdf 读回断言（页数/顺序/内容/旋转/加密/元数据），避免自证清白。
- **固件即代码**：`tests/make_fixtures.py` 用 reportlab 生成多页/中文/书签/表格/加密表格五类固件。
- **选跑**：`python3 tests/run_tests.py T2 T9` 只跑指定用例。
- 当前 **154/154 通过**（T1–T24）。
