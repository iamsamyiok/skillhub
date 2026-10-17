//! validate：结构校验，输出问题列表。
use crate::common::*;
use clap::Args;
use lopdf::Object;
use serde::Serialize;

#[derive(Args)]
pub struct ValidateArgs {
    /// PDF 文件路径
    pub file: String,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct ValidateReport {
    file: String,
    ok: bool,
    issues: Vec<String>,
    page_count: usize,
}

pub fn run(args: ValidateArgs) -> CmdResult<()> {
    let mut issues: Vec<String> = Vec::new();
    let doc = match load_doc(&args.file, args.password.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            issues.push(format!("文档加载失败: {e}"));
            print_json(&ValidateReport {
                file: args.file.clone(),
                ok: false,
                issues,
                page_count: 0,
            });
            std::process::exit(EXIT_VALIDATION);
        }
    };

    // catalog
    match doc.catalog() {
        Ok(cat) => {
            if !matches!(cat.get(b"Type"), Ok(Object::Name(n)) if n == b"Catalog") {
                issues.push("catalog /Type 缺失或不是 Catalog".into());
            }
            if cat.get(b"Pages").is_err() {
                issues.push("catalog 缺少 /Pages".into());
            }
        }
        Err(e) => issues.push(format!("catalog 不可读: {e}")),
    }
    // trailer
    if doc.trailer.get(b"Root").is_err() {
        issues.push("trailer 缺少 /Root".into());
    }
    // 每页检查
    let pages = pages_1based(&doc);
    if pages.is_empty() {
        issues.push("文档没有任何页面".into());
    }
    for (pno, id) in &pages {
        let page = match doc.get_dictionary(*id) {
            Ok(d) => d,
            Err(e) => {
                issues.push(format!("第 {pno} 页对象不可读: {e}"));
                continue;
            }
        };
        if !matches!(page.get(b"Type"), Ok(Object::Name(n)) if n == b"Page") {
            issues.push(format!("第 {pno} 页 /Type 缺失或不是 Page"));
        }
        if page_media_box(&doc, *id).is_none() {
            issues.push(format!("第 {pno} 页 /MediaBox 缺失或不可解析"));
        }
        // Contents 可解析性
        for cid in doc.get_page_contents(*id) {
            if doc.get_object(cid).is_err() {
                issues.push(format!("第 {pno} 页内容流对象 {cid:?} 缺失"));
            }
        }
    }
    let ok = issues.is_empty();
    print_json(&ValidateReport {
        file: args.file.clone(),
        ok,
        issues,
        page_count: pages.len(),
    });
    if !ok {
        std::process::exit(EXIT_VALIDATION);
    }
    Ok(())
}
