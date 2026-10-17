//! extract：把指定页提取为新的 PDF。
use crate::common::*;
use clap::Args;
use lopdf::ObjectId;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Args)]
pub struct ExtractArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件
    #[arg(short, long)]
    pub output: String,
    /// 要提取的页，如 "1-3,7"（按给定顺序保留）
    #[arg(long)]
    pub pages: String,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct ExtractReport {
    file: String,
    output: String,
    extracted: Vec<usize>,
}

pub fn run(args: ExtractArgs) -> CmdResult<()> {
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let wanted = parse_page_ranges(&args.pages, total)?;
    let all = ordered_pages(&doc);
    let keep: Vec<ObjectId> = wanted.iter().map(|&p| all[p - 1]).collect();
    let kept_set: HashSet<ObjectId> = keep.iter().copied().collect();
    rebuild_pages(&mut doc, &keep)?;
    prune_outline(&mut doc, &kept_set);
    gc(&mut doc);
    save_atomic(&mut doc, &args.output)?;
    print_json(&ExtractReport {
        file: args.file.clone(),
        output: args.output.clone(),
        extracted: wanted,
    });
    Ok(())
}
