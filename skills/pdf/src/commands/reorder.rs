//! reorder：按给定顺序重排页面（未列出的页将被删除）。
use crate::common::*;
use clap::Args;
use lopdf::ObjectId;
use serde::Serialize;

#[derive(Args)]
pub struct ReorderArgs {
    /// PDF 文件路径
    pub file: String,
    /// 新顺序，如 "3,1,2"（须覆盖 1..=页数，不允许重复）
    pub order: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct ReorderReport {
    file: String,
    order: Vec<usize>,
}

pub fn run(args: ReorderArgs) -> CmdResult<()> {
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let order = parse_page_ranges(&args.order, total)?;
    let mut seen = std::collections::HashSet::new();
    for &p in &order {
        if !seen.insert(p) {
            return Err(format!("顺序中存在重复页码: {p}"));
        }
    }
    if order.len() != total {
        return Err(format!(
            "顺序需覆盖全部 {total} 页（收到 {} 页；PDF 页面对象不可共享，不支持一页多挂）",
            order.len()
        ));
    }
    let all = ordered_pages(&doc);
    let keep: Vec<ObjectId> = order.iter().map(|&p| all[p - 1]).collect();
    rebuild_pages(&mut doc, &keep)?;
    let kept: std::collections::HashSet<_> = keep.iter().copied().collect();
    prune_outline(&mut doc, &kept);
    gc(&mut doc);
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&ReorderReport { file: out, order });
    Ok(())
}
