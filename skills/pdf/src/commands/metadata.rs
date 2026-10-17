//! metadata：读取/写入 Info 元数据。
use crate::commands::info::{decode_pdf_string, encode_pdf_string};
use crate::common::*;
use clap::{Args, Subcommand};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Args)]
pub struct MetadataArgs {
    #[command(subcommand)]
    pub action: MetadataAction,
}

#[derive(Subcommand)]
pub enum MetadataAction {
    /// 读取元数据
    Get(GetArgs),
    /// 写入元数据（未提供的字段保持不变）
    Set(SetArgs),
}

#[derive(Args)]
pub struct GetArgs {
    pub file: String,
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Args)]
pub struct SetArgs {
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    #[arg(long)]
    pub title: Option<String>,
    #[arg(long)]
    pub author: Option<String>,
    #[arg(long)]
    pub subject: Option<String>,
    #[arg(long)]
    pub keywords: Option<String>,
    #[arg(long)]
    pub creator: Option<String>,
    #[arg(long)]
    pub producer: Option<String>,
    /// 同时把 ModDate 更新为当前时间
    #[arg(long)]
    pub now: bool,
    /// 清空全部元数据字段
    #[arg(long)]
    pub clear: bool,
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct MetadataReport {
    file: String,
    metadata: BTreeMap<String, String>,
}

pub fn run(args: MetadataArgs) -> CmdResult<()> {
    match args.action {
        MetadataAction::Get(a) => get(a),
        MetadataAction::Set(a) => set(a),
    }
}

fn get(args: GetArgs) -> CmdResult<()> {
    let doc = load_doc(&args.file, args.password.as_deref())?;
    let info = info_dict(&doc);
    let mut metadata = BTreeMap::new();
    for field in INFO_FIELDS {
        if let Ok(v) = info.get(field) {
            if let lopdf::Object::String(b, _) = v {
                metadata.insert(String::from_utf8_lossy(field).to_string(), decode_pdf_string(b));
            }
        }
    }
    for (k, v) in info.iter() {
        if INFO_FIELDS.contains(&k.as_slice()) {
            continue;
        }
        if let Ok(s) = v.as_str() {
            metadata.insert(
                String::from_utf8_lossy(k).to_string(),
                String::from_utf8_lossy(s).to_string(),
            );
        }
    }
    print_json(&MetadataReport {
        file: args.file,
        metadata,
    });
    Ok(())
}

fn set(args: SetArgs) -> CmdResult<()> {
    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let info_id = ensure_info_dict(&mut doc)?;
    let info = doc
        .get_object_mut(info_id)
        .map_err(|e| format!("Info 字典写入失败: {e}"))?
        .as_dict_mut()
        .map_err(|_| "Info 对象不是字典".to_string())?;
    if args.clear {
        for field in INFO_FIELDS {
            info.remove(field);
        }
    }
    let fields: [(&[u8], &Option<String>); 6] = [
        (b"Title", &args.title),
        (b"Author", &args.author),
        (b"Subject", &args.subject),
        (b"Keywords", &args.keywords),
        (b"Creator", &args.creator),
        (b"Producer", &args.producer),
    ];
    for (key, val) in fields {
        if let Some(v) = val {
            if v.is_empty() {
                info.remove(key);
            } else {
                info.set(key, lopdf::Object::String(encode_pdf_string(v), lopdf::StringFormat::Literal));
            }
        }
    }
    if args.now {
        info.set(
            b"ModDate",
            lopdf::Object::String(encode_pdf_string(&now_pdf_date()), lopdf::StringFormat::Literal),
        );
    }
    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    let report_info = info_dict(&doc);
    let mut metadata = BTreeMap::new();
    for field in INFO_FIELDS {
        if let Ok(lopdf::Object::String(b, _)) = report_info.get(field) {
            metadata.insert(String::from_utf8_lossy(field).to_string(), decode_pdf_string(b));
        }
    }
    print_json(&MetadataReport { file: out, metadata });
    Ok(())
}
