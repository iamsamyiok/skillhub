//! images：提取 PDF 内嵌图片（替代 pdfimages）。
//!
//! 遍历页面 /Resources/XObject 中的 Image 流：
//! - DCTDecode（JPEG）：原始流直接落盘 .jpg（无损，无重编码损耗）
//! - FlateDecode（位图）：解码原始样本后手写 PNG 封装（zlib + CRC32）
//!
//! 覆盖不到的格式（JPXDecode/CCITTFaxDecode/JBIG2 等）与 CMYK/Indexed
//! 色彩空间在 JSON 报告中如实标注 skipped 原因，不假装成功。
use crate::common::*;
use clap::Args;
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;
use std::io::Write as _;
use std::path::Path;

#[derive(Args)]
pub struct ImagesArgs {
    /// PDF 文件路径
    pub file: String,
    /// 页范围，默认 all
    #[arg(long, default_value = "all")]
    pub pages: String,
    /// 输出目录（缺省 <文件名去扩展名>-images/）
    #[arg(short, long)]
    pub output: Option<String>,
    /// 最小边长（像素），短边小于该值的图片跳过（默认 16，滤掉装饰性 1px 图）
    #[arg(long, default_value = "16")]
    pub min_size: u32,
    /// 加密文档密码
    #[arg(long)]
    pub password: Option<String>,
}

#[derive(Serialize)]
struct ImageOut {
    page: usize,
    name: String,
    file: String,
    width: u32,
    height: u32,
    kind: &'static str,
    bytes: usize,
}

#[derive(Serialize)]
struct SkippedOut {
    page: usize,
    name: String,
    reason: String,
}

#[derive(Serialize)]
struct ImagesReport {
    file: String,
    output: String,
    extracted: Vec<ImageOut>,
    skipped: Vec<SkippedOut>,
}

pub fn run(args: ImagesArgs) -> CmdResult<()> {
    let doc = load_doc(&args.file, args.password.as_deref())?;
    let total = page_count(&doc);
    let pages = if args.pages == "all" {
        (1..=total).collect::<Vec<usize>>()
    } else {
        parse_page_ranges(&args.pages, total)?
    };
    let out_dir = args.output.clone().unwrap_or_else(|| {
        let stem = Path::new(&args.file)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "images".into());
        format!("{stem}-images")
    });
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("创建输出目录 {out_dir} 失败: {e}"))?;

    let page_map = pages_1based(&doc);
    let mut extracted = Vec::new();
    let mut skipped = Vec::new();

    for pno in &pages {
    let Some(&page_id) = page_map.get(&(*pno as u32)) else {
        continue;
    };
    // 收集本页 XObject 中的图片流（含继承自 Pages 节点的 Resources）
    let xobjects = collect_xobject_images(&doc, page_id);
    for (name, obj_id) in xobjects {
        let Ok(Object::Stream(stream)) = doc.get_object(obj_id) else {
            continue;
        };
        let dict = &stream.dict;
        if dict.get(b"Subtype").and_then(|o| o.as_name()).ok() != Some(b"Image") {
            continue;
        }
        let width = dict.get(b"Width").and_then(|o| o.as_i64()).unwrap_or(0) as u32;
        let height = dict.get(b"Height").and_then(|o| o.as_i64()).unwrap_or(0) as u32;
        // /Filter 可能是单个名或名数组；数据流按数组正序逐层解码，
        // 遇到 DCTDecode 等图像编码层即止（其后内容就是目标格式）
        let filters = parse_filters(dict);
        let name_str = String::from_utf8_lossy(&name).to_string();
        let label = format!("p{pno}-{name_str}");

        if width < args.min_size || height < args.min_size {
            skipped.push(SkippedOut {
                page: *pno,
                name: name_str,
                reason: format!("尺寸 {width}x{height} 小于 min-size {}", args.min_size),
            });
            continue;
        }
        match decode_stream(&stream.content, &filters) {
            Ok(Decoded::Jpeg(bytes)) => {
                let fname = format!("{out_dir}/{label}.jpg");
                std::fs::write(&fname, &bytes)
                    .map_err(|e| format!("写入 {fname} 失败: {e}"))?;
                extracted.push(ImageOut {
                    page: *pno,
                    name: name_str,
                    file: fname,
                    width,
                    height,
                    kind: "jpeg",
                    bytes: bytes.len(),
                });
            }
            Ok(Decoded::Bitmap(raw)) => match encode_png(&raw, width, height, dict) {
                Ok(png) => {
                    let fname = format!("{out_dir}/{label}.png");
                    std::fs::write(&fname, &png)
                        .map_err(|e| format!("写入 {fname} 失败: {e}"))?;
                    extracted.push(ImageOut {
                        page: *pno,
                        name: name_str,
                        file: fname,
                        width,
                        height,
                        kind: "png",
                        bytes: png.len(),
                    });
                }
                Err(reason) => skipped.push(SkippedOut {
                    page: *pno,
                    name: name_str,
                    reason,
                }),
            },
            Err(reason) => skipped.push(SkippedOut {
                page: *pno,
                name: name_str,
                reason,
            }),
        }
    }
}

    print_json(&ImagesReport {
        file: args.file.clone(),
        output: out_dir,
        extracted,
        skipped,
    });
    Ok(())
}

