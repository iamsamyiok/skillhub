//! create：从 JSON 规格生成 PDF（借鉴 printpdf 的 Ops 向量 + PdfPage 模式）。
//!
//! 规格示例：
//! ```json
//! {
//!   "title": "报告标题",
//!   "page_size": "a4",
//!   "margin_mm": 18,
//!   "font_size": 11,
//!   "blocks": [
//!     {"type": "heading", "text": "一、概述", "level": 1},
//!     {"type": "paragraph", "text": "正文内容，自动换行。"},
//!     {"type": "list", "items": ["要点一", "要点二"]},
//!     {"type": "table", "header": ["列A", "列B"], "rows": [["1", "2"], ["3", "4"]]},
//!     {"type": "spacer", "height_mm": 8},
//!     {"type": "pagebreak"}
//!   ]
//! }
//! ```
//! 字体：默认内置 Helvetica（仅拉丁）。中文/日文/韩文必须用 --font 指定 TTF
//! （printpdf 保存时自动子集化嵌入）。
use crate::common::*;
use clap::Args;
use printpdf::{
    BuiltinFont, Color, FontId, Line, LinePoint, Mm, Op, PaintMode, ParsedFont, PdfDocument,
    PdfPage, PdfSaveOptions, PdfWarnMsg, Point, Polygon, PolygonRing, PrepFont, Pt, Rgb, TextItem,
    WindingOrder,
};
use lopdf::{Document, Object, StringFormat};
use serde::Deserialize;
use serde::Serialize;

const MM_PER_PT: f64 = 1.0 / 2.834_645_669;

/// 检测字体是否为 CFF 轮廓（OTF/CFF 型 TTC）。
/// printpdf 0.8.2 对所有外部字体硬编码 CIDFontType2/FontFile2（TrueType 型），
/// CFF 轮廓字体嵌入后严格阅读器（如 Acrobat）会报“字体类型与嵌入文件不匹配”；
/// 且 CFF 无 hmtx 宽度表，字符水平步进不可靠（重叠/提取粘连/表格回读错乱）。
/// poppler/PDFium 系阅读器可显示字形但不保证定位。此处提前识别并向用户披露。
fn is_cff_outline(bytes: &[u8]) -> bool {
    let be32 = |b: Option<&[u8]>| -> Option<u32> {
        b.map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    };
    let font_off: usize = match bytes.get(0..4) {
        Some(t) if t == b"ttcf" => {
            // TrueType 集合：12 字节头后是字体偏移数组，取第 0 个
            let n = be32(bytes.get(8..12)).unwrap_or(0) as usize;
            if n == 0 {
                return false;
            }
            be32(bytes.get(12..16)).unwrap_or(0) as usize
        }
        Some(_) => 0,
        None => return false,
    };
    let Some(base) = bytes.get(font_off..) else {
        return false;
    };
    let Some(hdr) = base.get(4..6) else {
        return false;
    };
    let num_tables = u16::from_be_bytes([hdr[0], hdr[1]]) as usize;
    let mut has_cff = false;
    let mut has_glyf = false;
    for i in 0..num_tables {
        match base.get(12 + i * 16..12 + i * 16 + 4) {
            Some(b"CFF ") => has_cff = true,
            Some(b"glyf") => has_glyf = true,
            _ => {}
        }
    }
    has_cff && !has_glyf
}

#[derive(Args)]
pub struct CreateArgs {
    /// JSON 规格文件路径（"-" 读 stdin）
    pub spec: String,
    /// 输出 PDF 路径
    #[arg(short, long)]
    pub output: String,
    /// 自定义正文字体（TTF/OTF，保存时自动子集化嵌入；支持中文）
    #[arg(long)]
    pub font: Option<String>,
    /// 自定义粗体字体（缺省时标题用正文字体描粗模拟，不嵌入第二字体）
    #[arg(long)]
    pub font_bold: Option<String>,
}

// ---------- JSON 规格 ----------

