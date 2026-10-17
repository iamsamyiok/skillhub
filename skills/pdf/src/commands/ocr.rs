//! ocr：MinerU 云端 OCR / 文档解析（扫描件、复杂表格、公式）。
//!
//! 链路：本地裁页（省额度 + 避开 API 页数限制差异）→ 上传 MinerU →
//! 轮询任务 → 下载 full.md → 输出。双模式自适应：有 Token（--token 或
//! MINERU_TOKEN 环境变量）走标准版 vlm（表格/公式全支持）；无 Token 走
//! 免登录轻量版（每日 1 万页/IP，10MB/20 页）。
//!
//! 合规声明：本命令会把文件内容上传至 mineru.net 云端解析。涉密文件
//! （投标/财务）请评估后使用；stderr 每次都会显式提示上传行为。
use crate::common::*;
use crate::mineru::{MinerU, AGENT_MAX_PAGES, STD_MAX_PAGES};
use clap::Args;
use lopdf::ObjectId;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Args)]
pub struct OcrArgs {
    /// PDF 文件路径
    pub file: String,
    /// 页范围，默认 all（1-based，如 "1-3,5"）
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 解析语言，影响 OCR 精度：ch / en / korean / japan 等
    #[arg(long, default_value = "ch")]
    pub language: String,
    /// 输出格式：markdown（默认，结构化 Markdown）/ text（去标记纯文本）/ json
    #[arg(long, default_value = "markdown")]
    pub format: String,
    /// 标准版 Token（也可用 MINERU_TOKEN 环境变量）；无则走免登录轻量版
    #[arg(long)]
    pub token: Option<String>,
    /// 强制开启 OCR（缺省 false = MinerU 自动识别是否需要 OCR）
    #[arg(long)]
    pub is_ocr: bool,
    /// 输出文件（缺省打印到 stdout）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
    /// 轮询总超时（秒），大文件自动排队时适当调大
    #[arg(long, default_value = "300")]
    pub timeout: u64,
}

#[derive(Serialize)]
struct OcrReport {
    file: String,
    pages: String,
    language: String,
    mode: String,
    uploaded_bytes: usize,
    markdown: String,
    /// 标准版结果包内的附带文件（结构化 JSON 等），agent 版为空
    #[serde(skip_serializing_if = "Vec::is_empty")]
    extra_files: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
}

