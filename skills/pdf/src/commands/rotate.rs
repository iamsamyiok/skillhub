//! rotate：旋转页面。
use crate::common::*;
use clap::Args;
use serde::Serialize;

#[derive(Args)]
pub struct RotateArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 旋转角度（90 的倍数，支持负数，如 90 / 180 / -90）
    #[arg(short = 'p', long, default_value = "90", allow_hyphen_values = true)]
    pub by: i32,
    /// 页范围，默认 all
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct RotateReport {
    file: String,
    rotated_pages: Vec<usize>,
    by: i32,
    new_rotations: Vec<(usize, u32)>,
}

pub fn run(args: RotateArgs) -> CmdResult<()> {
    let by = args.by.rem_euclid(360);
    if by % 90 != 0 {
        return Err(format!("旋转角度必须是 90 的倍数（含负值），收到: {}", args.by));
    }
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let targets = parse_page_ranges(&args.pages, total)?;
    let all = ordered_pages(&doc);
    let mut report_pages = Vec::new();
    let mut new_rot = Vec::new();
    for p in targets {
        let id = all[p - 1];
        let old = page_rotation(&doc, id);
        let new = (old + by as u32) % 360;
        let page = doc
            .get_object_mut(id)
            .map_err(|e| format!("页面 {p} 读取失败: {e}"))?
            .as_dict_mut()
            .map_err(|_| format!("页面 {p} 不是字典"))?;
        page.set(b"Rotate", lopdf::Object::Integer(new as i64));
        report_pages.push(p);
        new_rot.push((p, new));
    }
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&RotateReport {
        file: out,
        rotated_pages: report_pages,
        by: args.by,
        new_rotations: new_rot,
    });
    Ok(())
}
