//! forms：AcroForm 表单读取与填写（list / set）。
//!
//! list：遍历 AcroForm 字段树，输出全名（父子以 . 拼接）、类型、当前值、
//!       选项（下拉/单选），JSON 结构化。
//! set：按 "字段全名=值" 写 /V；复选框用 on/off（同步 /AS）；
//!       同时设 /NeedAppearances true 让阅读器重绘外观。
//!
//! 边界声明（诚实）：不自绘 appearance stream——复杂表单的视觉呈现
//! 依赖阅读器（Acrobat/Edge/Evince）对 NeedAppearances 的处理；
//! 若目标阅读器不重绘，值仍以 /V 为准可被程序读取（pypdf 验证即走此路）。
use crate::common::*;
use clap::{Args, Subcommand};
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Args)]
pub struct FormsArgs {
    #[command(subcommand)]
    pub action: FormsAction,
}

#[derive(Subcommand)]
pub enum FormsAction {
    /// 列出全部表单字段（JSON：全名/类型/当前值/选项）
    List {
        /// PDF 文件路径
        file: String,
        /// 加密文档密码
        #[arg(long)]
        password: Option<String>,
    },
    /// 填写表单字段（"字段全名=值"，可多次；复选框值 on/off）
    Set {
        /// PDF 文件路径
        file: String,
        /// 字段赋值，如 --field "姓名=张三"（可重复）
        #[arg(long, required = true)]
        field: Vec<String>,
        /// 输出文件（缺省原地覆盖，原子写）
        #[arg(short, long)]
        output: Option<String>,
        /// 加密文档密码
        #[arg(long)]
        password: Option<String>,
    },
}

#[derive(Serialize)]
struct FieldOut {
    name: String,
    ftype: String,
    value: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    options: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    readonly: bool,
}

#[derive(Serialize)]
struct ListReport {
    file: String,
    fields: Vec<FieldOut>,
}

#[derive(Serialize)]
struct SetReport {
    file: String,
    output: String,
    set: Vec<(String, String)>,
    not_found: Vec<String>,
}

pub fn run(args: FormsArgs) -> CmdResult<()> {
    match args.action {
        FormsAction::List { file, password } => run_list(&file, password.as_deref()),
        FormsAction::Set {
            file,
            field,
            output,
            password,
        } => run_set(&file, &field, output.as_deref(), password.as_deref()),
    }
}

fn run_list(file: &str, password: Option<&str>) -> CmdResult<()> {
    let doc = load_doc(file, password)?;
    let fields = collect_fields(&doc)?;
    print_json(&ListReport {
        file: file.to_string(),
        fields,
    });
    Ok(())
}

fn run_set(
    file: &str,
    assignments: &[String],
    output: Option<&str>,
    password: Option<&str>,
) -> CmdResult<()> {
    let mut doc = load_doc(file, password)?;
    // 解析 "name=value"（值允许含等号，按第一个 = 切）
    let mut pairs: Vec<(String, String)> = Vec::new();
    for a in assignments {
        let Some((k, v)) = a.split_once('=') else {
            return Err(format!(
                "字段参数 {a} 格式错误，应为 \"字段名=值\"（如 --field \"姓名=张三\"）"
            ));
        };
        if k.is_empty() {
            return Err(format!("字段参数 {a} 的字段名为空"));
        }
        pairs.push((k.to_string(), v.to_string()));
    }

    // 收集字段树（全名 → id）
    let index = field_index(&doc)?;
    let mut set_ok = Vec::new();
    let mut not_found = Vec::new();
    for (name, value) in &pairs {
        match index.iter().find(|(n, _)| n == name) {
            Some((_, id)) => {
                set_field_value(&mut doc, *id, value)?;
                set_ok.push((name.clone(), value.clone()));
            }
            None => not_found.push(name.clone()),
        }
    }
    if set_ok.is_empty() {
        return Err(format!(
            "未匹配到任何字段。可用 `pdfctl forms list {}` 查看字段全名。未找到: {:?}",
            file, not_found
        ));
    }
    // NeedAppearances：提示阅读器重绘
    ensure_need_appearances(&mut doc)?;

    let out = output.unwrap_or(file).to_string();
    save_atomic(&mut doc, &out)?;
    print_json(&SetReport {
        file: file.to_string(),
        output: out,
        set: set_ok,
        not_found,
    });
    Ok(())
}