pub fn run(args: OcrArgs) -> CmdResult<()> {
    if !["markdown", "text", "json"].contains(&args.format.as_str()) {
        return Err(format!(
            "不支持的 --format {}（可选 markdown/text/json）",
            args.format
        ));
    }

    // 1) 加载（支持加密文档：先解密再上传）
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let pages = if args.pages == "all" {
        (1..=total).collect::<Vec<usize>>()
    } else {
        parse_page_ranges(&args.pages, total)?
    };
    let is_subset = pages.len() != total;

    // 2) 本地裁页 → 内存 PDF（裁页后体积更小、上传更快、省免费额度）
    let upload_bytes: Vec<u8> = if is_subset {
        let all = ordered_pages(&doc);
        let keep: Vec<ObjectId> = pages.iter().map(|&p| all[p - 1]).collect();
        let kept_set: HashSet<ObjectId> = keep.iter().copied().collect();
        rebuild_pages(&mut doc, &keep)?;
        prune_outline(&mut doc, &kept_set);
        gc(&mut doc);
        let mut buf = Vec::new();
        doc.save_to(&mut buf)
            .map_err(|e| format!("裁页后生成临时 PDF 失败: {e}"))?;
        buf
    } else {
        // 全文档且未加密时直接读原文件字节（免去一次重新保存）
        if doc.was_encrypted() {
            let mut buf = Vec::new();
            doc.save_to(&mut buf)
                .map_err(|e| format!("解密后生成临时 PDF 失败: {e}"))?;
            buf
        } else {
            std::fs::read(&args.file).map_err(|e| format!("读取 {} 失败: {e}", args.file))?
        }
    };
    drop(doc);

    // 3) 页数预检（按模式的上限提前拒绝，避免浪费上传流量）
    let token = args
        .token
        .clone()
        .or_else(|| std::env::var("MINERU_TOKEN").ok());
    let client = MinerU::new(token).with_timeouts(120, args.timeout.max(10));
    let has_token = client.has_token();
    let page_cap = if has_token { STD_MAX_PAGES } else { AGENT_MAX_PAGES };
    if pages.len() > page_cap {
        return Err(format!(
            "本次解析 {} 页，超出{}上限 {} 页。请用 --pages 分批，或{}。",
            pages.len(),
            if has_token { "标准版" } else { "免登录轻量版" },
            page_cap,
            if has_token {
                "分多批处理"
            } else {
                "配置 MINERU_TOKEN 走标准版（200 页）"
            }
        ));
    }

    // 4) 上传行为显式提示（合规）
    eprintln!(
        "提示: 文件将上传至 mineru.net 云端解析（{}，{} 字节）。涉密文件请评估后使用。",
        if has_token {
            "标准版 vlm"
        } else {
            "免登录轻量版"
        },
        upload_bytes.len()
    );

    // 5) 调 MinerU
    let file_name = base_file_name(&args.file);
    let result = client.parse_file(&file_name, &upload_bytes, &args.language, args.is_ocr)?;

    // 6) 输出
    let mut warnings = Vec::new();
    if result.mode == "agent" && result.markdown.is_empty() {
        warnings.push("MinerU 返回内容为空，文件可能为纯图片且 OCR 未触发（可加 --is-ocr 重试）".into());
    }
    let extra_names: Vec<String> = result
        .extra_files
        .iter()
        .map(|(n, _)| n.clone())
        .collect();
    let body = match args.format.as_str() {
        "text" => strip_markdown(&result.markdown),
        _ => result.markdown.clone(),
    };
    if let Some(out) = &args.output {
        std::fs::write(out, &body).map_err(|e| format!("写入 {out} 失败: {e}"))?;
    }
    if args.format == "json" {
        // json 模式：报告同时含 markdown 全文，落盘文件供人读
        print_json(&OcrReport {
            file: args.file.clone(),
            pages: args.pages.clone(),
            language: args.language.clone(),
            mode: result.mode.to_string(),
            uploaded_bytes: upload_bytes.len(),
            markdown: result.markdown,
            extra_files: extra_names,
            warnings,
        });
    } else if args.output.is_none() {
        print!("{body}");
        if !body.ends_with('\n') {
            println!();
        }
    }
    Ok(())
}

/// 取不含目录的文件名（MinerU 按扩展名判断文件类型）。
fn base_file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string())
}

/// 轻量 markdown → 纯文本：去标题号/强调符/链接/图片/表格分隔行。
/// 不追求完美渲染，目标是保留可读文字供检索。
fn strip_markdown(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    for line in md.lines() {
        let l = line.trim_end();
        // 表格分隔行（|---|---|）直接丢
        if l.starts_with('|')
            && l.chars()
                .all(|c| matches!(c, '|' | '-' | ':' | ' '))
        {
            continue;
        }
        let l = l.trim_start_matches(|c| "#*>-` ".contains(c));
        // 图片/链接语法保留可见文字
        let l = strip_inline(l);
        if !l.is_empty() {
            out.push_str(&l);
            out.push('\n');
        }
    }
    out
}

fn strip_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('[') {
        out.push_str(&strip_emphasis(&rest[..start]));
        if let Some(mid) = rest[start..].find("](") {
            let text_end = start + mid;
            out.push_str(&rest[start + 1..text_end]);
            if let Some(close) = rest[text_end + 2..].find(')') {
                rest = &rest[text_end + 2 + close + 1..];
                continue;
            }
        }
        // 不是完整链接语法，原样输出 '['
        out.push('[');
        rest = &rest[start + 1..];
    }
    out.push_str(&strip_emphasis(rest));
    out
}

/// 去掉行内强调/代码标记字符（**加粗** → 加粗，`代码` → 代码）。
fn strip_emphasis(s: &str) -> String {
    s.chars().filter(|c| *c != '*' && *c != '`').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_markdown_basic() {
        let md = "# 标题\n\n正文 **加粗** 与 `代码`。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[链接](https://x.com)\n";
        let t = strip_markdown(md);
        assert!(t.contains("标题"));
        assert!(t.contains("正文 加粗 与 代码。"));
        assert!(!t.contains("|---"));
        assert!(t.contains("链接"));
        assert!(!t.contains("https://x.com"));
        assert!(t.contains("1 2") || t.contains("| 1 | 2 |"));
    }

    #[test]
    fn base_file_name_keeps_extension() {
        assert_eq!(base_file_name("/a/b/report.pdf"), "report.pdf");
        assert_eq!(base_file_name("x.pdf"), "x.pdf");
    }
}
