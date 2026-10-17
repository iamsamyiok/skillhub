//! 公共工具：页范围解析、文档加载/保存、可达性 GC、merge 重映射、页树重建、大纲清理。
use lopdf::{Dictionary, Document, Error as PdfError, Object, ObjectId};
use std::collections::{BTreeMap, HashMap, HashSet};

pub type CmdResult<T> = Result<T, String>;

/// 退出码：0 成功；1 运行错误；2 参数错误；3 校验发现问题。
#[allow(dead_code)]
pub const EXIT_OK: i32 = 0;
pub const EXIT_RUNTIME: i32 = 1;
#[allow(dead_code)]
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_VALIDATION: i32 = 3;

/// 解析页范围表达式，如 "all"、"1-3,5"、"3-end"、"2"。返回 1-based 页码，保持给定顺序、允许重复（reorder 需要）。
pub fn parse_page_ranges(spec: &str, total: usize) -> CmdResult<Vec<usize>> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err("页范围为空".into());
    }
    let mut out = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err(format!("页范围中存在空片段: {spec:?}"));
        }
        if part.eq_ignore_ascii_case("all") {
            out.extend(1..=total);
            continue;
        }
        let (a, b) = match part.split_once('-') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (part, part),
        };
        let parse_endpoint = |s: &str| -> CmdResult<usize> {
            if s.eq_ignore_ascii_case("end") {
                return Ok(total);
            }
            s.parse::<usize>()
                .map_err(|_| format!("无效页码: {s:?}（应为 1..{total} 或 end）"))
        };
        let start = parse_endpoint(a)?;
        let end = parse_endpoint(b)?;
        if start < 1 || end < 1 {
            return Err(format!("页码必须 >= 1: {part:?}"));
        }
        if start > total || end > total {
            return Err(format!("页码超出范围: {part:?}（文档共 {total} 页）"));
        }
        if start > end {
            return Err(format!("范围起点大于终点: {part:?}"));
        }
        out.extend(start..=end);
    }
    if out.is_empty() {
        return Err("页范围解析结果为空".into());
    }
    Ok(out)
}

/// 加载文档。password 为 Some 时走带密码加载；None 时普通加载。
/// 对"文档已加密但未提供密码"给出可操作的错误提示。
/// 加载文档。password 为 Some 时走带密码加载；None 时普通加载。
/// 关键：lopdf 对"加密文档+无密码"也会返回 Ok（对象保持密文），
/// 因此加载后必须检查 trailer 是否仍带 /Encrypt，是则引导用户提供密码。
pub fn load_doc(path: &str, password: Option<&str>) -> CmdResult<Document> {
    let doc = match password {
        Some(pw) => Document::load_with_password(path, pw).map_err(|e| match e {
            PdfError::InvalidPassword => format!(
                "密码错误，无法打开 {path}。请检查 --password（用户密码与所有者密码均可尝试；空密码可省略该参数）"
            ),
            other => format!("打开 {path} 失败: {other}"),
        }),
        None => Document::load(path).map_err(|e| match e {
            PdfError::InvalidPassword => format!(
                "{path} 是加密 PDF，需要密码。请加 --password <密码>（若空密码可打开可省略该参数重试）"
            ),
            other => format!("打开 {path} 失败: {other}"),
        }),
    }?;
    if doc.is_encrypted() {
        return Err(format!(
            "{path} 是加密 PDF，需要密码。请加 --password <密码>（若空密码可打开可省略该参数重试）"
        ));
    }
    Ok(doc)
}

/// 仅探测文件是否声明了加密（不解密）。用于 info 对打不开的加密文档也能报告加密状态。
pub fn file_is_encrypted(path: &str) -> bool {
    Document::load_metadata(path)
        .map(|m| m.encrypted)
        .unwrap_or(false)
}

