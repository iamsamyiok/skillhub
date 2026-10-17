//! pdfctl — Rust PDF 编辑工具集。
//! 子命令：info / merge / split / rotate / delete / extract / reorder /
//!         metadata / encrypt / decrypt / text / validate / watermark /
//!         table / create / ocr / images / forms
mod commands;
mod common;
mod mineru;

use clap::{Parser, Subcommand};
use common::{CmdResult, EXIT_RUNTIME};

#[derive(Parser)]
#[command(
    name = "pdfctl",
    version,
    about = "Rust PDF 编辑工具集（页树操作 / 元数据 / 加解密 / 文本提取 / 水印 / 表格 / 创建 / OCR / 图片 / 表单）",
    long_about = "基于 lopdf 的纯 Rust PDF 工具。所有命令默认输出 JSON；\n\
                  页范围语法: all | 1-3,5 | 3-end（1-based）。"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 读取 PDF 结构信息（页数/尺寸/元数据/加密状态/书签数）
    Info(commands::info::InfoArgs),
    /// 合并多个 PDF（保持输入顺序）
    Merge(commands::merge::MergeArgs),
    /// 按页范围或逐页拆分
    Split(commands::split::SplitArgs),
    /// 旋转页面
    Rotate(commands::rotate::RotateArgs),
    /// 删除指定页
    Delete(commands::delete::DeleteArgs),
    /// 提取指定页为新 PDF
    Extract(commands::extract::ExtractArgs),
    /// 按给定顺序重排页面
    Reorder(commands::reorder::ReorderArgs),
    /// 读取/写入元数据
    Metadata(commands::metadata::MetadataArgs),
    /// 加密（rc4-40 / rc4-128 / aes-128 / aes-256）
    Encrypt(commands::encrypt::EncryptArgs),
    /// 解密（输出明文）
    Decrypt(commands::decrypt::DecryptArgs),
    /// 提取文本
    Text(commands::text::TextArgs),
    /// 结构校验
    Validate(commands::validate::ValidateArgs),
    /// 添加斜向半透明水印（支持中文）
    Watermark(commands::watermark::WatermarkArgs),
    /// 提取表格（pdfplumber 风格四策略，输出 json/csv/markdown）
    Table(commands::table::TableArgs),
    /// 从 JSON 规格生成 PDF（标题/段落/列表/表格/分页，--font 支持中文）
    Create(commands::create::CreateArgs),
    /// MinerU 云端 OCR / 文档解析（扫描件、表格、公式；文件上传 mineru.net）
    Ocr(commands::ocr::OcrArgs),
    /// 提取内嵌图片（DCTDecode 直出 jpg，FlateDecode 封装 png）
    Images(commands::images::ImagesArgs),
    /// AcroForm 表单读取与填写（list / set）
    Forms(commands::forms::FormsArgs),
}

fn main() {
    let cli = Cli::parse();
    let result: CmdResult<()> = match cli.command {
        Command::Info(a) => commands::info::run(a),
        Command::Merge(a) => commands::merge::run(a),
        Command::Split(a) => commands::split::run(a),
        Command::Rotate(a) => commands::rotate::run(a),
        Command::Delete(a) => commands::delete::run(a),
        Command::Extract(a) => commands::extract::run(a),
        Command::Reorder(a) => commands::reorder::run(a),
        Command::Metadata(a) => commands::metadata::run(a),
        Command::Encrypt(a) => commands::encrypt::run(a),
        Command::Decrypt(a) => commands::decrypt::run(a),
        Command::Text(a) => commands::text::run(a),
        Command::Validate(a) => commands::validate::run(a),
        Command::Watermark(a) => commands::watermark::run(a),
        Command::Table(a) => commands::table::run(a),
        Command::Create(a) => commands::create::run(a),
        Command::Ocr(a) => commands::ocr::run(a),
        Command::Images(a) => commands::images::run(a),
        Command::Forms(a) => commands::forms::run(a),
    };
    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(EXIT_RUNTIME);
    }
}
