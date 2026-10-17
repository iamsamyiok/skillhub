//! watermark：中央斜向半透明文字水印（中文用 Type0 + UniGB-UCS2-H，阅读器字体替换渲染）。
use crate::common::*;
use clap::Args;
use lopdf::{Dictionary, Object, StringFormat};
use serde::Serialize;

#[derive(Args)]
pub struct WatermarkArgs {
    /// PDF 文件路径
    pub file: String,
    /// 输出文件（缺省原地覆盖输入）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 水印文字（支持中文）
    #[arg(short, long)]
    pub text: String,
    /// 页范围，默认 all
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 旋转角度，默认 45
    #[arg(long, default_value = "45", allow_hyphen_values = true)]
    pub angle: f64,
    /// 不透明度 0..1，默认 0.15
    #[arg(long, default_value = "0.15")]
    pub opacity: f64,
    /// 字号（pt），默认 48
    #[arg(long, default_value = "48")]
    pub size: f64,
    /// 颜色 "r,g,b"（0..1），默认 0.55,0.55,0.55
    #[arg(long, default_value = "0.55,0.55,0.55")]
    pub color: String,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct WatermarkReport {
    file: String,
    text: String,
    pages_marked: usize,
}

pub fn run(args: WatermarkArgs) -> CmdResult<()> {
    if args.text.trim().is_empty() {
        return Err("水印文字不能为空".into());
    }
    let (r, g, b) = parse_color(&args.color)?;
    let opacity = args.opacity.clamp(0.0, 1.0);
    let angle = args.angle.to_radians();

    let mut doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let targets = parse_page_ranges(&args.pages, total)?;
    let all = ordered_pages(&doc);

    // 全局共享的字体与图形状态对象
    let font_id = build_cjk_font(&mut doc);
    let gs_id = build_opacity_state(&mut doc, opacity);

    let hex = utf16be_hex(&args.text);
    let width_em: f64 = args
        .text
        .chars()
        .map(|c| if c.is_ascii() { 0.5 } else { 1.0 })
        .sum();
    let text_w = width_em * args.size;

    let mut marked = 0usize;
    for p in targets {
        let page_id = all[p - 1];
        let mb = page_media_box(&doc, page_id)
            .ok_or_else(|| format!("第 {p} 页缺少 MediaBox，无法计算水印位置"))?;
        let cx = (mb[0] + mb[2]) / 2.0;
        let cy = (mb[1] + mb[3]) / 2.0;

        // 规范化页面 Resources 为间接对象并注入 Font / ExtGState
        let res_id = ensure_page_resources(&mut doc, page_id)?;
        {
            let res = doc
                .get_object_mut(res_id)
                .map_err(|e| format!("Resources 写入失败: {e}"))?
                .as_dict_mut()
                .map_err(|_| "Resources 不是字典".to_string())?;
            if !matches!(res.get(b"Font"), Ok(Object::Dictionary(_)) | Ok(Object::Reference(_))) {
                res.set(b"Font", Object::Dictionary(Dictionary::new()));
            }
            if let Ok(Object::Dictionary(fonts)) = res.get_mut(b"Font") {
                fonts.set(b"Fwm", Object::Reference(font_id));
            }
            if !matches!(res.get(b"ExtGState"), Ok(Object::Dictionary(_)) | Ok(Object::Reference(_))) {
                res.set(b"ExtGState", Object::Dictionary(Dictionary::new()));
            }
            if let Ok(Object::Dictionary(gs)) = res.get_mut(b"ExtGState") {
                gs.set(b"GSwm", Object::Reference(gs_id));
            }
        }

        // 内容流：平移到页心 → 旋转 → 居中文本
        let (a, bb) = (angle.cos(), angle.sin());
        let tx = -text_w / 2.0;
        let ty = -args.size * 0.35;
        let content = format!(
            "q\n/GSwm gs\n{r:.3} {g:.3} {b:.3} rg\n1 0 0 1 {cx:.2} {cy:.2} cm\n{a:.5} {bb:.5} {neg_b:.5} {a:.5} 0 0 cm\nBT /Fwm {size:.1} Tf {tx:.2} {ty:.2} Td <{hex}> Tj ET\nQ\n",
            neg_b = -bb,
            size = args.size,
        );
        doc.add_page_contents(page_id, content.into_bytes())
            .map_err(|e| format!("第 {p} 页水印注入失败: {e}"))?;
        marked += 1;
    }

    let out = args.output.clone().unwrap_or_else(|| args.file.clone());
    save_atomic(&mut doc, &out)?;
    print_json(&WatermarkReport {
        file: out,
        text: args.text.clone(),
        pages_marked: marked,
    });
    Ok(())
}

fn parse_color(s: &str) -> CmdResult<(f64, f64, f64)> {
    let parts: Vec<f64> = s
        .split(',')
        .map(|p| p.trim().parse::<f64>().map(|v| v.clamp(0.0, 1.0)))
        .collect::<Result<_, _>>()
        .map_err(|_| format!("颜色格式错误: {s:?}（应为 \"r,g,b\"，取值 0..1）"))?;
    if parts.len() != 3 {
        return Err(format!("颜色需要 3 个分量: {s:?}"));
    }
    Ok((parts[0], parts[1], parts[2]))
}

/// 构建非嵌入 CJK 字体（Type0 / UniGB-UCS2-H / STSong-Light）。
/// 阅读器通过预定义 CMap + 字体替换渲染中文；不支持替换的阅读器可能不显示。
fn build_cjk_font(doc: &mut lopdf::Document) -> lopdf::ObjectId {
    let mut fd = Dictionary::new();
    fd.set(b"Type", Object::Name(b"FontDescriptor".to_vec()));
    fd.set(b"FontName", Object::Name(b"STSong-Light".to_vec()));
    fd.set(b"Flags", Object::Integer(6));
    fd.set(
        b"FontBBox",
        Object::Array(vec![
            Object::Integer(0),
            Object::Integer(-200),
            Object::Integer(1000),
            Object::Integer(900),
        ]),
    );
    fd.set(b"ItalicAngle", Object::Integer(0));
    fd.set(b"Ascent", Object::Integer(800));
    fd.set(b"Descent", Object::Integer(-200));
    fd.set(b"CapHeight", Object::Integer(700));
    fd.set(b"StemV", Object::Integer(80));
    let fd_id = doc.add_object(Object::Dictionary(fd));

    let mut sys = Dictionary::new();
    sys.set(b"Registry", Object::String(b"Adobe".to_vec(), StringFormat::Literal));
    sys.set(b"Ordering", Object::String(b"GB1".to_vec(), StringFormat::Literal));
    sys.set(b"Supplement", Object::Integer(5));

    let mut cid = Dictionary::new();
    cid.set(b"Type", Object::Name(b"Font".to_vec()));
    cid.set(b"Subtype", Object::Name(b"CIDFontType2".to_vec()));
    cid.set(b"BaseFont", Object::Name(b"STSong-Light".to_vec()));
    cid.set(b"CIDSystemInfo", Object::Dictionary(sys));
    cid.set(b"FontDescriptor", Object::Reference(fd_id));
    cid.set(b"DW", Object::Integer(1000));
    let cid_id = doc.add_object(Object::Dictionary(cid));

    let mut font = Dictionary::new();
    font.set(b"Type", Object::Name(b"Font".to_vec()));
    font.set(b"Subtype", Object::Name(b"Type0".to_vec()));
    font.set(b"BaseFont", Object::Name(b"STSong-Light".to_vec()));
    font.set(b"Encoding", Object::Name(b"UniGB-UCS2-H".to_vec()));
    font.set(
        b"DescendantFonts",
        Object::Array(vec![Object::Reference(cid_id)]),
    );
    doc.add_object(Object::Dictionary(font))
}

fn build_opacity_state(doc: &mut lopdf::Document, opacity: f64) -> lopdf::ObjectId {
    let mut gs = Dictionary::new();
    gs.set(b"Type", Object::Name(b"ExtGState".to_vec()));
    gs.set(b"CA", Object::Real(opacity as f32));
    gs.set(b"ca", Object::Real(opacity as f32));
    doc.add_object(Object::Dictionary(gs))
}

/// 确保页面 Resources 是间接对象并返回其 id。
fn ensure_page_resources(doc: &mut lopdf::Document, page_id: lopdf::ObjectId) -> CmdResult<lopdf::ObjectId> {
    enum ResState {
        Ref(lopdf::ObjectId),
        Inline(Dictionary),
        Missing,
    }
    let state = {
        let page = doc
            .get_dictionary(page_id)
            .map_err(|e| format!("页面对象读取失败: {e}"))?;
        match page.get(b"Resources") {
            Ok(Object::Reference(id)) => ResState::Ref(*id),
            Ok(Object::Dictionary(d)) => ResState::Inline(d.clone()),
            _ => ResState::Missing,
        }
    };
    let res_id = match state {
        ResState::Ref(id) => id,
        ResState::Inline(d) => doc.add_object(Object::Dictionary(d)),
        ResState::Missing => doc.add_object(Object::Dictionary(Dictionary::new())),
    };
    let page = doc
        .get_object_mut(page_id)
        .map_err(|e| format!("页面对象写入失败: {e}"))?
        .as_dict_mut()
        .map_err(|_| "页面对象不是字典".to_string())?;
    page.set(b"Resources", Object::Reference(res_id));
    Ok(res_id)
}

/// 文本 → UTF-16BE 十六进制串（Identity 2 字节编码）。
fn utf16be_hex(s: &str) -> String {
    let mut out = String::new();
    for u in s.encode_utf16() {
        out.push_str(&format!("{u:04X}"));
    }
    out
}
