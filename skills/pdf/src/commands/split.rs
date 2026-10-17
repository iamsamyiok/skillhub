//! split：按页范围或逐页拆分 PDF。
use crate::common::*;
use clap::Args;
use lopdf::ObjectId;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Args)]
pub struct SplitArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出目录（缺省为输入文件所在目录）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 页范围，如 "1-3,5"（每段输出一个文件）
    #[arg(long)]
    pub ranges: Option<String>,
    /// 逐页拆分（每页一个文件）
    #[arg(long)]
    pub each: bool,
    /// 输出文件名前缀（缺省取输入文件名主干）
    #[arg(long)]
    pub prefix: Option<String>,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct SplitReport {
    mode: String,
    output_dir: String,
    files: Vec<SplitFile>,
}

#[derive(Serialize)]
struct SplitFile {
    file: String,
    pages: String,
    page_count: usize,
}

pub fn run(args: SplitArgs) -> CmdResult<()> {
    let base = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&base);
    let src_path = Path::new(&args.file);
    let stem = args
        .prefix
        .clone()
        .unwrap_or_else(|| src_path.file_stem().unwrap_or_default().to_string_lossy().to_string());
    let out_dir = match &args.output {
        Some(d) => PathBuf::from(d),
        None => src_path.parent().unwrap_or(Path::new(".")).to_path_buf(),
    };
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("创建输出目录 {} 失败: {e}", out_dir.display()))?;

    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    if args.each || args.ranges.is_none() {
        for p in 1..=total {
            groups.push((format!("{stem}_p{p:03}.pdf"), vec![p]));
        }
    } else {
        let spec = args.ranges.as_deref().unwrap();
        let pages = parse_page_ranges(spec, total)?;
        // 把连续段切成组
        let mut start = pages[0];
        let mut prev = pages[0];
        for &p in &pages[1..] {
            if p == prev + 1 {
                prev = p;
            } else {
                groups.push((format!("{stem}_p{start:03}-{prev:03}.pdf"), (start..=prev).collect()));
                start = p;
                prev = p;
            }
        }
        groups.push((format!("{stem}_p{start:03}-{prev:03}.pdf"), (start..=prev).collect()));
    }

    let mut files = Vec::new();
    for (name, pages) in &groups {
        // 每段从原始完整文档的克隆出发，避免上一段 GC 破坏后续页面对象
        let mut doc = base.clone();
        let all = ordered_pages(&doc);
        let keep: Vec<ObjectId> = pages.iter().map(|&p| all[p - 1]).collect();
        rebuild_pages(&mut doc, &keep)?;
        gc(&mut doc);
        let out_path = out_dir.join(name);
        save_atomic(&mut doc, &out_path.to_string_lossy())?;
        files.push(SplitFile {
            file: out_path.to_string_lossy().to_string(),
            pages: pages
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
                .join(","),
            page_count: pages.len(),
        });
    }
    let mode = if args.each || args.ranges.is_none() { "each" } else { "ranges" };
    print_json(&SplitReport {
        mode: mode.into(),
        output_dir: out_dir.to_string_lossy().to_string(),
        files,
    });
    Ok(())
}
