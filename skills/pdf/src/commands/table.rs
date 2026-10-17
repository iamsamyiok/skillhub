//! table：表格提取（借鉴 pdfsink-rs，pdfplumber 风格四策略）。
//!
//! 策略说明（与 pdfplumber 对应）：
//! - lines       默认。利用表格线（边框/单元格线）定位，适合有线表格
//! - lines_strict 同 lines，但要求线条完整贯穿，严格模式漏检少、误检也少
//! - text        纯文本对齐定位，适合无框线表格
//!
//! 加密文档：先用 lopdf 解密到临时文件再提取（pdfsink 不支持加密输入）。
use crate::common::*;
use clap::Args;
use pdfsink_rs::{PdfDocument, TableSettings, TableStrategy};
use serde::Serialize;
use std::str::FromStr;

#[derive(Args)]
pub struct TableArgs {
    /// PDF 文件路径
    pub file: String,
    /// 页范围，默认 all
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 表格定位策略：lines | lines_strict | text，默认 lines
    #[arg(long, default_value = "lines")]
    pub strategy: String,
    /// 输出格式：json | csv | markdown，默认 json
    #[arg(long, default_value = "json")]
    pub format: String,
    /// 输出文件（缺省打印到 stdout）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct TableOut {
    rows: Vec<Vec<Option<String>>>,
    shape: [usize; 2],
}

#[derive(Serialize)]
struct PageTables {
    page: usize,
    tables: Vec<TableOut>,
}

#[derive(Serialize)]
struct TableReport {
    file: String,
    strategy: String,
    pages: Vec<PageTables>,
}

pub fn run(args: TableArgs) -> CmdResult<()> {
    // 1) 先用 lopdf 加载：统一校验文件可读性，并在加密时解密到临时文件
    //    （pdfsink 的解析器不处理 /Encrypt，必须先脱密）。
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let temp_path = if doc.was_encrypted() {
        let tmp = format!("{}.pdfctl-table-tmp.pdf", args.file);
        save_atomic(&mut doc, &tmp)?;
        Some(tmp)
    } else {
        None
    };
    let actual = temp_path.as_deref().unwrap_or(&args.file);

    // 2) pdfsink 打开并逐页提取（任何失败路径都要清理临时文件）
    let result = extract_all(actual, &args);
    if let Some(tmp) = &temp_path {
        let _ = std::fs::remove_file(tmp);
    }
    let report = result?;

    // 3) 输出
    match args.format.as_str() {
        "csv" => {
            let mut buf = String::new();
            for pt in &report.pages {
                for (i, t) in pt.tables.iter().enumerate() {
                    if report.pages.len() > 1 || pt.tables.len() > 1 {
                        buf.push_str(&format!("# 第 {} 页 表格 {}\n", pt.page, i + 1));
                    }
                    for row in &t.rows {
                        let cells: Vec<String> =
                            row.iter().map(|c| csv_escape(c.as_deref().unwrap_or(""))).collect();
                        buf.push_str(&cells.join(","));
                        buf.push('\n');
                    }
                    buf.push('\n');
                }
            }
            write_out(&args.output, &buf)?;
        }
        "markdown" => {
            let mut buf = String::new();
            for pt in &report.pages {
                for (i, t) in pt.tables.iter().enumerate() {
                    if report.pages.len() > 1 || pt.tables.len() > 1 {
                        buf.push_str(&format!("### 第 {} 页 表格 {}\n\n", pt.page, i + 1));
                    }
                    buf.push_str(&markdown_table(&t.rows));
                    buf.push_str("\n\n");
                }
            }
            write_out(&args.output, &buf)?;
        }
        other => {
            if other != "json" {
                return Err(format!(
                    "未知格式 {other:?}（可选 json/csv/markdown）"
                ));
            }
            match &args.output {
                Some(out) => {
                    let json = serde_json::to_string_pretty(&report)
                        .map_err(|e| format!("JSON 序列化失败: {e}"))?;
                    std::fs::write(out, json).map_err(|e| format!("写入 {out} 失败: {e}"))?;
                    eprintln!("已写入 {out}");
                }
                None => print_json(&report),
            }
        }
    }
    Ok(())
}

fn extract_all(path: &str, args: &TableArgs) -> CmdResult<TableReport> {
    let strategy = TableStrategy::from_str(&args.strategy).map_err(|e| {
        format!("未知策略 {:?}: {e}（可选 lines/lines_strict/text）", args.strategy)
    })?;
    let mut settings = TableSettings::default();
    settings.vertical_strategy = strategy;
    settings.horizontal_strategy = strategy;

    let pdf =
        PdfDocument::open(path).map_err(|e| format!("pdfsink 打开 {path} 失败: {e}"))?;
    let total = pdf.pages().len();
    let wanted = parse_page_ranges(&args.pages, total)?;

    let mut pages = Vec::new();
    for &p in &wanted {
        let page = pdf.page(p).map_err(|e| format!("获取第 {p} 页失败: {e}"))?;
        // 单页失败不影响其他页（与 text 命令一致的容错哲学）
        let tables = match page.find_tables(settings.clone()) {
            Ok(ts) => ts,
            Err(e) => {
                eprintln!("警告: 第 {p} 页表格查找失败: {e}");
                continue;
            }
        };
        let mut out_tables = Vec::new();
        for t in &tables {
            let rows = t.extract(page, &settings.text_options);
            if !rows.is_empty() {
                out_tables.push(TableOut {
                    shape: [rows.len(), rows.first().map(|r| r.len()).unwrap_or(0)],
                    rows,
                });
            }
        }
        pages.push(PageTables {
            page: p,
            tables: out_tables,
        });
    }
    Ok(TableReport {
        file: args.file.clone(),
        strategy: args.strategy.clone(),
        pages,
    })
}

/// CSV 字段转义：含逗号/引号/换行时加双引号，内部引号 doubled。
fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn markdown_table(rows: &[Vec<Option<String>>]) -> String {
    let cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut out = String::new();
    for (ri, row) in rows.iter().enumerate() {
        let cells: Vec<String> = (0..cols)
            .map(|ci| {
                row.get(ci)
                    .and_then(|c| c.clone())
                    .unwrap_or_default()
                    .replace('|', "\\|")
                    .replace('\n', " ")
            })
            .collect();
        let line = if cells.is_empty() {
            String::new()
        } else {
            cells.join(" | ")
        };
        out.push_str(&format!("| {line} |\n"));
        if ri == 0 {
            out.push_str(&format!("|{}|\n", vec!["---"; cols.max(1)].join("|")));
        }
    }
    out
}

fn write_out(output: &Option<String>, content: &str) -> CmdResult<()> {
    match output {
        Some(out) => {
            std::fs::write(out, content).map_err(|e| format!("写入 {out} 失败: {e}"))?;
            eprintln!("已写入 {out}");
        }
        None => print!("{content}"),
    }
    Ok(())
}
