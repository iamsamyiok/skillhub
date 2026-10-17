//! merge：合并多个 PDF，保持输入顺序。
use crate::common::*;
use clap::Args;
use serde::Serialize;

#[derive(Args)]
pub struct MergeArgs {
    /// 输入 PDF（至少 2 个，按给定顺序拼接）
    #[arg(required = true, num_args = 2..)]
    pub inputs: Vec<String>,
    /// 输出文件
    #[arg(short, long)]
    pub output: String,
    /// 所有输入统一使用该密码打开（加密文档）
    #[arg(long)]
    pub password: Option<String>,
    /// 丢弃源文档的书签（默认保留并嫁接）
    #[arg(long)]
    pub no_outline: bool,
}

#[derive(Serialize)]
struct MergeReport {
    output: String,
    inputs: usize,
    pages_per_input: Vec<usize>,
    total_pages: usize,
}

pub fn run(args: MergeArgs) -> CmdResult<()> {
    let pw = args.password.as_deref();
    let mut target = load_doc(&args.inputs[0], pw)?;
    let target_pages = page_count(&target);
    let mut pages_per_input = vec![target_pages];

    for input in &args.inputs[1..] {
        let source = load_doc(input, pw)?;
        pages_per_input.push(page_count(&source));
        let new_pages = merge_documents(&mut target, source)?;
        // 挂到 Pages 根末尾
        let mut keep = ordered_pages(&target);
        keep.extend(new_pages);
        rebuild_pages(&mut target, &keep)?;
    }
    if args.no_outline {
        let _ = target.delete_outlines();
    }
    let total = page_count(&target);
    save_atomic(&mut target, &args.output)?;
    print_json(&MergeReport {
        output: args.output.clone(),
        inputs: args.inputs.len(),
        pages_per_input,
        total_pages: total,
    });
    Ok(())
}
