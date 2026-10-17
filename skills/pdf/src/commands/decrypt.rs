//! decrypt：移除 PDF 加密（输出明文）。
use crate::common::*;
use clap::Args;
use serde::Serialize;

#[derive(Args)]
pub struct DecryptArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 用户/所有者密码（缺省空密码）
    #[arg(long, default_value = "")]
    pub password: String,
}

#[derive(Serialize)]
struct DecryptReport {
    file: String,
}

pub fn run(args: DecryptArgs) -> CmdResult<()> {
    if !file_is_encrypted(&args.file) {
        return Err("文档未加密，无需解密".into());
    }
    // load_with_password 加载后对象已就地解密、trailer 的 Encrypt 已移除，
    // 直接保存即为明文 PDF。
    let mut doc = load_doc(&args.file, Some(&args.password))?;
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&DecryptReport { file: out });
    Ok(())
}