/// 收集页面（含继承 Resources）XObject 中的图片流 (name, id)。
/// lopdf 的 get_page_resources 已处理页树继承：返回页上直接内嵌的
/// Resources 字典 + 祖先链上的 Resources 引用 id 列表。
/// SMask 不在 XObject 字典里（它是图像字典的一个条目），天然不会重复导出。
fn collect_xobject_images(doc: &Document, page_id: ObjectId) -> Vec<(Vec<u8>, ObjectId)> {
    let mut out = Vec::new();
    let Ok((page_res, ancestor_ids)) = doc.get_page_resources(page_id) else {
        return out;
    };
    if let Some(res) = page_res {
        if let Ok(Object::Dictionary(xo)) = res.get(b"XObject") {
            collect_images_from_xobject_dict(xo, &mut out);
        }
    }
    for rid in ancestor_ids {
        if let Ok(Object::Dictionary(res)) = doc.get_object(rid) {
            if let Ok(Object::Dictionary(xo)) = res.get(b"XObject") {
                collect_images_from_xobject_dict(xo, &mut out);
            }
        }
    }
    out
}

fn collect_images_from_xobject_dict(xo: &Dictionary, out: &mut Vec<(Vec<u8>, ObjectId)>) {
    for (name, obj) in xo.iter() {
        if let Ok(id) = obj.as_reference() {
            out.push((name.clone(), id));
        }
    }
}

