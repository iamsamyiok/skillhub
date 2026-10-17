//! MinerU 云 API 客户端（OCR / 文档解析）。
//!
//! 双模式自适应（有 Token 走标准版，无 Token 走免登录轻量版）：
//!
//! - **免登录 Agent 轻量版**（默认）：`POST /api/v1/agent/parse/file`
//!   签名上传 → PUT bytes → 轮询 `GET /api/v1/agent/parse/{task_id}` →
//!   下载 markdown_url。限制 10MB / 20 页，禁表格/公式识别，每日 1 万页/IP。
//! - **标准版**（`MINERU_TOKEN` 或 `--token`）：`POST /api/v4/file-urls/batch`
//!   → PUT bytes → 轮询 `GET /api/v4/extract-results/batch/{batch_id}` →
//!   下载 full_zip_url（zip 内 full.md + 结构化 JSON）。限制 200MB / 200 页，
//!   vlm 模型表格/公式全支持，每日 2000 页/账号。
//!
//! 链路依据 mineru.net 官方文档（2026-10 实测）：
//! - https://mineru.net/doc/docs（agent 轻量版）
//! - https://mineru.net/doc/docs/index_pro（标准版）
//!
//! 设计取舍：用阻塞式 ureq（rustls）而非 reqwest——CLI 单次调用场景不需要
//! 异步运行时，避免引入 tokio 一大票传递依赖，守住「单二进制」体积。

use std::io::Read;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const AGENT_FILE_URL: &str = "https://mineru.net/api/v1/agent/parse/file";
const AGENT_TASK_URL: &str = "https://mineru.net/api/v1/agent/parse";
const STD_BATCH_URL: &str = "https://mineru.net/api/v4/file-urls/batch";
const STD_RESULT_URL: &str = "https://mineru.net/api/v4/extract-results/batch";

/// agent 轻量版文件大小上限（10MB，官网限制）。
pub const AGENT_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// 标准版文件大小上限（200MB，官网限制）。
pub const STD_MAX_BYTES: u64 = 200 * 1024 * 1024;
/// agent 轻量版页数上限（20 页，官网限制）。
pub const AGENT_MAX_PAGES: usize = 20;
/// 标准版页数上限（200 页，按 apiManage/docs 保守口径）。
pub const STD_MAX_PAGES: usize = 200;

/// 一次解析的结果。
pub struct ParseResult {
    /// full.md 内容（结构化 Markdown，含表格/公式/标题层级）。
    pub markdown: String,
    /// 实际使用的模式（用于 JSON 报告与 stderr 提示）。
    pub mode: &'static str,
    /// 标准版 zip 内的附带文件（如结构化 JSON），agent 版为空。
    pub extra_files: Vec<(String, Vec<u8>)>,
}

pub struct MinerU {
    token: Option<String>,
    /// 单次 HTTP 请求超时（秒）。
    http_timeout: u64,
    /// 轮询总超时（秒）。
    poll_timeout: u64,
}

impl MinerU {
    pub fn new(token: Option<String>) -> Self {
        Self {
            token: token.filter(|t| !t.trim().is_empty()),
            http_timeout: 120,
            poll_timeout: 300,
        }
    }

    pub fn with_timeouts(mut self, http_secs: u64, poll_secs: u64) -> Self {
        self.http_timeout = http_secs.max(5);
        self.poll_timeout = poll_secs.max(10);
        self
    }