#[derive(Deserialize)]
struct Spec {
    title: Option<String>,
    meta: Option<Meta>,
    #[serde(default = "default_page_size")]
    page_size: PageSizeSpec,
    #[serde(default = "default_margin")]
    margin_mm: f64,
    #[serde(default = "default_font_size")]
    font_size: f64,
    #[serde(default)]
    blocks: Vec<Block>,
}

#[derive(Deserialize, Default)]
struct Meta {
    author: Option<String>,
    subject: Option<String>,
    keywords: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PageSizeSpec {
    Named(String),
    Custom([f64; 2]),
}

fn default_page_size() -> PageSizeSpec {
    PageSizeSpec::Named("a4".into())
}
fn default_margin() -> f64 {
    18.0
}
fn default_font_size() -> f64 {
    11.0
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Block {
    Heading { text: String, #[serde(default = "default_level")] level: u8 },
    Paragraph { text: String },
    List { items: Vec<String> },
    Table { header: Option<Vec<String>>, #[serde(default)] rows: Vec<Vec<String>> },
    Pagebreak,
    Spacer { #[serde(default = "default_spacer")] height_mm: f64 },
}

fn default_level() -> u8 {
    1
}
fn default_spacer() -> f64 {
    6.0
}

#[derive(Serialize)]
struct CreateReport {
    file: String,
    pages: usize,
    bytes: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
}

// ---------- 字体 ----------

enum FontChoice {
    Builtin,
    Ttf { regular: FontId, bold: Option<FontId> },
}

// Adobe Helvetica / Helvetica-Bold AFM 宽度（单位 1/1000 em，ASCII 32..=126）。
// 用于内置字体的精确换行估算（printpdf 不为内置字体暴露宽度 API）。
const HELVETICA_W: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD_W: [u16; 95] = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
    611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
    278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// ---------- 排版引擎 ----------

struct Layout {
    page_w: f64,
    page_h: f64,
    margin: f64,
    base_size: f64,
    font: FontChoice,
    parsed_font: Option<ParsedFont>, // TTF 模式下用于度量
    y: f64,                          // 距页面顶部的 mm 数（自绘坐标系）
    pages: Vec<Vec<Op>>,
    cur: Vec<Op>,
    warnings: Vec<String>,
    cjk_warned: bool,
}

impl Layout {
    fn bottom(&self) -> f64 {
        self.page_h - self.margin
    }

    fn content_w(&self) -> f64 {
        self.page_w - 2.0 * self.margin
    }

    fn new_page(&mut self) {
        let cur = std::mem::take(&mut self.cur);
        if !cur.is_empty() {
            self.pages.push(cur);
        }
        self.y = self.margin;
    }

    /// 确保还有 h mm 空间，否则换页。
    fn ensure(&mut self, h: f64) {
        if self.y + h > self.bottom() + 1e-9 {
            self.new_page();
        }
    }

    fn f(v: f64) -> f32 {
        v as f32
    }

    /// 自绘坐标 mm → PDF 坐标 Point（y 轴翻转）。
    fn pdf_point(&self, x_mm: f64, y_mm: f64) -> Point {
        Point {
            x: Pt(Self::f(x_mm * 2.834_645_669)),
            y: Pt(Self::f((self.page_h - y_mm) * 2.834_645_669)),
        }
    }

    /// 文本宽度（mm）。内置字体查 AFM 表；TTF 走 cmap+advance 精确计算。
    fn measure(&self, text: &str, size_pt: f64, bold: bool) -> f64 {
        let w_pt = match (&self.font, &self.parsed_font) {
            (FontChoice::Ttf { .. }, Some(font)) => {
                let upem = font.font_metrics.units_per_em.max(1) as f64;
                text.chars()
                    .map(|c| {
                        let adv = font
                            .lgi(c as u32)
                            .map(|gid| font.get_horizontal_advance(gid as u16) as f64)
                            .unwrap_or(size_pt * 0.5);
                        adv / upem * size_pt
                    })
                    .sum::<f64>()
            }
            _ => {
                let table = if bold { &HELVETICA_BOLD_W } else { &HELVETICA_W };
                text.chars()
                    .map(|c| {
                        let w = if c.is_ascii() {
                            let idx = (c as u32).saturating_sub(32) as usize;
                            table.get(idx).copied().unwrap_or(556) as f64
                        } else {
                            1000.0 // 非拉丁字符内置字体不支持，按全宽估算占位
                        };
                        w / 1000.0 * size_pt
                    })
                    .sum::<f64>()
            }
        };
        w_pt * MM_PER_PT
    }

    /// 非 ASCII 检测（内置字体模式下 >0x7E 即不可靠：lopdf 0.45 的 WinAnsi
    /// 回退会把非 ASCII 字符按 UTF-8 原样写入，导致乱码）。
    fn has_non_ascii(text: &str) -> bool {
        text.chars().any(|c| c as u32 > 0x7E)
    }

    /// 记录一次非 ASCII 警告（内置字体模式）。
    fn warn_cjk_once(&mut self, text: &str) {
        if self.cjk_warned || !matches!(self.font, FontChoice::Builtin) {
            return;
        }
        if Self::has_non_ascii(text) {
            self.cjk_warned = true;
            self.warnings.push(
                "文本含非拉丁/非 ASCII 字符（如中文，或 é、• 等扩展字符），但未指定 --font：内置字体仅可靠支持 ASCII，这些字符将按 UTF-8 原样写入导致乱码。请用 --font 指定 TTF。".into(),
            );
        }
    }

    fn line_h(&self, size_pt: f64) -> f64 {
        size_pt * 1.32 * MM_PER_PT
    }

    /// 发射一行文本（y 为行顶，自绘坐标 mm）。
    fn emit_line(&mut self, x_mm: f64, text: &str, size_pt: f64, bold: bool) {
        let lh = self.line_h(size_pt);
        self.ensure(lh);
        let baseline = self.y + size_pt * 0.78 * MM_PER_PT;
        let pos = self.pdf_point(x_mm, baseline);
        let mut ops = vec![
            Op::StartTextSection,
            Op::SetLineHeight { lh: Pt(Self::f(lh * 2.834_645_669)) },
            // 文本填充色必须显式设为黑色：PDF 图形状态延续，
            // 表格表头底纹设过灰色后不恢复会导致后续文字变浅灰。
            Op::SetFillColor {
                col: Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)),
            },
        ];
        match &self.font {
            FontChoice::Builtin => {
                let font = if bold { BuiltinFont::HelveticaBold } else { BuiltinFont::Helvetica };
                ops.push(Op::SetFontSizeBuiltinFont { size: Pt(Self::f(size_pt)), font });
                ops.push(Op::SetTextCursor { pos });
                ops.push(Op::WriteTextBuiltinFont {
                    items: vec![TextItem::Text(text.to_string())],
                    font,
                });
            }
            FontChoice::Ttf { regular, bold: bold_id, .. } => {
                let font = if bold { bold_id.as_ref().unwrap_or(regular) } else { regular };
                ops.push(Op::SetFontSize { size: Pt(Self::f(size_pt)), font: font.clone() });
                ops.push(Op::SetTextCursor { pos });
                ops.push(Op::WriteText {
                    items: vec![TextItem::Text(text.to_string())],
                    font: font.clone(),
                });
            }
        }
        ops.push(Op::EndTextSection);
        self.cur.extend(ops);
        self.y += lh;
    }

    /// 贪心换行：Latin 按空格断，CJK 按字断，行首空格丢弃，超长 token 硬拆。
    fn wrap(&self, text: &str, max_mm: f64, size_pt: f64, bold: bool) -> Vec<String> {
        let mut tokens: Vec<String> = Vec::new();
        let mut cur = String::new();
        for c in text.chars() {
            if c.is_whitespace() {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
                tokens.push(" ".to_string());
            } else if c as u32 > 0x2E7F && !c.is_ascii() {
                // CJK 及全角区：逐字可断
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
                tokens.push(c.to_string());
            } else {
                cur.push(c);
            }
        }
        if !cur.is_empty() {
            tokens.push(cur);
        }

        let mut lines: Vec<String> = Vec::new();
        let mut line = String::new();
        let mut line_w = 0.0;
        for tok in tokens {
            let tw = self.measure(&tok, size_pt, bold);
            if tok == " " {
                if line.is_empty() {
                    continue; // 行首空格丢弃
                }
                line.push(' ');
                line_w += tw;
                continue;
            }
            // 容差 1e-9：列宽 = 内容宽 + 2*pad 时 max_mm 与内容测量值
            // 在浮点边界相等，严格大于会因累加误差误拆行（中文表格表头抖动）。
            if line_w + tw > max_mm + 1e-9 && !line.is_empty() {
                lines.push(line.trim_end().to_string());
                line = String::new();
                line_w = 0.0;
            }
            if tw > max_mm {
                // 超长 token 硬拆
                let mut piece = String::new();
                let mut piece_w = 0.0;
                for ch in tok.chars() {
                    let cw = self.measure(&ch.to_string(), size_pt, bold);
                    if piece_w + cw > max_mm + 1e-9 && !piece.is_empty() {
                        lines.push(std::mem::take(&mut piece));
                        piece_w = 0.0;
                    }
                    piece.push(ch);
                    piece_w += cw;
                }
                line = piece;
                line_w = piece_w;
                continue;
            }
            line.push_str(&tok);
            line_w += tw;
        }
        if !line.trim_end().is_empty() {
            lines.push(line.trim_end().to_string());
        }
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    fn draw_line(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, thickness_pt: f64, gray: f32) {
        let p1 = self.pdf_point(x1, y1);
        let p2 = self.pdf_point(x2, y2);
        self.cur.push(Op::SetOutlineThickness { pt: Pt(Self::f(thickness_pt)) });
        self.cur.push(Op::SetOutlineColor {
            col: Color::Rgb(Rgb::new(gray, gray, gray, None)),
        });
        self.cur.push(Op::DrawLine {
            line: Line {
                points: vec![LinePoint { p: p1, bezier: false }, LinePoint { p: p2, bezier: false }],
                is_closed: false,
            },
        });
    }

    fn fill_rect(&mut self, x: f64, y: f64, w: f64, h: f64, gray: f32) {
        let pts = [
            self.pdf_point(x, y),
            self.pdf_point(x + w, y),
            self.pdf_point(x + w, y + h),
            self.pdf_point(x, y + h),
        ];
        self.cur.push(Op::SetFillColor {
            col: Color::Rgb(Rgb::new(gray, gray, gray, None)),
        });
        self.cur.push(Op::DrawPolygon {
            polygon: Polygon {
                rings: vec![PolygonRing {
                    points: pts.map(|p| LinePoint { p, bezier: false }).to_vec(),
                }],
                mode: PaintMode::Fill,
                winding_order: WindingOrder::NonZero,
            },
        });
    }

    // ---------- 块渲染 ----------

    fn render_heading(&mut self, text: &str, level: u8) {
        self.warn_cjk_once(text);
        let size = self.base_size
            * match level {
                0 => 1.0,
                1 => 1.7,
                2 => 1.35,
                _ => 1.15,
            };
        let lh = self.line_h(size);
        let lines = self.wrap(text, self.content_w(), size, true);
        self.ensure(lh * lines.len() as f64);
        self.y += size * 0.5 * MM_PER_PT; // 段前距
        for line in lines {
            self.emit_line(self.margin, &line, size, true);
        }
        self.y += size * 0.3 * MM_PER_PT; // 段后距
    }

    /// 文档标题（spec.title）：首页顶部居中、加粗、大字号。
    /// 与 heading 块的区别：不依赖 blocks 数组，整篇文档仅此一个，
    /// 对齐 reportlab 用户"文档大标题"的使用习惯。
    fn render_title(&mut self, text: &str) {
        self.warn_cjk_once(text);
        let size = self.base_size * 2.1;
        let lh = self.line_h(size);
        let lines = self.wrap(text, self.content_w(), size, true);
        self.ensure(lh * lines.len() as f64 + size * 0.8 * MM_PER_PT);
        for line in lines {
            let x = self.margin + (self.content_w() - self.measure(&line, size, true)).max(0.0) / 2.0;
            self.emit_line(x, &line, size, true);
        }
        self.y += size * 0.8 * MM_PER_PT; // 标题与正文的间距
    }

    fn render_paragraph(&mut self, text: &str) {
        self.warn_cjk_once(text);
        let lines = self.wrap(text, self.content_w(), self.base_size, false);
        for line in lines {
            self.emit_line(self.margin, &line, self.base_size, false);
        }
        self.y += self.base_size * 0.35 * MM_PER_PT;
    }

    fn render_list(&mut self, items: &[String]) {
        // 内置字体（WinAnsi 回退按 UTF-8 原样写）下项目符号 U+2022 会乱码，用 ASCII 连字符
        let builtin = matches!(self.font, FontChoice::Builtin);
        let bullet = if builtin { "- " } else { "\u{2022} " };
        let indent = 5.0;
        for item in items {
            self.warn_cjk_once(item);
            let first_prefix_w = self.measure(bullet, self.base_size, false);
            let avail = self.content_w() - indent - first_prefix_w;
            let lines = self.wrap(item, avail.max(20.0), self.base_size, false);
            for (i, line) in lines.iter().enumerate() {
                if i == 0 {
                    // 首行：项目符号 + 文本（同一行发射）
                    let full = format!("{bullet}{line}");
                    self.emit_line(self.margin, &full, self.base_size, false);
                } else {
                    self.emit_line(self.margin + indent + first_prefix_w, line, self.base_size, false);
                }
            }
            self.y += self.base_size * 0.3 * MM_PER_PT;
        }
        self.y += self.base_size * 0.2 * MM_PER_PT;
    }

    fn render_table(&mut self, header: &Option<Vec<String>>, rows: &[Vec<String>]) {
        let cols = header
            .as_ref()
            .map(|h| h.len())
            .unwrap_or(0)
            .max(rows.iter().map(|r| r.len()).max().unwrap_or(0));
        if cols == 0 {
            return;
        }
        let cell_size = self.base_size * 0.92;
        let pad = 1.6; // 单元格内边距 mm
        let cap = 55.0; // 单列自然宽度上限 mm

        // 列宽：自然宽度（封顶）→ 等比缩放适配内容宽度
        let mut col_w: Vec<f64> = vec![0.0; cols];
        for ci in 0..cols {
            let mut natural: f64 = 0.0;
            if let Some(h) = header {
                if let Some(cell) = h.get(ci) {
                    natural = natural.max(self.measure(cell, cell_size, true));
                }
            }
            for r in rows {
                if let Some(cell) = r.get(ci) {
                    natural = natural.max(self.measure(cell, cell_size, false));
                }
            }
            col_w[ci] = natural.min(cap) + 2.0 * pad;
        }
        let total: f64 = col_w.iter().sum();
        let content_w = self.content_w();
        if total > content_w {
            let scale = content_w / total;
            for w in &mut col_w {
                *w *= scale;
            }
            if col_w.iter().any(|&w| w < 8.0) {
                self.warnings.push("表格过宽，部分列宽已压缩至 8mm 下限，内容可能溢出".into());
                for w in &mut col_w {
                    *w = w.max(8.0);
                }
            }
        }

        let lh = self.line_h(cell_size);
        let x0 = self.margin;
        let table_w: f64 = col_w.iter().sum();

        // 表头（跨页重复）
        let draw_header = |lay: &mut Self| {
            if let Some(h) = header {
                let row_lines: Vec<Vec<String>> = h
                    .iter()
                    .enumerate()
                    .map(|(ci, cell)| {
                        lay.wrap(cell, (col_w[ci] - 2.0 * pad).max(6.0), cell_size, true)
                    })
                    .collect();
                let n = row_lines.iter().map(|l| l.len()).max().unwrap_or(1);
                let row_h = n as f64 * lh + 2.0 * pad;
                lay.ensure(row_h);
                let row_top = lay.y;
                lay.fill_rect(x0, row_top, table_w, row_h, 0.90);
                let mut x = x0;
                for (ci, lines) in row_lines.iter().enumerate() {
                    // 每列都从行顶+内边距起绘：emit_line 会推进 y，
                    // 不重置的话同一行里越靠后的列被画得越低。
                    let saved_y = lay.y;
                    lay.y = row_top + pad;
                    for line in lines {
                        lay.emit_line(x + pad, line, cell_size, true);
                    }
                    lay.y = saved_y;
                    x += col_w[ci];
                }
                lay.y = row_top + row_h;
                lay.draw_grid_row(x0, &col_w, row_top, row_h);
            }
        };

        draw_header(self);

        for (ri, row) in rows.iter().enumerate() {
            let row_lines: Vec<Vec<String>> = (0..cols)
                .map(|ci| {
                    let cell = row.get(ci).map(|s| s.as_str()).unwrap_or("");
                    self.wrap(cell, (col_w[ci] - 2.0 * pad).max(6.0), cell_size, false)
                })
                .collect();
            let n = row_lines.iter().map(|l| l.len()).max().unwrap_or(1);
            let row_h = n as f64 * lh + 2.0 * pad;
            if self.y + row_h > self.bottom() + 1e-9 {
                self.new_page();
                draw_header(self); // 跨页重复表头
            }
            let row_top = self.y;
            let mut x = x0;
            for (ci, lines) in row_lines.iter().enumerate() {
                // 每列都从行顶+内边距起绘（同 draw_header 的修复）
                let saved_y = self.y;
                self.y = row_top + pad;
                for line in lines {
                    self.emit_line(x + pad, line, cell_size, false);
                }
                self.y = saved_y;
                x += col_w[ci];
            }
            self.y = row_top + row_h;
            self.draw_grid_row(x0, &col_w, row_top, row_h);
            let _ = ri;
        }
        self.y += self.base_size * 0.5 * MM_PER_PT; // 表后距
    }

    /// 绘制一行的网格线（外框 + 列分隔）。
    fn draw_grid_row(&mut self, x0: f64, col_w: &[f64], y_top: f64, h: f64) {
        let x1 = x0 + col_w.iter().sum::<f64>();
        self.draw_line(x0, y_top, x1, y_top, 0.4, 0.35); // 顶边
        self.draw_line(x0, y_top + h, x1, y_top + h, 0.4, 0.35); // 底边
        let mut x = x0;
        for w in col_w {
            self.draw_line(x, y_top, x, y_top + h, 0.3, 0.55);
            x += w;
        }
        self.draw_line(x1, y_top, x1, y_top + h, 0.3, 0.55); // 右边
    }
}

// ---------- 入口 ----------

pub fn run(args: CreateArgs) -> CmdResult<()> {
    // 1) 读规格
    let spec_text = if args.spec == "-" {
        use std::io::Read;
        let mut s = String::new();
        std::io::stdin()
            .read_to_string(&mut s)
            .map_err(|e| format!("读取 stdin 失败: {e}"))?;
        s
    } else {
        std::fs::read_to_string(&args.spec)
            .map_err(|e| format!("读取规格 {} 失败: {e}", args.spec))?
    };
    let spec: Spec = serde_json::from_str(&spec_text).map_err(|e| format!("规格 JSON 解析失败: {e}"))?;

    if spec.font_size <= 0.0 {
        return Err("font_size 必须为正数".into());
    }
    let (page_w, page_h) = match &spec.page_size {
        PageSizeSpec::Named(name) => match name.to_lowercase().as_str() {
            "a3" => (297.0, 420.0),
            "a4" => (210.0, 297.0),
            "a5" => (148.0, 210.0),
            "letter" => (215.9, 279.4),
            "legal" => (215.9, 355.6),
            other => return Err(format!("未知页面尺寸 {other:?}（可选 a3/a4/a5/letter/legal 或 [宽,高] mm）")),
        },
        PageSizeSpec::Custom([w, h]) => {
            if *w <= 0.0 || *h <= 0.0 {
                return Err("自定义页面尺寸 [宽,高] 必须为正数（mm）".into());
            }
            (*w, *h)
        }
    };
    if spec.margin_mm <= 0.0 || spec.margin_mm * 2.0 >= page_h.min(page_w) {
        return Err(format!(
            "margin_mm 必须在 (0, {:.1}) 之间",
            page_h.min(page_w) / 2.0
        ));
    }

    // 2) 先建正式文档并写元数据。字体必须注册到最终文档上——
    //    注册到临时文档会导致序列化时 WriteText 找不到 FontId 对应资源而被静默丢弃。
    let title = spec.title.clone().unwrap_or_else(|| "pdfctl create".into());
    let mut doc = PdfDocument::new(&title);
    if let Some(meta) = &spec.meta {
        if let Some(a) = &meta.author {
            doc.metadata.info.author = a.clone();
        }
        if let Some(s) = &meta.subject {
            doc.metadata.info.subject = s.clone();
        }
        if let Some(k) = &meta.keywords {
            doc.metadata.info.keywords = k.clone();
        }
    }

    // 3) 字体（注册到最终文档；保存时 printpdf 自动子集化嵌入）
    let mut font_warnings: Vec<String> = Vec::new();
    let (font, parsed_font) = if let Some(path) = &args.font {
        let bytes = std::fs::read(path).map_err(|e| format!("读取字体 {path} 失败: {e}"))?;
        if is_cff_outline(&bytes) {
            font_warnings.push(format!(
                "字体 {path} 为 CFF 轮廓（OTF）：printpdf 以 TrueType 型嵌入，严格阅读器（如 Acrobat）可能报“字体类型与嵌入文件不匹配”；更关键的是 CFF 无 hmtx 宽度表，字符水平步进不可靠，会导致字符重叠、文本提取粘连、表格回读错乱。poppler/PDFium 系阅读器（Evince/Chrome/Edge）可显示字形但不保证定位。强烈建议换用 TrueType 轮廓 .ttf/.ttc（如 wqy-zenhei.ttc）。"
            ));
        }
        let mut w = Vec::new();
        let font = ParsedFont::from_bytes(&bytes, 0, &mut w)
            .ok_or_else(|| format!("无法解析字体 {path}（需要合法 TTF/OTF）"))?;
        let bold = match &args.font_bold {
            Some(bp) => {
                let bbytes = std::fs::read(bp).map_err(|e| format!("读取粗体 {bp} 失败: {e}"))?;
                Some(
                    ParsedFont::from_bytes(&bbytes, 0, &mut w).ok_or_else(|| {
                        format!("无法解析粗体字体 {bp}（需要合法 TTF/OTF）")
                    })?,
                )
            }
            None => None,
        };
        let regular = doc.add_font(&font);
        let bold_id = bold.as_ref().map(|b| doc.add_font(b));
        (FontChoice::Ttf { regular, bold: bold_id }, Some(font))
    } else {
        (FontChoice::Builtin, None)
    };

    // 3) 排版
    let mut lay = Layout {
        page_w,
        page_h,
        margin: spec.margin_mm,
        base_size: spec.font_size,
        font,
        parsed_font,
        y: spec.margin_mm,
        pages: Vec::new(),
        cur: Vec::new(),
        warnings: Vec::new(),
        cjk_warned: false,
    };
    if spec.blocks.is_empty() {
        lay.warnings.push("规格未包含任何 blocks，将生成空白页".into());
    }
    // 文档标题（spec.title）：渲染为首页居中大标题。此前该字段只传给
    // PdfDocument::new() 作文档名，页面上不可见——实测对比 reportlab 时发现。
    if let Some(title) = &spec.title {
        if !title.trim().is_empty() {
            lay.render_title(title);
        }
    }
    for block in &spec.blocks {
        match block {
            Block::Heading { text, level } => lay.render_heading(text, *level),
            Block::Paragraph { text } => lay.render_paragraph(text),
            Block::List { items } => lay.render_list(items),
            Block::Table { header, rows } => lay.render_table(header, rows),
            Block::Pagebreak => lay.new_page(),
            Block::Spacer { height_mm } => {
                lay.ensure(*height_mm);
                lay.y += height_mm;
            }
        }
    }
    lay.new_page(); // 收尾：把最后一页入队
    if lay.pages.is_empty() {
        lay.pages.push(Vec::new()); // 保证至少一页
    }

    // 4) 生成 PDF（doc 与字体已在上面建好）
    let pages: Vec<PdfPage> = lay
        .pages
        .into_iter()
        .map(|ops| PdfPage::new(Mm(Layout::f(page_w)), Mm(Layout::f(page_h)), ops))
        .collect();
    let n_pages = pages.len();
    doc.with_pages(pages);
    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let bytes = doc.save(&PdfSaveOptions::default(), &mut save_warnings);
    for w in save_warnings {
        // printpdf 会把字体解析等 Info 级消息也放进 warnings，噪音太大，只转发 Warning/Error
        if w.severity != printpdf::PdfParseErrorSeverity::Info {
            font_warnings.push(format!("printpdf: {w:?}"));
        }
    }

    // 5) printpdf 的 Info 字典不符合 PDF 规范（实测对比 reportlab 时发现）：
    //    a) 非 ASCII 文本字符串按 UTF-8 裸字节写入，阅读器按 PDFDocEncoding/
    //       Latin-1 解读成乱码（中文元数据全废）；
    //    b) 创建/修改日期是 epoch 0（D:19700101...）；
    //    c) Creator/Producer 留空。
    //    用 lopdf 重新打开重写 Info（UTF-16BE+BOM + 当前时间），再原子落盘。
    let mut final_doc = Document::load_mem(&bytes)
        .map_err(|e| format!("重新解析生成的 PDF 失败（printpdf 输出异常）: {e}"))?;
    fix_info_dict(&mut final_doc, &spec);
    save_atomic(&mut final_doc, &args.output)?;
    let out_bytes = std::fs::metadata(&args.output).map(|m| m.len()).unwrap_or(bytes.len() as u64);

    let mut warnings = lay.warnings;
    warnings.extend(font_warnings);
    for w in &warnings {
        eprintln!("警告: {w}");
    }
    print_json(&CreateReport {
        file: args.output,
        pages: n_pages,
        bytes: out_bytes as usize,
        warnings,
    });
    Ok(())
}

/// 重写 Info 字典，修正 printpdf 的三处不合规输出（详见 run() 第 5 步注释）：
/// 非 ASCII 字符串改 UTF-16BE+BOM（与 metadata 命令同一编解码器）、日期置当前时间、
/// 补齐 Creator/Producer。
fn fix_info_dict(doc: &mut Document, spec: &Spec) {
    use crate::commands::info::encode_pdf_string;
    let info_id = match ensure_info_dict(doc) {
        Ok(id) => id,
        Err(_) => return,
    };
    let info = match doc
        .get_object_mut(info_id)
        .ok()
        .and_then(|o| o.as_dict_mut().ok())
    {
        Some(d) => d,
        None => return,
    };
    let fields: [(&[u8], Option<String>); 4] = [
        (b"Title", spec.title.clone()),
        (b"Author", spec.meta.as_ref().and_then(|m| m.author.clone())),
        (b"Subject", spec.meta.as_ref().and_then(|m| m.subject.clone())),
        (b"Keywords", spec.meta.as_ref().and_then(|m| {
            // printpdf 的 info.keywords 是 Vec；Info /Keywords 惯例为逗号分隔字符串
            m.keywords.as_ref().filter(|k| !k.is_empty()).map(|k| k.join(", "))
        })),
    ];
    for (key, val) in fields {
        match val {
            Some(v) if !v.is_empty() => {
                info.set(key, Object::String(encode_pdf_string(&v), StringFormat::Literal));
            }
            _ => {
                info.remove(key);
            }
        }
    }
    let now = now_pdf_date();
    info.set(b"Creator", Object::String(encode_pdf_string("pdfctl create"), StringFormat::Literal));
    info.set(
        b"Producer",
        Object::String(encode_pdf_string("pdfctl create (printpdf 0.8.2)"), StringFormat::Literal),
    );
    info.set(b"CreationDate", Object::String(now.clone().into_bytes(), StringFormat::Literal));
    info.set(b"ModDate", Object::String(now.into_bytes(), StringFormat::Literal));
}