/// 遍历 AcroForm 字段树，返回扁平化字段列表（全名以 . 拼接）。
fn collect_fields(doc: &Document) -> CmdResult<Vec<FieldOut>> {
    let index = field_index(doc)?;
    let mut out = Vec::new();
    for (name, id) in &index {
        let dict = doc
            .get_dictionary(*id)
            .map_err(|e| format!("读取字段 {name} 字典失败: {e}"))?;
        out.push(FieldOut {
            name: name.clone(),
            ftype: field_type(dict),
            value: field_value_str(doc, dict),
            options: field_options(dict),
            readonly: dict
                .get(b"Ff")
                .and_then(|o| o.as_i64())
                .is_ok_and(|f| f & 1 != 0),
        });
    }
    Ok(out)
}

/// 建立 全名 → ObjectId 索引。层级字段（有 Kids 且无 /FT 或 /FT=Bbtn 组合）
/// 递归拼接；叶子字段直接登记。
fn field_index(doc: &Document) -> CmdResult<Vec<(String, ObjectId)>> {
    let mut out = Vec::new();
    let catalog = doc
        .catalog()
        .map_err(|e| format!("读取文档 Catalog 失败: {e}"))?;
    let acroform = catalog
        .get(b"AcroForm")
        .map_err(|_| "该 PDF 无 AcroForm 表单".to_string())?;
    let acro_dict = match acroform {
        Object::Dictionary(d) => d.clone(),
        Object::Reference(id) => doc
            .get_dictionary(*id)
            .map_err(|e| format!("读取 AcroForm 字典失败: {e}"))?
            .clone(),
        _ => return Err("AcroForm 不是字典".into()),
    };
    let fields = acro_dict
        .get(b"Fields")
        .map_err(|_| "AcroForm 无 /Fields 数组".to_string())?;
    let Object::Array(arr) = fields else {
        return Err("AcroForm /Fields 不是数组".into());
    };
    let mut visited: HashSet<ObjectId> = HashSet::new();
    for f in arr {
        if let Ok(id) = f.as_reference() {
            walk_field(doc, id, "", &mut out, &mut visited);
        }
    }
    if out.is_empty() {
        return Err("AcroForm 字段树为空".into());
    }
    Ok(out)
}

fn walk_field(
    doc: &Document,
    id: ObjectId,
    prefix: &str,
    out: &mut Vec<(String, ObjectId)>,
    visited: &mut HashSet<ObjectId>,
) {
    if !visited.insert(id) {
        return; // 防环
    }
    let Ok(dict) = doc.get_dictionary(id) else {
        return;
    };
    let partial = dict
        .get(b"T")
        .ok()
        .and_then(|o| match o {
            Object::String(s, _) => Some(pdf_str(s)),
            _ => None,
        })
        .unwrap_or_default();
    let full = if prefix.is_empty() {
        partial.clone()
    } else if partial.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}.{partial}")
    };
    let has_kids = matches!(dict.get(b"Kids"), Ok(Object::Array(_)));
    let is_terminal = !has_kids
        || dict.get(b"FT").is_ok()
        || matches!(dict.get(b"T"), Ok(Object::String(_, _)));
    if is_terminal && !full.is_empty() {
        out.push((full, id));
        // 终端字段也可能带 Kids（如单选组的各个按钮）， Kids 不再单独登记
        return;
    }
    if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
        for k in kids {
            if let Ok(kid_id) = k.as_reference() {
                walk_field(doc, kid_id, &full, out, visited);
            }
        }
    }
}

/// 写字段值。
fn set_field_value(doc: &mut Document, id: ObjectId, value: &str) -> CmdResult<()> {
    let dict = doc
        .get_dictionary_mut(id)
        .map_err(|e| format!("字段对象不可写: {e}"))?;
    let ftype = field_type(dict);
    match ftype.as_str() {
        "checkbox" | "radio" => {
            let on = matches!(value.to_lowercase().as_str(), "on" | "true" | "yes" | "1" | "√");
            if on {
                // 找 on 状态名（/AP /N 字典的第一个非 Off 键）
                let on_name = on_state_name(dict).unwrap_or_else(|| b"Yes".to_vec());
                dict.set("V", Object::Name(on_name.clone()));
                dict.set("AS", Object::Name(on_name));
            } else {
                dict.set("V", Object::Name(b"Off".to_vec()));
                dict.set("AS", Object::Name(b"Off".to_vec()));
            }
        }
        _ => {
            // 文本/下拉/列表框：字符串值。非 ASCII 按 PDF 规范写
            // UTF-16BE + BOM——否则阅读器按 Latin-1 解析中文必乱码
            // （与读取侧 pdf_str 的 BOM 判别对称）。
            dict.set(
                "V",
                Object::String(encode_pdf_text(value), lopdf::StringFormat::Literal),
            );
        }
    }
    Ok(())
}