/// 解析 /Filter：单个过滤器名或名数组（按数组正序即数据流的解码顺序）。
fn parse_filters(dict: &Dictionary) -> Vec<String> {
    match dict.get(b"Filter") {
        Ok(Object::Name(n)) => vec![String::from_utf8_lossy(n).to_string()],
        Ok(Object::Array(a)) => a
            .iter()
            .filter_map(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n).to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// 逐层解码的结果。
enum Decoded {
    /// JPEG 字节（DCTDecode 层之后的内容，可直接落盘）
    Jpeg(Vec<u8>),
    /// 原始位图样本（全部过滤器解完后）
    Bitmap(Vec<u8>),
}

/// 按过滤器链逐层解码。ASCII85Decode/FlateDecode 解到目标；
/// DCTDecode 为图像编码层——剥掉其前的压缩层后即为 JPEG，不再深解。
/// 其他过滤器（JPX/CCITT/JBIG2/LZW 等）返回 Err(reason) 记入 skipped。
fn decode_stream(content: &[u8], filters: &[String]) -> Result<Decoded, String> {
    let mut data = content.to_vec();
    for f in filters {
        match f.as_str() {
            "ASCII85Decode" => data = a85_decode(&data)?,
            "ASCIIHexDecode" => data = ahx_decode(&data)?,
            "FlateDecode" => {
                use flate2::read::ZlibDecoder;
                use std::io::Read as _;
                let mut out = Vec::new();
                ZlibDecoder::new(&data[..])
                    .read_to_end(&mut out)
                    .map_err(|e| format!("FlateDecode 解码失败: {e}"))?;
                data = out;
            }
            "DCTDecode" => return Ok(Decoded::Jpeg(data)),
            other => {
                return Err(format!(
                    "不支持的过滤器 {other}（支持 ASCII85/ASCIIHex/Flate/DCT）"
                ))
            }
        }
    }
    Ok(Decoded::Bitmap(data))
}

/// ASCII85 解码（Adobe 变体：'z' 表示 4 个 0 字节，'~>' 结束，空白忽略）。
/// 注意：'<' 是合法数据字符（值 60），仅数据**开头**的 `<~` 是定界符，
/// 中间的 '<' 必须按普通字符处理（reportlab 的流常以 `<~` 开头但 pypdf 等
/// 读取器可能已剥掉，此处两种都兼容）。
fn a85_decode(data: &[u8]) -> Result<Vec<u8>, String> {
    let data = if data.starts_with(b"<~") { &data[2..] } else { data };
    let mut out = Vec::new();
    let mut tuple: u32 = 0;
    let mut count = 0usize;
    for &b in data {
        match b {
            b' ' | b'\n' | b'\r' | b'\t' | 0x0C => continue,
            b'z' if count == 0 => out.extend_from_slice(&[0, 0, 0, 0]),
            b'~' => break, // '~>' EOD 标记（'>' 不在合法字符集，由本 break 覆盖）
            c if (33..=117).contains(&c) => {
                tuple = tuple * 85 + (c - 33) as u32;
                count += 1;
                if count == 5 {
                    out.extend_from_slice(&tuple.to_be_bytes());
                    tuple = 0;
                    count = 0;
                }
            }
            _ => return Err("ASCII85 数据含非法字符".into()),
        }
    }
    if count > 0 {
        // 补齐并丢弃多余字节（Adobe 规范：部分组按前 count-1 字节输出）
        for _ in count..5 {
            tuple = tuple * 85 + 84;
        }
        let bytes = tuple.to_be_bytes();
        out.extend_from_slice(&bytes[..count - 1]);
    }
    Ok(out)
}

/// ASCIIHexDecode 解码（'>' 结束，空白忽略，奇数位补 '0'）。
fn ahx_decode(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut hi: Option<u8> = None;
    for &b in data {
        match b {
            b'>' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            c => {
                let v = match c {
                    b'0'..=b'9' => c - b'0',
                    b'a'..=b'f' => c - b'a' + 10,
                    b'A'..=b'F' => c - b'A' + 10,
                    _ => return Err("ASCIIHex 数据含非法字符".into()),
                };
                match hi.take() {
                    Some(h) => out.push((h << 4) | v),
                    None => hi = Some(v),
                }
            }
        }
    }
    if let Some(h) = hi {
        out.push(h << 4); // 奇数位补 0
    }
    Ok(out)
}

/// 把原始样本封装为 PNG。支持 DeviceRGB/DeviceGray（及 ICCBased 的 N 通道）。
/// Indexed/CMYK 等返回 Err(reason) 由调用方记入 skipped。
fn encode_png(raw: &[u8], width: u32, height: u32, dict: &Dictionary) -> Result<Vec<u8>, String> {
    let channels = color_channels(dict)?;
    let expected = width as usize * height as usize * channels;
    if raw.len() < expected {
        return Err(format!(
            "样本数不足：需 {expected} 字节（{width}x{height}x{channels}），实得 {}",
            raw.len()
        ));
    }
    // 每行前置 filter byte 0（None），zlib 整体压缩
    let bpp = channels as u16; // 8bit 通道
    let mut scanlines = Vec::with_capacity(raw.len() + height as usize);
    for row in 0..height as usize {
        scanlines.push(0u8);
        let start = row * width as usize * channels;
        scanlines.extend_from_slice(&raw[start..start + width as usize * channels]);
    }
    use flate2::{Compression, write::ZlibEncoder};
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
    enc.write_all(&scanlines)
        .map_err(|e| format!("PNG 压缩失败: {e}"))?;
    let idat = enc.finish().map_err(|e| format!("PNG 压缩失败: {e}"))?;

    let mut png = Vec::with_capacity(idat.len() + 64);
    png.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    // IHDR
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(match channels {
        1 => 0, // grayscale
        3 => 2, // truecolor RGB
        _ => return Err(format!("不支持的通道数 {channels}")),
    });
    ihdr.push(0); // compression
    ihdr.push(0); // filter
    ihdr.push(0); // interlace
    write_chunk(&mut png, b"IHDR", &ihdr);
    write_chunk(&mut png, b"IDAT", &idat);
    write_chunk(&mut png, b"IEND", &[]);
    let _ = bpp;
    Ok(png)
}

/// 从 /ColorSpace 推断通道数。
fn color_channels(dict: &Dictionary) -> Result<usize, String> {
    let cs = dict
        .get(b"ColorSpace")
        .map_err(|_| "缺少 /ColorSpace".to_string())?;
    match cs {
        Object::Name(n) => match n.as_slice() {
            b"DeviceRGB" | b"RGB" => Ok(3),
            b"DeviceGray" | b"G" => Ok(1),
            b"DeviceCMYK" | b"CMYK" => Err("CMYK 色彩空间暂不支持导出 PNG".into()),
            other => Err(format!(
                "不支持的色彩空间 {}",
                String::from_utf8_lossy(other)
            )),
        },
        Object::Array(a) => {
            // ICCBased [name dict] → 读 dict /N
            if let Some(Object::Name(n)) = a.first() {
                if n == b"ICCBased" {
                    if let Some(Object::Dictionary(d)) = a.get(1) {
                        if let Ok(n) = d.get(b"N").and_then(|o| o.as_i64()) {
                            return Ok(n as usize);
                        }
                    }
                }
                if n == b"Indexed" || n == b"IndexedSep" || n == b"Separation" || n == b"DeviceN"
                {
                    return Err(format!(
                        "{} 色彩空间需调色板/分量映射，暂不支持",
                        String::from_utf8_lossy(n)
                    ));
                }
            }
            Err("无法解析的色彩空间数组".into())
        }
        Object::Reference(id) => {
            // 间接引用：调用方应传入已解析字典；这里保守报错
            Err(format!("色彩空间为间接引用（对象 {id:?}），暂不支持"))
        }
        _ => Err("无法解析 /ColorSpace".into()),
    }
}

/// PNG 分块：length + type + data + CRC32(type+data)。
fn write_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

/// CRC32（IEEE 802.3，与 PNG 规范一致）。
fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, t) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *t = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a85_decode_reportlab_real_stream() {
        // 来自 tests/fixtures/images.pdf 第 2 页的真实流（reportlab 生成，
        // /ASCII85Decode /FlateDecode，纯色 PNG 100x60 RGB）。
        // 该流第 4 个字符就是合法数据字符 '<'——曾因误判定界符被截断。
        let raw = b"Gb\"0<!=8`+$j3.L$b\"!3oc+4UFAZ%<<E3%!<E3%!<E3%!<E8_l\".8IMZi~>";
        let dec = a85_decode(raw).expect("A85 解码失败");
        assert_eq!(dec.len(), 45, "应解出 45 字节 zlib 流");
        // zlib 头 0x78 0x9c
        assert_eq!(&dec[..2], &[0x78, 0x9c]);
        // 完整链路：zlib 解压应得 18000 字节位图
        use flate2::read::ZlibDecoder;
        use std::io::Read as _;
        let mut out = Vec::new();
        ZlibDecoder::new(&dec[..]).read_to_end(&mut out).expect("zlib 失败");
        assert_eq!(out.len(), 100 * 60 * 3);
        // 首像素应为 PIL 纯蓝 (30,90,200) 的某排列——验证是真实位图数据
        assert!(out.iter().any(|&b| b != 0), "位图不应全 0");
    }

    #[test]
    fn a85_decode_with_delimiters_and_z() {
        // <~ 前缀 + z 简写（4 个 0）+ 尾组 3 字符输出 2 字节 + ~> 结尾。
        // 与 Python base64.a85decode(b'z!!!') == [0,0,0,0,0,0] 行为一致。
        let dec = a85_decode(b"<~z!!!~>").expect("A85 解码失败");
        assert_eq!(dec, vec![0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn ahx_decode_basic() {
        assert_eq!(ahx_decode(b"48656C6C6F>").unwrap(), b"Hello");
        assert_eq!(ahx_decode(b"ABC>").unwrap(), vec![0xAB, 0xC0]); // 奇数位补 0
    }

    #[test]
    fn png_chunk_crc_matches_known_value() {
        // PNG 规范附录：IHDR 空数据的 CRC 已知值场景太复杂，
        // 这里验证 CRC32 对 "IEND"+"123456789" 的经典测试向量：
        // crc32("123456789") = 0xCBF43926
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn encode_png_rejects_cmyk() {
        let mut d = Dictionary::new();
        d.set("ColorSpace", Object::Name(b"DeviceCMYK".to_vec()));
        let err = encode_png(&[0u8; 64], 4, 4, &d).unwrap_err();
        assert!(err.contains("CMYK"));
    }

    #[test]
    fn encode_png_rgb_roundtrip_structure() {
        let mut d = Dictionary::new();
        d.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        let raw = vec![255u8; 2 * 2 * 3];
        let png = encode_png(&raw, 2, 2, &d).expect("RGB 应成功");
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(&png[12..16], b"IHDR");
        assert!(png.windows(4).any(|w| w == b"IDAT"));
        assert!(png.windows(4).any(|w| w == b"IEND"));
    }
}
