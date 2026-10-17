//! encrypt：给 PDF 加密（RC4-40 / RC4-128 / AES-128 / AES-256）。
use crate::common::*;
use clap::Args;
use lopdf::encryption::crypt_filters::{Aes128CryptFilter, Aes256CryptFilter, CryptFilter};
use lopdf::{EncryptionState, EncryptionVersion, Permissions};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Args)]
pub struct EncryptArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 用户密码（打开密码；缺省空）
    #[arg(long, default_value = "")]
    pub user_pw: String,
    /// 所有者密码（权限密码；缺省空）
    #[arg(long, default_value = "")]
    pub owner_pw: String,
    /// 加密方法: rc4-40 | rc4-128 | aes-128 | aes-256
    #[arg(long, default_value = "aes-256")]
    pub method: String,
    /// 禁止打印
    #[arg(long)]
    pub no_print: bool,
    /// 禁止修改内容
    #[arg(long)]
    pub no_modify: bool,
    /// 禁止复制/提取
    #[arg(long)]
    pub no_copy: bool,
    /// 禁止注释/填表
    #[arg(long)]
    pub no_annotate: bool,
    /// 禁止组装（插页/旋转/删除）
    #[arg(long)]
    pub no_assemble: bool,
    /// 源文档密码（加密文档再加密时使用）
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct EncryptReport {
    file: String,
    method: String,
    permissions: Vec<String>,
}

pub fn run(args: EncryptArgs) -> CmdResult<()> {
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let mut perms = Permissions::all();
    let mut granted: Vec<String> = Vec::new();
    if args.no_print {
        perms.remove(Permissions::PRINTABLE);
        granted.push("禁止打印".into());
    }
    if args.no_modify {
        perms.remove(Permissions::MODIFIABLE);
        granted.push("禁止修改".into());
    }
    if args.no_copy {
        perms.remove(Permissions::COPYABLE);
        granted.push("禁止复制".into());
    }
    if args.no_annotate {
        perms.remove(Permissions::ANNOTABLE);
        granted.push("禁止注释填表".into());
    }
    if args.no_assemble {
        perms.remove(Permissions::ASSEMBLABLE);
        granted.push("禁止组装".into());
    }

    let state = match args.method.as_str() {
        "rc4-40" => EncryptionState::try_from(EncryptionVersion::V1 {
            document: &doc,
            owner_password: &args.owner_pw,
            user_password: &args.user_pw,
            permissions: perms,
        })
        .map_err(|e| format!("构造加密参数失败: {e}"))?,
        "rc4-128" => EncryptionState::try_from(EncryptionVersion::V2 {
            document: &doc,
            owner_password: &args.owner_pw,
            user_password: &args.user_pw,
            key_length: 128,
            permissions: perms,
        })
        .map_err(|e| format!("构造加密参数失败: {e}"))?,
        "aes-128" => {
            let cf: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
            EncryptionState::try_from(EncryptionVersion::V4 {
                document: &doc,
                encrypt_metadata: true,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), cf)]),
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password: &args.owner_pw,
                user_password: &args.user_pw,
                permissions: perms,
            })
            .map_err(|e| format!("构造加密参数失败: {e}"))?
        }
        "aes-256" => {
            let key: [u8; 32] = rand::random();
            let cf: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
            EncryptionState::try_from(EncryptionVersion::V5 {
                encrypt_metadata: true,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), cf)]),
                file_encryption_key: &key,
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password: &args.owner_pw,
                user_password: &args.user_pw,
                permissions: perms,
            })
            .map_err(|e| format!("构造加密参数失败: {e}"))?
        }
        other => {
            return Err(format!(
                "未知加密方法: {other}（支持 rc4-40 / rc4-128 / aes-128 / aes-256）"
            ));
        }
    };
    doc.encrypt(&state)
        .map_err(|e| format!("加密失败: {e}（文档可能已加密）"))?;
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&EncryptReport {
        file: out,
        method: args.method.clone(),
        permissions: granted,
    });
    Ok(())
}