/// PDF 文本字符串编码：ASCII 原样；非 ASCII 用 UTF-16BE + BOM。
fn encode_pdf_text(s: &str) -> Vec<u8> {
    if s.is_ascii() {
        return s.as_bytes().to_vec();
    }
    let mut v = vec![0xFE, 0xFF];
    for u in s.encode_utf16() {
        v.extend_from_slice(&u.to_be_bytes());
    }
    v
}

/// 复选框/单选的 on 状态名：优先 /AP /N 中第一个非 Off 的键。
fn on_state_name(dict: &Dictionary) -> Option<Vec<u8>> {
    let ap = dict.get(b"AP").ok()?.as_dict().ok()?;
    let n = ap.get(b"N").ok()?.as_dict().ok()?;
    n.iter()
        .map(|(k, _)| k.clone())
        .find(|k| k != b"Off")
}

fn ensure_need_appearances(doc: &mut Document) -> CmdResult<()> {
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "文档无 Root".to_string())?;
    let acro_id = {
        let catalog = doc
            .get_dictionary(catalog_id)
            .map_err(|e| format!("读取 Catalog 失败: {e}"))?;
        catalog
            .get(b"AcroForm")
            .and_then(|o| o.as_reference())
            .map_err(|_| "AcroForm 不是间接引用".to_string())?
    };
    let acro = doc
        .get_dictionary_mut(acro_id)
        .map_err(|e| format!("AcroForm 不可写: {e}"))?;
    acro.set("NeedAppearances", Object::Boolean(true));
    Ok(())
}

fn field_type(dict: &Dictionary) -> String {
    match dict.get(b"FT").and_then(|o| o.as_name()).ok() {
        Some(b"Tx") => "text".into(),
        Some(b"Ch") => "choice".into(),
        Some(b"Btn") => {
            // Btn 细分：有 /AS 的是 checkbox/radio，纯 PushBtn 是按钮
            if dict.get(b"AS").is_ok() {
                "checkbox".into()
            } else {
                "button".into()
            }
        }
        Some(b"Sig") => "signature".into(),
        _ => "unknown".into(),
    }
}

/// PDF 文本字符串解码：UTF-16BE（带 BOM FE FF）或 PDFDocEncoding（≈Latin-1）。
/// lopdf 的 Object::String 只给原始字节，编码判别在调用侧。
/// pypdf 写非 Latin-1 字符串时自动用 UTF-16BE + BOM，必须按此解码否则中文乱码。
fn pdf_str(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let u16s: Vec<u16> = bytes[2..]
            .chunks(2)
            .map(|c| u16::from_be_bytes([c[0], c.get(1).copied().unwrap_or(0)]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

fn field_value_str(doc: &Document, dict: &Dictionary) -> String {
    // /V 为主；复选框/单选缺省 /V 时回退 /AS（外观状态才是"当前是否勾选"的
    // 权威来源——reportlab 等生成器对未勾选框常不写 /V）。
    if dict.get(b"V").is_err() && dict.get(b"AS").is_ok() {
        if let Ok(Object::Name(n)) = dict.get(b"AS") {
            return String::from_utf8_lossy(n).to_string();
        }
    }
    match dict.get(b"V") {
        Ok(Object::String(s, _)) => pdf_str(s),
        // 复选框/单选的 /V 是 Name（/Off 或 on 状态名）
        Ok(Object::Name(n)) => String::from_utf8_lossy(n).to_string(),
        Ok(Object::Reference(id)) => match doc.get_object(*id) {
            Ok(Object::String(s, _)) => pdf_str(s),
            Ok(Object::Name(n)) => String::from_utf8_lossy(n).to_string(),
            _ => String::new(),
        },
        _ => String::new(),
    }
}

fn field_options(dict: &Dictionary) -> Vec<String> {
    let Ok(Object::Array(arr)) = dict.get(b"Opt") else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|o| match o {
            Object::String(s, _) => Some(pdf_str(s)),
            Object::Array(pair) => pair.first().and_then(|v| match v {
                Object::String(s, _) => Some(pdf_str(s)),
                _ => None,
            }),
            _ => None,
        })
        .collect()
}