/// 原子保存：先写同目录临时文件，成功后 rename 覆盖，避免写一半损坏原文件。
pub fn save_atomic(doc: &mut Document, out: &str) -> CmdResult<()> {
    let tmp = format!("{out}.pdfctl-tmp");
    doc.save(&tmp)
        .map_err(|e| format!("写入 {tmp} 失败: {e}"))?;
    std::fs::rename(&tmp, out).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换 {out} 失败: {e}")
    })
}

/// 按文档页序返回全部页面对象 id（1-based 语义由调用方处理）。
pub fn ordered_pages(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

/// 页数。
pub fn page_count(doc: &Document) -> usize {
    doc.get_pages().len()
}

/// 可达性垃圾回收：从 trailer 出发遍历对象图，删除不可达对象。
/// 用于 delete/extract/reorder 之后回收被摘除的页面及其资源。
pub fn gc(doc: &mut Document) {
    let mut live: HashSet<ObjectId> = HashSet::new();
    let mut stack: Vec<ObjectId> = Vec::new();
    for (_, v) in doc.trailer.iter() {
        collect_refs(v, &mut stack);
    }
    while let Some(id) = stack.pop() {
        if !live.insert(id) {
            continue;
        }
        if let Some(obj) = doc.objects.get(&id) {
            match obj {
                Object::Dictionary(d) => {
                    for (_, v) in d.iter() {
                        collect_refs(v, &mut stack);
                    }
                }
                Object::Stream(s) => {
                    for (_, v) in s.dict.iter() {
                        collect_refs(v, &mut stack);
                    }
                }
                _ => {}
            }
        }
    }
    let dead: Vec<ObjectId> = doc
        .objects
        .keys()
        .filter(|id| !live.contains(id))
        .copied()
        .collect();
    for id in dead {
        doc.objects.remove(&id);
    }
}

fn collect_refs(obj: &Object, stack: &mut Vec<ObjectId>) {
    match obj {
        Object::Reference(id) => stack.push(*id),
        Object::Array(arr) => {
            for v in arr {
                collect_refs(v, stack);
            }
        }
        Object::Dictionary(d) => {
            for (_, v) in d.iter() {
                collect_refs(v, stack);
            }
        }
        Object::Stream(s) => {
            for (_, v) in s.dict.iter() {
                collect_refs(v, stack);
            }
        }
        _ => {}
    }
}

/// 重写对象内部全部引用（递归）。用于 merge 时把源文档对象图嫁接到目标文档。
pub fn remap_object(obj: &mut Object, map: &HashMap<ObjectId, ObjectId>) {
    match obj {
        Object::Reference(id) => {
            if let Some(n) = map.get(id) {
                *id = *n;
            }
        }
        Object::Array(arr) => {
            for v in arr.iter_mut() {
                remap_object(v, map);
            }
        }
        Object::Dictionary(d) => {
            for (_, v) in d.iter_mut() {
                remap_object(v, map);
            }
        }
        Object::Stream(s) => {
            for (_, v) in s.dict.iter_mut() {
                remap_object(v, map);
            }
        }
        _ => {}
    }
}

/// 把 source 文档的全部对象搬进 target（两遍式 id 重映射），返回按 source 页序排列的新页面 id。
/// 同时嫁接 source 的 Outlines（若 target 没有）。
pub fn merge_documents(target: &mut Document, source: Document) -> CmdResult<Vec<ObjectId>> {
    // 先取只读信息（objects 被移动前）
    let source_pages: Vec<ObjectId> = source.page_iter().collect();
    let source_outline_ref = source
        .catalog()
        .ok()
        .and_then(|c| c.get(b"Outlines").ok())
        .and_then(|o| o.as_reference().ok());
    // 第一遍：为 source 每个对象分配新 id
    let mut map: HashMap<ObjectId, ObjectId> = HashMap::with_capacity(source.objects.len());
    let mut new_objs: Vec<(ObjectId, Object)> = Vec::with_capacity(source.objects.len());
    for (old, obj) in source.objects {
        let nid = (target.max_id + 1, 0);
        target.max_id += 1;
        map.insert(old, nid);
        new_objs.push((nid, obj));
    }
    // 第二遍：统一重写引用后插入（避免前向引用漏映射）
    for (nid, mut obj) in new_objs {
        remap_object(&mut obj, &map);
        target.objects.insert(nid, obj);
    }
    // source 页序 → 新 id
    let new_pages: Vec<ObjectId> = source_pages
        .iter()
        .map(|old| {
            map.get(old)
                .copied()
                .ok_or_else(|| "merge 内部错误：源页面对象缺失".to_string())
        })
        .collect::<CmdResult<_>>()?;
    // 嫁接 Outlines：source catalog["Outlines"] 重映射后挂到 target
    let target_has_outline = target
        .catalog()
        .map(|c| c.get(b"Outlines").is_ok())
        .unwrap_or(false);
    if let Some(src_ref) = source_outline_ref {
        if !target_has_outline {
            if let Some(new_ref) = map.get(&src_ref).copied() {
                if let Ok(cat) = target.catalog_mut() {
                    cat.set(b"Outlines", Object::Reference(new_ref));
                }
            }
        }
    }
    Ok(new_pages)
}

/// 页树扁平化重建：Pages 根的 Kids 直接指向 keep（保持顺序），Count 更新；
/// 旧中间页树节点失去引用，由 gc 回收。同时修正每页 Parent 指向 Pages 根。
pub fn rebuild_pages(doc: &mut Document, keep: &[ObjectId]) -> CmdResult<()> {
    let pages_ref = {
        let catalog = doc.catalog().map_err(|e| format!("读取 catalog 失败: {e}"))?;
        catalog
            .get(b"Pages")
            .map_err(|_| "catalog 缺少 /Pages".to_string())?
            .as_reference()
            .map_err(|_| "catalog /Pages 不是引用".to_string())?
    };
    for id in keep {
        let page = doc
            .get_object_mut(*id)
            .map_err(|e| format!("页面对象 {id:?} 读取失败: {e}"))?
            .as_dict_mut()
            .map_err(|_| format!("页面对象 {id:?} 不是字典"))?;
        page.set(b"Parent", Object::Reference(pages_ref));
    }
    let pages = doc
        .get_object_mut(pages_ref)
        .map_err(|e| format!("Pages 根 {pages_ref:?} 读取失败: {e}"))?
        .as_dict_mut()
        .map_err(|_| "Pages 根不是字典".to_string())?;
    pages.set(
        b"Kids",
        Object::Array(keep.iter().map(|id| Object::Reference(*id)).collect()),
    );
    pages.set(b"Count", Object::Integer(keep.len() as i64));
    Ok(())
}

/// 页面 MediaBox（含沿 Parent 链继承）。返回 [x0, y0, x1, y1]。
pub fn page_media_box(doc: &Document, page_id: ObjectId) -> Option<[f64; 4]> {
    let mut cur = page_id;
    for _ in 0..64 {
        let d = doc.get_dictionary(cur).ok()?;
        if let Ok(arr) = d.get(b"MediaBox") {
            if let Ok(a) = arr.as_array() {
                if a.len() == 4 {
                    let f = |o: &Object| o.as_float().unwrap_or(0.0) as f64;
                    return Some([f(&a[0]), f(&a[1]), f(&a[2]), f(&a[3])]);
                }
            }
        }
        cur = d.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

/// 页面旋转角（继承 /Rotate，归一化到 0/90/180/270）。
pub fn page_rotation(doc: &Document, page_id: ObjectId) -> u32 {
    let mut cur = page_id;
    for _ in 0..64 {
        let Ok(d) = doc.get_dictionary(cur) else { return 0 };
        if let Ok(Object::Integer(r)) = d.get(b"Rotate") {
            return (((*r % 360) + 360) % 360) as u32;
        }
        let Ok(parent) = d.get(b"Parent").and_then(|p| p.as_reference()) else {
            return 0;
        };
        cur = parent;
    }
    0
}

/// 生成 PDF 日期字符串（东八区）：D:YYYYMMDDHHmmSS+08'00'
pub fn now_pdf_date() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let local = secs + 8 * 3600;
    let days = local.div_euclid(86400);
    let secs_of_day = local.rem_euclid(86400);
    let (h, m, s) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );
    // Howard Hinnant days_from_civil 逆算法
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("D:{year:04}{month:02}{d:02}{h:02}{m:02}{s:02}+08'00'")
}

/// 大纲清理：删除 Dest 指向已不存在页面的 item，同步修正 Count。
/// 命名目标（/Dest 为名字）中失效的条目也会从 catalog 的 Dests 中移除。
pub fn prune_outline(doc: &mut Document, kept: &HashSet<ObjectId>) {
    let Ok(catalog) = doc.catalog() else { return };
    let Some(outline_ref) = catalog.get(b"Outlines").ok().and_then(|o| o.as_reference().ok()) else {
        // 无传统 Outlines 时仍尝试清理 Names/Dests
        prune_named_dests(doc, kept);
        return;
    };
    // 从根开始递归，返回 (first, last, count)
    let result = prune_outline_node(doc, outline_ref, kept);
    if let Ok(Some((first, last, count))) = result {
        if let Ok(root) = doc.get_object_mut(outline_ref).and_then(|o| o.as_dict_mut()) {
            match first {
                Some(f) => root.set(b"First", Object::Reference(f)),
                None => {
                    root.remove(b"First");
                    root.remove(b"Last");
                }
            }
            if let Some(l) = last {
                root.set(b"Last", Object::Reference(l));
            }
            root.set(b"Count", Object::Integer(count));
        }
    }
    prune_named_dests(doc, kept);
}

fn outline_item_dest_pages(doc: &Document, item_id: ObjectId) -> Vec<ObjectId> {
    // 返回该 item 直接 Dest/A 指向的页面 id（无法解析时视为空=保守保留）
    let Ok(item) = doc.get_dictionary(item_id) else {
        return vec![];
    };
    let mut pages = Vec::new();
    // /Dest：直接数组或指向目标字典的引用
    if let Ok(dest) = item.get(b"Dest") {
        pages.extend(dest_pages_from_value(doc, dest));
    }
    // /A << /S /GoTo /D [...] >>：直接字典或引用
    for action in [item.get(b"A").ok()] {
        let Some(action) = action else { continue };
        let action_dict = match action {
            Object::Dictionary(_) => Some(action.as_dict().unwrap()),
            Object::Reference(r) => doc.get_dictionary(*r).ok(),
            _ => None,
        };
        if let Some(ad) = action_dict {
            if let Ok(d) = ad.get(b"D") {
                pages.extend(dest_pages_from_value(doc, d));
            }
        }
    }
    pages
}

/// 从目标值解析页面引用：数组首元素 / 目标字典 /D 首元素（均支持间接引用）。
fn dest_pages_from_value(doc: &Document, val: &Object) -> Vec<ObjectId> {
    let mut pages = Vec::new();
    match val {
        Object::Array(arr) => {
            if let Some(first) = arr.first() {
                if let Ok(r) = first.as_reference() {
                    pages.push(r);
                }
            }
        }
        Object::Reference(r) => {
            // 命名目标字典 /D 或动作字典 /D
            if let Ok(dict) = doc.get_dictionary(*r) {
                if let Ok(d) = dict.get(b"D") {
                    if let Ok(arr) = d.as_array() {
                        if let Some(first) = arr.first() {
                            if let Ok(pr) = first.as_reference() {
                                pages.push(pr);
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
    pages
}

fn prune_outline_node(
    doc: &mut Document, node_id: ObjectId, kept: &HashSet<ObjectId>,
) -> CmdResult<Option<(Option<ObjectId>, Option<ObjectId>, i64)>> {
    // 收集子项
    let children: Vec<ObjectId> = {
        let Ok(node) = doc.get_dictionary(node_id) else {
            return Ok(None);
        };
        let mut out = Vec::new();
        let mut cur = node.get(b"First").ok().and_then(|o| o.as_reference().ok());
        let mut guard = 0;
        while let Some(id) = cur {
            out.push(id);
            guard += 1;
            if guard > 100_000 {
                break;
            }
            cur = doc
                .get_dictionary(id)
                .ok()
                .and_then(|d| d.get(b"Next").ok())
                .and_then(|o| o.as_reference().ok());
        }
        out
    };
    let mut kept_children: Vec<ObjectId> = Vec::new();
    let mut total_count: i64 = 0;
    for child in children {
        // 先递归处理其子树
        let sub = prune_outline_node(doc, child, kept)?;
        let dest_pages = outline_item_dest_pages(doc, child);
        let dest_ok = dest_pages.is_empty() || dest_pages.iter().all(|p| kept.contains(p));
        if !dest_ok {
            continue; // 删除该项（含子树）
        }
        if let Some((first, last, cnt)) = sub {
            if let Ok(cd) = doc.get_object_mut(child).and_then(|o| o.as_dict_mut()) {
                if let Some(f) = first {
                    cd.set(b"First", Object::Reference(f));
                }
                if let Some(l) = last {
                    cd.set(b"Last", Object::Reference(l));
                }
                cd.set(b"Count", Object::Integer(cnt));
                total_count += cnt;
            }
        }
        kept_children.push(child);
        total_count += 1;
    }
    // 重建链表
    let n = kept_children.len();
    for (i, id) in kept_children.iter().enumerate() {
        if let Ok(cd) = doc.get_object_mut(*id).and_then(|o| o.as_dict_mut()) {
            if i > 0 {
                cd.set(b"Prev", Object::Reference(kept_children[i - 1]));
            } else {
                cd.remove(b"Prev");
            }
            if i + 1 < n {
                cd.set(b"Next", Object::Reference(kept_children[i + 1]));
            } else {
                cd.remove(b"Next");
            }
            cd.set(b"Parent", Object::Reference(node_id));
        }
    }
    let first = kept_children.first().copied();
    let last = kept_children.last().copied();
    Ok(Some((first, last, total_count)))
}

/// 清理 catalog/Names/Dests 名称树与 catalog/Dests 字典中指向被删页的命名目标。
fn prune_named_dests(doc: &mut Document, kept: &HashSet<ObjectId>) {
    // 1) catalog /Names /Dests（名称树，/Names 数组或 /Kids）
    let names_ref = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(b"Names").ok())
        .and_then(|n| n.as_reference().ok());
    if let Some(names_ref) = names_ref {
        let dests_ref = doc
            .get_dictionary(names_ref)
            .ok()
            .and_then(|n| n.get(b"Dests").ok())
            .and_then(|d| d.as_reference().ok());
        if let Some(dests_ref) = dests_ref {
            prune_name_tree(doc, dests_ref, kept);
        }
    }
    // 2) catalog /Dests（旧式字典）
    let dests_ref = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(b"Dests").ok())
        .and_then(|d| d.as_reference().ok());
    if let Some(dests_ref) = dests_ref {
        // 先以不可变借用收集待删键，再以可变借用删除（避免借用冲突）
        let dead: Vec<Vec<u8>> = match doc.get_dictionary(dests_ref) {
            Ok(dict) => dict
                .iter()
                .filter_map(|(k, v)| {
                    let pages = dest_pages_from_value(doc, v);
                    let bad = !pages.is_empty() && pages.iter().any(|p| !kept.contains(p));
                    if bad { Some(k.clone()) } else { None }
                })
                .collect(),
            Err(_) => vec![],
        };
        if let Ok(dict) = doc.get_object_mut(dests_ref).and_then(|o| o.as_dict_mut()) {
            for k in dead {
                dict.remove(&k);
            }
        }
    }
}

fn prune_name_tree(doc: &mut Document, node_id: ObjectId, kept: &HashSet<ObjectId>) {
    // 叶子节点：/Names [name dest ...]；中间节点：/Kids
    let (names, kids): (Option<Vec<(Vec<u8>, Object)>>, Option<Vec<ObjectId>>) = {
        let Ok(node) = doc.get_dictionary(node_id) else {
            return;
        };
        let names = node.get(b"Names").ok().and_then(|n| n.as_array().ok()).map(|arr| {
            arr.chunks(2)
                .filter_map(|c| {
                    if c.len() == 2 {
                        Some((c[0].as_name().unwrap_or(&[]).to_vec(), c[1].clone()))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        });
        let kids = node
            .get(b"Kids")
            .ok()
            .and_then(|k| k.as_array().ok())
            .map(|a| a.iter().filter_map(|o| o.as_reference().ok()).collect::<Vec<_>>());
        (names, kids)
    };
    if let Some(entries) = names {
        let alive: Vec<(Vec<u8>, Object)> = entries
            .into_iter()
            .filter(|(_, v)| {
                let pages = dest_pages_from_value(doc, v);
                pages.is_empty() || pages.iter().all(|p| kept.contains(p))
            })
            .collect();
        let mut arr: Vec<Object> = Vec::with_capacity(alive.len() * 2);
        for (k, v) in alive {
            arr.push(Object::Name(k));
            arr.push(v);
        }
        if let Ok(node) = doc.get_object_mut(node_id).and_then(|o| o.as_dict_mut()) {
            node.set(b"Names", Object::Array(arr));
        }
    }
    if let Some(kids) = kids {
        for k in kids {
            prune_name_tree(doc, k, kept);
        }
    }
}

/// Info 字典元数据字段表（标准 8 项）。
pub const INFO_FIELDS: [&[u8]; 8] = [
    b"Title",
    b"Author",
    b"Subject",
    b"Keywords",
    b"Creator",
    b"Producer",
    b"CreationDate",
    b"ModDate",
];

/// 读取 Info 字典（不存在返回空字典）。
pub fn info_dict(doc: &Document) -> Dictionary {
    doc.trailer
        .get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok())
        .and_then(|id| doc.get_dictionary(id).ok())
        .cloned()
        .unwrap_or_default()
}

/// 确保 Info 字典存在并返回其对象 id。
pub fn ensure_info_dict(doc: &mut Document) -> CmdResult<ObjectId> {
    if let Ok(id) = doc.trailer.get(b"Info").and_then(|o| o.as_reference()) {
        return Ok(id);
    }
    let id = doc.add_object(Object::Dictionary(Dictionary::new()));
    doc.trailer.set(b"Info", Object::Reference(id));
    Ok(id)
}

/// 打印 JSON 结果（--json 模式统一出口）。
pub fn print_json<T: serde::Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

/// 字节数 → 人类可读大小。
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut u = 0;
    while size >= 1024.0 && u < UNITS.len() - 1 {
        size /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{:.1} {}", size, UNITS[u])
    }
}

/// 页面尺寸归类标签（A4/A3/Letter 等）。
pub fn size_label(w: f64, h: f64) -> String {
    let (w, h) = (w.round(), h.round());
    match (w as i64, h as i64) {
        (595, 842) | (842, 595) => "A4".into(),
        (842, 1191) | (1191, 842) => "A3".into(),
        (420, 595) | (595, 420) => "A5".into(),
        (612, 792) | (792, 612) => "Letter".into(),
        (612, 1008) | (1008, 612) => "Legal".into(),
        _ => format!("{w}x{h} pt"),
    }
}

/// 导出页集合供外部使用（保持 1-based 顺序）。
pub fn pages_1based(doc: &Document) -> BTreeMap<u32, ObjectId> {
    doc.get_pages()
}
