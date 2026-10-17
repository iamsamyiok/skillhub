//! text：提取页面文本（lopdf 内置提取器，逐页容错）。
use crate::common::*;
use clap::Args;
use serde::Serialize;

#[derive(Args)]
pub struct TextArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文本文件（缺省打印到 stdout）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 输出 JSON 报告（含每页文本与错误）而非纯文本
    #[arg(long)]
    pub json: bool,
    /// 页范围，默认 all
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 单页内容流解压上限（MB），防御解压炸弹，默认 64
    #[arg(long, default_value = "64")]
    pub limit_mb: usize,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct PageText {
    page: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct TextReport {
    file: String,
    pages: Vec<PageText>,
}

pub fn run(args: TextArgs) -> CmdResult<()> {
    let doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let wanted = parse_page_ranges(&args.pages, total)?;
    let limit = args.limit_mb.saturating_mul(1024 * 1024);
    let mut pages = Vec::new();
    let mut plain = String::new();
    // 逐页调用：extract_text_chunks_with_limit 每页可能返回多个 chunk，
    // 逐页处理才能保证页码与内容对应准确。
    for &p in &wanted {
        let chunks = doc.extract_text_chunks_with_limit(&[p as u32], limit);
        let mut page_text = String::new();
        let mut page_err: Option<String> = None;
        for chunk in chunks {
            match chunk {
                Ok(t) => page_text.push_str(&t),
                Err(e) => page_err = Some(e.to_string()),
            }
        }
        match page_err {
            None => {
                if !plain.is_empty() {
                    plain.push_str("\n\n");
                }
                plain.push_str(&page_text);
                pages.push(PageText {
                    page: p,
                    text: Some(page_text),
                    error: None,
                });
            }
            Some(e) => {
                eprintln!("警告: 第 {p} 页文本提取失败: {e}");
                pages.push(PageText {
                    page: p,
                    text: None,
                    error: Some(e),
                });
            }
        }
    }
    if let Some(out) = &args.output {
        std::fs::write(out, &plain).map_err(|e| format!("写入 {out} 失败: {e}"))?;
        eprintln!("已写入 {out}");
    }
    if args.json {
        print_json(&TextReport {
            file: args.file.clone(),
            pages,
        });
    } else if args.output.is_none() {
        print!("{plain}");
        if !plain.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}
