//! delete：删除指定页。
use crate::common::*;
use clap::Args;
use lopdf::ObjectId;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Args)]
pub struct DeleteArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 要删除的页，如 "1,3-5"
    #[arg(long)]
    pub pages: String,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct DeleteReport {
    file: String,
    deleted: Vec<usize>,
    remaining: usize,
}

pub fn run(args: DeleteArgs) -> CmdResult<()> {
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let doomed: HashSet<usize> = parse_page_ranges(&args.pages, total)?.into_iter().collect();
    if doomed.len() == total {
        return Err("不能删除全部页面（PDF 至少保留 1 页）".into());
    }
    let all = ordered_pages(&doc);
    let keep: Vec<ObjectId> = all
        .iter()
        .enumerate()
        .filter(|(i, _)| !doomed.contains(&(i + 1)))
        .map(|(_, id)| *id)
        .collect();
    let kept_set: HashSet<ObjectId> = keep.iter().copied().collect();
    rebuild_pages(&mut doc, &keep)?;
    prune_outline(&mut doc, &kept_set);
    gc(&mut doc);
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&DeleteReport {
        file: out,
        deleted: doomed.into_iter().collect(),
        remaining: page_count(&doc),
    });
    Ok(())
}
