//! info：读取 PDF 结构信息。
use crate::common::*;
use clap::Args;
use lopdf::Document;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Args)]
pub struct InfoArgs {
    /// PDF 文件路径
    pub file: String,
    /// 加密文档的用户/所有者密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct PageSizeInfo {
    width_pt: f64,
    height_pt: f64,
    label: String,
    count: usize,
}

#[derive(Serialize)]
struct InfoReport {
    file: String,
    size_bytes: u64,
    size_human: String,
    pdf_version: Option<String>,
    page_count: usize,
    encrypted: bool,
    encrypted_note: Option<String>,
    page_sizes: Vec<PageSizeInfo>,
    metadata: BTreeMap<String, String>,
    outline_entries: usize,
    linearized: bool,
}

pub fn run(args: InfoArgs) -> CmdResult<()> {
    let path = Path::new(&args.file);
    let size_bytes = std::fs::metadata(path)
        .map_err(|e| format!("文件不存在或不可读: {} ({e})", args.file))?
        .len();
    let linearized = detect_linearized(path);

    let doc = match load_doc(&args.file, args.password.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            // 打不开时至少报告加密状态
            if file_is_encrypted(&args.file) {
                let mut report = InfoReport {
                    file: args.file.clone(),
                    size_bytes,
                    size_human: human_size(size_bytes),
                    pdf_version: None,
                    page_count: 0,
                    encrypted: true,
                    encrypted_note: Some("文档已加密，需提供 --password 才能读取详情".into()),
                    page_sizes: vec![],
                    metadata: BTreeMap::new(),
                    outline_entries: 0,
                    linearized,
                };
                if let Ok(meta) = Document::load_metadata(&args.file) {
                    report.pdf_version = Some(meta.version.clone());
                }
                print_json(&report);
                eprintln!("提示: 该 PDF 已加密，请加 --password <密码> 查看完整信息");
                return Ok(());
            }
            return Err(e);
        }
    };

    let mut metadata = BTreeMap::new();
    let info = info_dict(&doc);
    for field in INFO_FIELDS {
        if let Ok(v) = info.get(field) {
            let s = match v {
                lopdf::Object::String(b, _) => decode_pdf_string(b),
                other => format!("{other:?}"),
            };
            metadata.insert(String::from_utf8_lossy(field).to_string(), s);
        }
    }
    // 自定义 Info 字段
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

    // 页尺寸统计
    let mut size_groups: BTreeMap<(i64, i64), PageSizeInfo> = BTreeMap::new();
    for (_, page_id) in pages_1based(&doc) {
        if let Some([x0, y0, x1, y1]) = page_media_box(&doc, page_id) {
            let key = ((x1 - x0).round() as i64, (y1 - y0).round() as i64);
            let entry = size_groups.entry(key).or_insert_with(|| PageSizeInfo {
                width_pt: (x1 - x0).round(),
                height_pt: (y1 - y0).round(),
                label: size_label(x1 - x0, y1 - y0),
                count: 0,
            });
            entry.count += 1;
        }
    }

    let report = InfoReport {
        file: args.file.clone(),
        size_bytes,
        size_human: human_size(size_bytes),
        pdf_version: Some(doc.version.clone()),
        page_count: page_count(&doc),
        encrypted: false,
        encrypted_note: None,
        page_sizes: size_groups.into_values().collect(),
        metadata,
        outline_entries: count_outline_entries(&doc),
        linearized,
    };
    print_json(&report);
    Ok(())
}

/// PDF 文本字符串解码：UTF-16BE(BOM) / Latin-1 回退。
pub fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

/// 编码为 PDF 文本字符串（含 UCS-2 BOM，兼容中文）。
pub fn encode_pdf_string(s: &str) -> Vec<u8> {
    let mut out = vec![0xFE, 0xFF];
    for u in s.encode_utf16() {
        out.extend_from_slice(&u.to_be_bytes());
    }
    out
}

fn detect_linearized(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut buf = vec![0u8; 4096];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    buf.windows(11).any(|w| w == b"/Linearized")
}

/// 自研 outline 计数（沿 First 链 + 递归子树），避免依赖 lopdf 内部模块。
fn count_outline_entries(doc: &Document) -> usize {
    let Some(outline_ref) = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(b"Outlines").ok())
        .and_then(|o| o.as_reference().ok())
    else {
        return 0;
    };
    let Ok(root) = doc.get_dictionary(outline_ref) else {
        return 0;
    };
    let Ok(first) = root.get(b"First").and_then(|o| o.as_reference()) else {
        return 0;
    };
    count_outline_chain(doc, first, 0)
}

fn count_outline_chain(doc: &Document, id: lopdf::ObjectId, guard: usize) -> usize {
    if guard > 100_000 {
        return 0;
    }
    let Ok(d) = doc.get_dictionary(id) else {
        return 0;
    };
    let mut n = 1;
    if let Ok(child) = d.get(b"First").and_then(|o| o.as_reference()) {
        n += count_outline_chain(doc, child, guard + 1);
    }
    if let Ok(next) = d.get(b"Next").and_then(|o| o.as_reference()) {
        n += count_outline_chain(doc, next, guard + 1);
    }
    n
}