    /// 是否有 Token（决定模式）。
    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    fn agent(&self) -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(self.http_timeout))
            .timeout_write(Duration::from_secs(self.http_timeout))
            .build()
    }

    /// 主入口：上传文件字节，返回解析结果。
    /// `language`： MinerU OCR 语言（ch/en/korean/japan/...）。
    /// `is_ocr`： 是否强制 OCR（false = 自动识别，官网推荐默认）。
    pub fn parse_file(
        &self,
        file_name: &str,
        bytes: &[u8],
        language: &str,
        is_ocr: bool,
    ) -> Result<ParseResult, String> {
        match &self.token {
            Some(t) => self.parse_standard(file_name, bytes, language, is_ocr, t),
            None => self.parse_agent(file_name, bytes, language, is_ocr),
        }
    }

    // ---------------------------------------------------------------- agent 轻量版

    fn parse_agent(
        &self,
        file_name: &str,
        bytes: &[u8],
        language: &str,
        is_ocr: bool,
    ) -> Result<ParseResult, String> {
        if bytes.len() as u64 > AGENT_MAX_BYTES {
            return Err(format!(
                "文件 {}（{} 字节）超过免登录轻量版 10MB 上限。请配置 MINERU_TOKEN 走标准版（200MB），或用 --pages 缩小范围。",
                file_name,
                bytes.len()
            ));
        }
        let ag = self.agent();
        // 1) 申请签名上传 URL
        let resp = ag
            .post(AGENT_FILE_URL)
            .set("Content-Type", "application/json")
            .send_string(&serde_json::to_string(&json!({
                "file_name": file_name,
                "language": language,
                "is_ocr": is_ocr,
            })).unwrap())
            .map_err(|e| format!("MinerU 上传申请失败: {}", describe_ureq(e)))?;
        let body = read_json(resp)?;
        let file_url = body["data"]["file_url"]
            .as_str()
            .ok_or("MinerU 上传申请响应缺少 data.file_url")?
            .to_string();
        let task_id = body["data"]["task_id"]
            .as_str()
            .ok_or("MinerU 上传申请响应缺少 data.task_id")?
            .to_string();
        // 2) PUT 上传（OSS 签名 URL；不设 Content-Type，官网明确要求）
        ag.put(&file_url)
            .send_bytes(bytes)
            .map_err(|e| format!("MinerU 文件上传失败: {}", describe_ureq(e)))?;
        // 3) 轮询
        let markdown_url = self.poll_agent(&task_id)?;
        // 4) 下载 markdown
        let markdown = self.download_text(&markdown_url)?;
        Ok(ParseResult {
            markdown,
            mode: "agent",
            extra_files: Vec::new(),
        })
    }

    fn poll_agent(&self, task_id: &str) -> Result<String, String> {
        let url = format!("{AGENT_TASK_URL}/{task_id}");
        let ag = self.agent();
        let start = Instant::now();
        loop {
            let resp = ag
                .get(&url)
                .call()
                .map_err(|e| format!("MinerU 轮询失败: {}", describe_ureq(e)))?;
            let body = read_json(resp)?;
            if body["code"].as_i64() != Some(0) {
                return Err(format!(
                    "MinerU 任务查询报错: code={} msg={}",
                    body["code"], body["msg"]
                ));
            }
            let state = body["data"]["state"].as_str().unwrap_or("");
            match state {
                "done" => {
                    return body["data"]["markdown_url"]
                        .as_str()
                        .map(|s| s.to_string())
                        .ok_or_else(|| "MinerU 任务完成但响应缺少 data.markdown_url".to_string())
                }
                "failed" => {
                    let msg = body["data"]["err_msg"]
                        .as_str()
                        .or_else(|| body["data"]["msg"].as_str())
                        .unwrap_or("未知原因");
                    return Err(format!("MinerU 解析失败: {msg}"));
                }
                _ => {
                    if start.elapsed() > Duration::from_secs(self.poll_timeout) {
                        return Err(format!(
                            "MinerU 解析超时（{}s，state={state}）。大文件建议配置 Token 走高优先级通道或缩小 --pages。",
                            self.poll_timeout
                        ));
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }

    // ---------------------------------------------------------------- 标准版（Token）

    fn parse_standard(
        &self,
        file_name: &str,
        bytes: &[u8],
        language: &str,
        is_ocr: bool,
        token: &str,
    ) -> Result<ParseResult, String> {
        if bytes.len() as u64 > STD_MAX_BYTES {
            return Err(format!(
                "文件 {}（{} 字节）超过标准版 200MB 上限。",
                file_name,
                bytes.len()
            ));
        }
        let ag = self.agent();
        let auth = format!("Bearer {token}");
        // 1) 申请批量上传 URL（data_id 用去扩展名的文件名，返回时按序对应）
        let resp = ag
            .post(STD_BATCH_URL)
            .set("Content-Type", "application/json")
            .set("Authorization", &auth)
            .send_string(&serde_json::to_string(&json!({
                "enable_formula": true,
                "enable_table": true,
                "is_ocr": is_ocr,
                "language": language,
                "model_version": "vlm",
                "files": [{"name": file_name, "data_id": file_name}],
            })).unwrap())
            .map_err(|e| format!("MinerU 标准版上传申请失败: {}", describe_ureq(e)))?;
        let body = read_json(resp)?;
        if body["code"].as_i64() != Some(0) {
            return Err(format!(
                "MinerU 标准版上传申请报错: code={} msg={}（Token 是否有效？额度是否用尽？）",
                body["code"], body["msg"]
            ));
        }
        let batch_id = body["data"]["batch_id"]
            .as_str()
            .ok_or("MinerU 标准版响应缺少 data.batch_id")?
            .to_string();
        let put_url = body["data"]["file_urls"]
            .get(0)
            .and_then(|u| u["url"].as_str())
            .ok_or("MinerU 标准版响应缺少 data.file_urls[0].url")?
            .to_string();
        // 2) PUT 上传
        ag.put(&put_url)
            .send_bytes(bytes)
            .map_err(|e| format!("MinerU 标准版文件上传失败: {}", describe_ureq(e)))?;
        // 3) 轮询批量结果
        let zip_url = self.poll_standard(&batch_id, &auth)?;
        // 4) 下载 zip 并解出 full.md
        let zip_bytes = self.download_bytes(&zip_url)?;
        let (markdown, extra) = extract_zip(&zip_bytes)?;
        Ok(ParseResult {
            markdown,
            mode: "standard",
            extra_files: extra,
        })
    }

    fn poll_standard(&self, batch_id: &str, auth: &str) -> Result<String, String> {
        let url = format!("{STD_RESULT_URL}/{batch_id}");
        let ag = self.agent();
        let start = Instant::now();
        loop {
            let resp = ag
                .get(&url)
                .set("Authorization", auth)
                .call()
                .map_err(|e| format!("MinerU 标准版轮询失败: {}", describe_ureq(e)))?;
            let body = read_json(resp)?;
            if body["code"].as_i64() != Some(0) {
                return Err(format!(
                    "MinerU 标准版结果查询报错: code={} msg={}",
                    body["code"], body["msg"]
                ));
            }
            let state = body["data"]["extract_result"]
                .get(0)
                .and_then(|r| r["state"].as_str())
                .unwrap_or("");
            match state {
                "done" => {
                    return body["data"]["extract_result"][0]["full_zip_url"]
                        .as_str()
                        .map(|s| s.to_string())
                        .ok_or_else(|| {
                            "MinerU 标准版任务完成但缺少 full_zip_url".to_string()
                        })
                }
                "failed" => {
                    let msg = body["data"]["extract_result"][0]["err_msg"]
                        .as_str()
                        .unwrap_or("未知原因");
                    return Err(format!("MinerU 标准版解析失败: {msg}"));
                }
                _ => {
                    if start.elapsed() > Duration::from_secs(self.poll_timeout) {
                        return Err(format!(
                            "MinerU 标准版解析超时（{}s，state={state}）。",
                            self.poll_timeout
                        ));
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }

    // ---------------------------------------------------------------- 下载

    fn download_text(&self, url: &str) -> Result<String, String> {
        let bytes = self.download_bytes(url)?;
        String::from_utf8(bytes).map_err(|e| format!("MinerU 返回内容非 UTF-8: {e}"))
    }

    fn download_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        let ag = self.agent();
        let resp = ag
            .get(url)
            .call()
            .map_err(|e| format!("下载 {} 失败: {}", short_url(url), describe_ureq(e)))?;
        let mut reader = resp.into_reader();
        let mut buf = Vec::new();
        reader
            .read_to_end(&mut buf)
            .map_err(|e| format!("读取下载内容失败: {e}"))?;
        Ok(buf)
    }
}

// ---------------------------------------------------------------- 工具函数

/// 读取响应体为 JSON。
fn read_json(resp: ureq::Response) -> Result<Value, String> {
    let text = resp
        .into_string()
        .map_err(|e| format!("响应体读取失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("响应体非 JSON（{}）: {e}", snippet(&text)))
}

/// 从标准版结果 zip 中提取 full.md 与附带 JSON。
///
/// 自研最小 zip 读取器（仅读不解压整个包）：解析 EOCD → 中央目录 →
/// 按名定位条目 → local header 数据流 → flate2 解压。
/// 背景：zip crate 于 2026-10 遭批量 yank（135 个版本仅 9.0.3 存活），
/// 不值得为「解一个结果包」引入刚发布 3 天的新主线；ZIP 读取格式简单，
/// flate2 又已在依赖树（lopdf 传递依赖），自研反而零供应链风险。
fn extract_zip(zip_bytes: &[u8]) -> Result<(String, Vec<(String, Vec<u8>)>), String> {
    let entries = read_central_directory(zip_bytes)?;
    let mut markdown: Option<String> = None;
    let mut extra: Vec<(String, Vec<u8>)> = Vec::new();
    for e in &entries {
        // 只收根目录的文件（跳过 images/ 子目录与目录项）
        if e.name.ends_with('/') || e.name.contains('/') {
            continue;
        }
        let raw = extract_entry(zip_bytes, e)?;
        if e.name == "full.md" {
            markdown = Some(String::from_utf8_lossy(&raw).to_string());
        } else if e.name.ends_with(".json") {
            extra.push((e.name.clone(), raw));
        }
    }
    match markdown {
        Some(md) => Ok((md, extra)),
        None => Err("结果包中未找到 full.md".to_string()),
    }
}

/// 中央目录中的一个条目（只保留读取所需字段）。
#[derive(Debug)]
struct ZipEntry {
    name: String,
    method: u16,
    comp_size: u64,
    local_offset: u64,
}

/// 定位 EOCD 并遍历中央目录。
fn read_central_directory(data: &[u8]) -> Result<Vec<ZipEntry>, String> {
    if data.len() < 22 {
        return Err("结果包过小，不是合法 zip".to_string());
    }
    // EOCD 在文件尾部（可能有最长 64KB 的 zip 注释），从尾部向前搜签名
    let search_start = data.len().saturating_sub(22 + 64 * 1024);
    let mut eocd = None;
    let mut i = data.len() - 22;
    loop {
        if data[i..i + 4] == [0x50, 0x4b, 0x05, 0x06] {
            eocd = Some(i);
            break;
        }
        if i <= search_start {
            break;
        }
        i -= 1;
    }
    let eocd = eocd.ok_or("结果包中未找到 EOCD 记录，不是合法 zip")?;
    let total = u16::from_le_bytes([data[eocd + 10], data[eocd + 11]]) as usize;
    let cd_offset =
        u32::from_le_bytes([data[eocd + 16], data[eocd + 17], data[eocd + 18], data[eocd + 19]])
            as usize;
    if cd_offset + 46 > data.len() {
        return Err("zip 中央目录偏移越界".to_string());
    }
    let mut entries = Vec::with_capacity(total);
    let mut p = cd_offset;
    for _ in 0..total {
        if p + 46 > data.len() || data[p..p + 4] != [0x50, 0x4b, 0x01, 0x02] {
            return Err("zip 中央目录条目签名不匹配（文件可能损坏）".to_string());
        }
        let method = u16::from_le_bytes([data[p + 10], data[p + 11]]);
        let comp_size = u32::from_le_bytes([data[p + 20], data[p + 21], data[p + 22], data[p + 23]])
            as u64;
        let name_len = u16::from_le_bytes([data[p + 28], data[p + 29]]) as usize;
        let extra_len = u16::from_le_bytes([data[p + 30], data[p + 31]]) as usize;
        let comment_len = u16::from_le_bytes([data[p + 32], data[p + 33]]) as usize;
        let local_offset =
            u32::from_le_bytes([data[p + 42], data[p + 43], data[p + 44], data[p + 45]]) as u64;
        let name_start = p + 46;
        let name_end = name_start + name_len;
        if name_end > data.len() {
            return Err("zip 条目文件名越界".to_string());
        }
        let name = String::from_utf8_lossy(&data[name_start..name_end]).to_string();
        entries.push(ZipEntry {
            name,
            method,
            comp_size,
            local_offset,
        });
        p = name_end + extra_len + comment_len;
    }
    Ok(entries)
}

/// 读取单个条目的解压后内容（deflate / stored）。
fn extract_entry(data: &[u8], e: &ZipEntry) -> Result<Vec<u8>, String> {
    let off = e.local_offset as usize;
    if off + 30 > data.len() || data[off..off + 4] != [0x50, 0x4b, 0x03, 0x04] {
        return Err(format!("zip 条目 {} 的 local header 签名不匹配", e.name));
    }
    let name_len = u16::from_le_bytes([data[off + 26], data[off + 27]]) as usize;
    let extra_len = u16::from_le_bytes([data[off + 28], data[off + 29]]) as usize;
    let start = off + 30 + name_len + extra_len;
    let end = start + e.comp_size as usize;
    if end > data.len() {
        return Err(format!("zip 条目 {} 数据越界", e.name));
    }
    let raw = &data[start..end];
    match e.method {
        0 => Ok(raw.to_vec()), // stored
        8 => {
            // deflate（raw，无 zlib 头）
            let mut out = Vec::new();
            flate2::read::DeflateDecoder::new(raw)
                .read_to_end(&mut out)
                .map_err(|err| format!("zip 条目 {} deflate 解压失败: {err}", e.name))?;
            Ok(out)
        }
        m => Err(format!(
            "zip 条目 {} 使用不支持的压缩方法 {m}（仅支持 stored/deflate）",
            e.name
        )),
    }
}

/// ureq 错误的可读化（剥离库内部噪音）。
fn describe_ureq(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("HTTP {code} {}", snippet(&body))
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            // ureq 把底层 rustls/hyper 错误链拼成一长串，取首段即可
            let head = msg.lines().next().unwrap_or(&msg);
            format!("网络错误: {head}")
        }
    }
}

/// 长 URL 缩略显示（OSS 签名 URL 动辄数百字符）。
fn short_url(url: &str) -> String {
    if url.len() > 60 {
        format!("{}…{}", &url[..40], &url[url.len() - 12..])
    } else {
        url.to_string()
    }
}

/// 错误响应体缩略（避免把整页 HTML 泼到 stderr）。
fn snippet(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() > 160 {
        let head: String = t.chars().take(160).collect();
        format!("{head}…")
    } else {
        t.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::DeflateEncoder};
    use std::io::Write;

    /// 构造一个最小 zip 包（stored + deflate 两个条目），验证自研读取器。
    fn make_zip(files: &[(&str, &[u8], u16)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        for (name, content, method) in files {
            let (comp, crc) = if *method == 8 {
                let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
                enc.write_all(content).unwrap();
                (enc.finish().unwrap(), crc32(content))
            } else {
                (content.to_vec(), crc32(content))
            };
            let offset = out.len() as u32;
            let nb = name.as_bytes();
            out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04]); // local header 签名
            out.extend_from_slice(&20u16.to_le_bytes()); // version needed
            out.extend_from_slice(&0u16.to_le_bytes()); // flags
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // modtime
            out.extend_from_slice(&0u16.to_le_bytes()); // moddate
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&(comp.len() as u32).to_le_bytes());
            out.extend_from_slice(&(content.len() as u32).to_le_bytes());
            out.extend_from_slice(&(nb.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra len
            out.extend_from_slice(nb);
            out.extend_from_slice(&comp);
            // 中央目录条目
            central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02]);
            central.extend_from_slice(&20u16.to_le_bytes()); // version made by
            central.extend_from_slice(&20u16.to_le_bytes()); // version needed
            central.extend_from_slice(&0u16.to_le_bytes()); // flags
            central.extend_from_slice(&method.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(comp.len() as u32).to_le_bytes());
            central.extend_from_slice(&(content.len() as u32).to_le_bytes());
            central.extend_from_slice(&(nb.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // extra
            central.extend_from_slice(&0u16.to_le_bytes()); // comment
            central.extend_from_slice(&0u16.to_le_bytes()); // disk
            central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(nb);
        }
        let cd_offset = out.len() as u32;
        out.extend_from_slice(&central);
        let cd_size = out.len() as u32 - cd_offset;
        out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06]); // EOCD
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&cd_size.to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // comment len
        out
    }

    /// 简单 CRC32（IEEE，与 zip 规范一致）。
    fn crc32(data: &[u8]) -> u32 {
        let mut table = [0u32; 256];
        for (i, t) in table.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
            }
            *t = c;
        }
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
        crc ^ 0xFFFF_FFFF
    }

    #[test]
    fn zip_reader_stored_and_deflate() {
        let zip = make_zip(&[
            ("full.md", "# 标题\n水务报表内容".as_bytes(), 0),
            ("layout.json", b"{\"pages\":[1]}", 8),
            ("images/", b"", 0), // 目录项应被跳过
        ]);
        let (md, extra) = extract_zip(&zip).expect("解包失败");
        assert!(md.contains("水务报表内容"), "full.md 内容不对: {md}");
        assert_eq!(extra.len(), 1);
        assert_eq!(extra[0].0, "layout.json");
        assert_eq!(extra[0].1, b"{\"pages\":[1]}");
    }

    #[test]
    fn zip_reader_rejects_garbage() {
        let err = read_central_directory(b"not a zip file at all.......".as_ref())
            .unwrap_err();
        assert!(err.contains("EOCD"), "错误信息应指向 EOCD: {err}");
    }

    #[test]
    fn snippet_truncates_long_body() {
        let long = "x".repeat(500);
        let s = snippet(&long);
        assert!(s.chars().count() <= 161);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn short_url_truncates() {
        let url = format!("https://example.com/{}", "a".repeat(200));
        let s = short_url(&url);
        assert!(s.chars().count() < 70);
    }

    #[test]
    fn empty_token_falls_back_to_agent_mode() {
        let m = MinerU::new(Some("  ".to_string()));
        assert!(!m.has_token());
    }
}
