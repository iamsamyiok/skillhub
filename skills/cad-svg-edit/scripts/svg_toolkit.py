#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
svg-edit-v1.1 toolkit —— 可寻址、确定性、可空间查询的 SVG 编辑工具
==================================================================
融合版：svg-edit(本机) 的持久 id 寻址 + validate 校验闭环，
      + svg-edit(qoder) 的空间/文本查询过滤器、AMBIGUOUS 防护、备份/undo。

依赖：lxml（已存在于受管 venv）。无其它外部服务依赖。

命令：
  index    <svg> [--json]                        列出可寻址元素目录（自动补 id 并写回）
  query    <svg> [--text s] [--tag t] [--id x] [--fattr k=v]
                 [--bbox x,y,w,h] [--point x,y] [--radius N] [--json] [--limit N]
  read     <svg> <id>                            查看单个元素完整信息
  update   <svg> <id|过滤器> [--attr k=v ...] [--fill/--stroke/...] [--all]
  text     <svg> <id|过滤器> --set "新文字" [--all]
  move     <svg> <id...|过滤器> --dx N --dy N [--all] [--no-backup]
           move <svg> --batch id:dx,dy id:dx,dy ...   # 逐 id 不同位移（单进程）
           move <svg> id1 id2 id3 --dx N --dy N       # 多 id 同位移（单进程）
  scale    <svg> <id> --sx N [--sy N] [--cx N --cy N]
  rotate   <svg> <id> --deg N [--cx N --cy N]
  delete   <svg> <id|过滤器> [--all]
  insert   <svg> <tag> [--attr k=v ...] [--text "..."] [--parent-id ID]
  validate <svg> [--json]                        校验（重复 id、悬空引用）
  export   <svg> <out> [--pretty]
  backup   <svg>                                 手动备份（变更命令会自动备份）
  undo     <svg>                                 恢复最近一次备份（可连续回退）
  backups  <svg>                                 列出全部备份

定位规则（三选一）：
  1. 直接给 id（最稳）；
  2. 给过滤器（--tag/--text/--fattr/--bbox/--point），单命中直接用，
     多命中报 AMBIGUOUS 并列候选（收窄或加 --all），0 命中报错；
  3. scale/rotate 仅支持 id。

安全机制：
  - 所有变更命令写盘前自动备份为 <file>.bak-<时间戳>，undo 可多级回退；
  - update 等命令的 --attr 是「修改属性」；过滤器用 --fattr（避免歧义）。
"""

import sys
import os
import json
import argparse
import re
import shutil
from datetime import datetime
from lxml import etree

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

GEOM_TAGS = {
    "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "path", "text", "tspan", "g", "use", "image", "symbol",
    "linearGradient", "radialGradient", "filter", "pattern",
    "marker", "clipPath", "title", "desc",
}


def die(msg, code=1):
    print(f"ERR {msg}", file=sys.stderr)
    sys.exit(code)


def _tag(el):
    tag = el.tag
    if isinstance(tag, str):
        return tag.split("}", 1)[1] if "}" in tag else tag
    return str(tag)


def _load(path):
    if not os.path.exists(path):
        die(f"文件不存在: {path}")
    try:
        return etree.parse(path)
    except etree.XMLSyntaxError as e:
        die(f"SVG 解析失败: {e}")


def _root(tree):
    return tree.getroot()


def _ensure_ns(root):
    """确保根 svg 带默认命名空间，避免输出时产生 ns0 前缀。"""
    if "{" in str(root.tag) or "}" in str(root.tag):
        if root.nsmap.get(None) != SVG_NS:
            new_root = etree.Element(etree.QName(SVG_NS, _tag(root)), nsmap={None: SVG_NS})
            new_root.attrib.update(root.attrib)
            new_root[:] = root[:]
            root.getroottree()._setroot(new_root)
            return new_root
        return root
    new_root = etree.Element(etree.QName(SVG_NS, _tag(root)), nsmap={None: SVG_NS})
    new_root.attrib.update(root.attrib)
    new_root[:] = root[:]
    root.getroottree()._setroot(new_root)
    return new_root


def _collect(root):
    return [el for el in root.iter() if _tag(el) != "svg"]


def _assign_ids(root):
    """给无 id 的收录元素补 id（se-<n>）。只改内存树，不写盘。"""
    n = 0
    existing = {el.get("id") for el in _collect(root) if el.get("id")}
    counter = 1
    for el in _collect(root):
        if _tag(el) in GEOM_TAGS and not el.get("id"):
            while f"se-{counter}" in existing:
                counter += 1
            el.set("id", f"se-{counter}")
            existing.add(f"se-{counter}")
            n += 1
            counter += 1
    return n


def _find(root, eid):
    for el in _collect(root):
        if el.get("id") == eid:
            return el
    return None


def _style_of(el):
    info = {}
    for a in ("stroke", "fill", "stroke-width", "opacity", "stroke-dasharray"):
        if el.get(a):
            info[a] = el.get(a)
    style = el.get("style")
    if style:
        for part in style.split(";"):
            if ":" in part:
                k, v = part.split(":", 1)
                k, v = k.strip(), v.strip()
                if k in ("stroke", "fill", "stroke-width", "opacity", "stroke-dasharray"):
                    info[k] = v
    return info


def _text_of(el):
    if _tag(el) in ("text", "tspan", "title", "desc"):
        txt = "".join(el.itertext()).strip()
        return txt or None
    return None


def _tostring(root, pretty=False):
    data = etree.tostring(root, encoding="UTF-8", pretty_print=pretty)
    if not data.lstrip().lower().startswith(b"<?xml"):
        data = b'<?xml version="1.0" encoding="UTF-8"?>\n' + data
    else:
        data = re.sub(rb'<\?xml[^>]*\?>', b'<?xml version="1.0" encoding="UTF-8"?>',
                      data.lstrip(), count=1)
        data = data.lstrip()
    return data


def _save(tree, path, pretty=True):
    data = _tostring(_root(tree), pretty=pretty)
    with open(path, "wb") as f:
        f.write(data)


# ---------------- 备份 / undo ----------------

def _backup(path):
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    b = f"{path}.bak-{ts}"
    n = 1
    while os.path.exists(b):
        b = f"{path}.bak-{ts}.{n}"
        n += 1
    shutil.copyfile(path, b)
    return b


def _backup_and_save(tree, path):
    b = _backup(path)
    _save(tree, path)
    return b


def _save_maybe(tree, path, no_backup=False):
    """写盘。no_backup=True 时跳过自动备份（批量编辑用，避免上百份 .bak）。"""
    if no_backup:
        _save(tree, path)
        return None
    return _backup_and_save(tree, path)


def _list_backups(path):
    d = os.path.dirname(path) or "."
    base = os.path.basename(path)
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d)
                  if f.startswith(base + ".bak-") and not f.endswith(".restored"))


def cmd_backup(args):
    b = _backup(args.svg)
    print(json.dumps({"ok": True, "backup": b}, ensure_ascii=False))


def cmd_undo(args):
    baks = _list_backups(args.svg)
    if not baks:
        die(f"无可用备份: {args.svg}")
    latest = baks[-1]
    d = os.path.dirname(args.svg) or "."
    shutil.copyfile(os.path.join(d, latest), args.svg)
    os.rename(os.path.join(d, latest), os.path.join(d, latest + ".restored"))
    print(json.dumps({"ok": True, "restored_from": latest,
                      "older_backups": len(baks) - 1}, ensure_ascii=False))


def cmd_backups(args):
    baks = _list_backups(args.svg)
    print(json.dumps({"file": args.svg, "count": len(baks), "backups": baks},
                     ensure_ascii=False, indent=2))


# ---------------- 几何估算（空间查询用，启发式） ----------------

_NUM = re.compile(r"-?\d*\.?\d+(?:e[-+]?\d+)?", re.I)


def _nums(s):
    return [float(x) for x in _NUM.findall(str(s or ""))]


def _union(acc, b):
    if b is None:
        return acc
    if acc is None:
        return list(b)
    x2 = max(acc[0] + acc[2], b[0] + b[2])
    y2 = max(acc[1] + acc[3], b[1] + b[3])
    acc[0] = min(acc[0], b[0]); acc[1] = min(acc[1], b[1])
    acc[2] = x2 - acc[0]; acc[3] = y2 - acc[1]
    return acc


def _apply_translate(bb, transform):
    if not transform:
        return bb
    m = re.search(r"translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)", transform)
    if m:
        bb = [bb[0] + float(m.group(1)), bb[1] + float(m.group(2)), bb[2], bb[3]]
    return bb


def _bbox(el):
    """启发式 bbox [x,y,w,h]：基本图形精确；path 取坐标点集（控制点略放大）；
    text 按字号×字符宽估算（CJK 1em / ASCII 0.58em）；g 取子元素并集。"""
    tag = _tag(el)
    a = el.attrib
    f = lambda k, d=0.0: float(a.get(k)) if a.get(k) not in (None, "") else d
    try:
        if tag == "rect":
            return _apply_translate([f("x"), f("y"), f("width"), f("height")], a.get("transform"))
        if tag == "image":
            return _apply_translate([f("x"), f("y"), f("width"), f("height")], a.get("transform"))
        if tag == "circle":
            r = f("r")
            return _apply_translate([f("cx") - r, f("cy") - r, 2 * r, 2 * r], a.get("transform"))
        if tag == "ellipse":
            rx, ry = f("rx"), f("ry")
            return _apply_translate([f("cx") - rx, f("cy") - ry, 2 * rx, 2 * ry], a.get("transform"))
        if tag == "line":
            x1, y1, x2, y2 = f("x1"), f("y1"), f("x2"), f("y2")
            return _apply_translate([min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1)], a.get("transform"))
        if tag in ("polyline", "polygon"):
            p = _nums(a.get("points"))
            if len(p) < 4:
                return None
            xs, ys = p[0::2], p[1::2]
            return _apply_translate([min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], a.get("transform"))
        if tag == "path":
            p = _nums(a.get("d"))
            if len(p) < 4:
                return None
            xs, ys = p[0::2], p[1::2]
            return _apply_translate([min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], a.get("transform"))
        if tag in ("text", "tspan"):
            fs = f("font-size", 14.0)
            txt = "".join(el.itertext()).strip()
            w = sum(fs if ord(c) > 0x2E80 else fs * 0.58 for c in txt)
            x, y = f("x"), f("y")
            return _apply_translate([x, y - fs * 0.85, w, fs * 1.05], a.get("transform"))
        if tag in ("g", "symbol", "a"):
            u = None
            for c in el:
                u = _union(u, _bbox(c))
            if u is None:
                return None
            return _apply_translate(u, a.get("transform"))
    except (ValueError, TypeError):
        return None
    return None


# ---------------- 查询过滤器 ----------------

def _fattr_get(el, k):
    if k == "href":
        return el.get("{http://www.w3.org/1999/xlink}href") or el.get("href")
    return el.get(k)


def _match(el, flt):
    if flt.get("tag") and _tag(el) != flt["tag"]:
        return False
    if flt.get("id") and el.get("id") != flt["id"]:
        return False
    if flt.get("text") is not None:
        t = "".join(el.itertext()).strip()
        if flt["text"].lower() not in t.lower():
            return False
    if flt.get("fattr"):
        k, v = flt["fattr"]
        if (_fattr_get(el, k) or "") != v:
            return False
    if flt.get("bbox"):
        bb = _bbox(el)
        if bb is None:
            return False
        x, y, w, h = flt["bbox"]
        if bb[0] + bb[2] < x or x + w < bb[0] or bb[1] + bb[3] < y or y + h < bb[1]:
            return False
    if flt.get("point"):
        bb = _bbox(el)
        if bb is None:
            return False
        px, py = flt["point"]
        r = flt.get("radius", 0)
        if bb[0] - r > px or px > bb[0] + bb[2] + r or bb[1] - r > py or py > bb[1] + bb[3] + r:
            return False
    return True


def _flt_from_args(args):
    flt = {}
    if getattr(args, "tag", None):
        flt["tag"] = args.tag
    if getattr(args, "id_f", None):
        flt["id"] = args.id_f
    if getattr(args, "text", None) is not None:
        flt["text"] = args.text
    if getattr(args, "fattr", None):
        kv = args.fattr
        if "=" not in kv:
            die(f"--fattr 需为 key=value 形式: {kv}")
        k, v = kv.split("=", 1)
        flt["fattr"] = (k.strip(), v.strip())
    if getattr(args, "bbox", None):
        p = [float(x) for x in args.bbox.split(",")]
        if len(p) != 4:
            die("--bbox 需为 x,y,w,h 四个数")
        flt["bbox"] = p
    if getattr(args, "point", None):
        p = [float(x) for x in args.point.split(",")]
        if len(p) != 2:
            die("--point 需为 x,y 两个数")
        flt["point"] = p
    if getattr(args, "radius", None) is not None:
        flt["radius"] = float(args.radius)
    return flt


def _resolve(root, args, cmd):
    """定位目标元素：id 优先；否则用过滤器。返回元素列表。"""
    eid = getattr(args, "id", None)
    if eid:
        el = _find(root, eid)
        if el is None:
            die(f"未找到 id={eid} 的元素")
        return [el]
    flt = _flt_from_args(args)
    if not flt:
        die(f"{cmd} 需要指定 id 或至少一个过滤器（--tag/--text/--fattr/--bbox/--point）")
    hits = [el for el in _collect(root) if _match(el, flt)]
    if not hits:
        die("0 命中（放宽过滤器试试：query --tag=text / --bbox=x,y,w,h）")
    if len(hits) > 1 and not getattr(args, "all", False):
        print(f"AMBIGUOUS: {len(hits)} 个命中，收窄过滤器或加 --all。候选：", file=sys.stderr)
        for el in hits[:10]:
            bb = _bbox(el)
            bbs = f" bbox={bb[0]:.0f},{bb[1]:.0f},{bb[2]:.0f},{bb[3]:.0f}" if bb else ""
            print(f"  id={el.get('id')}  {_tag(el)}{bbs}  text={_text_of(el)}", file=sys.stderr)
        sys.exit(2)
    return hits


def _fmt_bbox(bb):
    return f"{bb[0]:.0f},{bb[1]:.0f},{bb[2]:.0f},{bb[3]:.0f}" if bb else "-"


# ---------------- 命令实现 ----------------

def cmd_index(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    added = _assign_ids(root)
    if added:
        _backup_and_save(tree, args.svg)
    records = []
    for i, el in enumerate(_collect(root)):
        if _tag(el) not in GEOM_TAGS:
            continue
        records.append({
            "idx": i, "id": el.get("id"), "tag": _tag(el),
            "text": _text_of(el), "bbox": _bbox(el),
            "geom": {k: el.get(k) for k in ("x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
                                            "width", "height", "r", "rx", "ry",
                                            "points", "d", "transform") if el.get(k)},
            "style": _style_of(el),
        })
    if args.json:
        print(json.dumps({"file": args.svg, "count": len(records),
                          "auto_id_added": added, "elements": records},
                         ensure_ascii=False, indent=2))
    else:
        print(f"文件: {args.svg}  | 可寻址元素: {len(records)}  | 本次补 id: {added}")
        print(f"{'idx':>4}  {'id':<14} {'tag':<12} {'bbox':<26} text")
        print("-" * 88)
        for r in records:
            txt = (r["text"] or "")[:18]
            print(f'{r["idx"]:>4}  {str(r["id"]):<14} {r["tag"]:<12} '
                  f'{_fmt_bbox(r["bbox"]):<26} {txt}')
    if added:
        print(f"\n[已自动为 {added} 个无 id 元素补 id 并写回文件（已备份）]", file=sys.stderr)


def cmd_query(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    flt = _flt_from_args(args)
    if not flt:
        die("query 需要至少一个过滤器（--tag/--text/--id/--fattr/--bbox/--point）")
    hits = [el for el in _collect(root) if _match(el, flt)]
    if args.json:
        out = [{"id": el.get("id"), "tag": _tag(el), "text": _text_of(el),
                "bbox": _bbox(el), "style": _style_of(el)} for el in hits]
        print(json.dumps({"file": args.svg, "count": len(hits), "elements": out},
                         ensure_ascii=False, indent=2))
        return
    if not hits:
        print("0 matches")
        return
    lim = args.limit
    for el in hits[:lim]:
        bb = _bbox(el)
        s = _style_of(el)
        style = " ".join(f"{k}={v}" for k, v in s.items())
        print(f'id={str(el.get("id")):<14} {_tag(el):<12} bbox={_fmt_bbox(bb):<26} '
              f'{style:<40} text={_text_of(el)}')
    if len(hits) > lim:
        print(f"... 共 {len(hits)} 命中（仅显示前 {lim}，用 --limit=N 调整）")
    else:
        print(f"{len(hits)} match")


def cmd_read(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    el = _find(root, args.id)
    if el is None:
        die(f"未找到 id={args.id} 的元素")
    info = {"id": el.get("id"), "tag": _tag(el), "text": _text_of(el),
            "all_attrs": dict(el.attrib), "bbox": _bbox(el),
            "style": _style_of(el)}
    print(json.dumps(info, ensure_ascii=False, indent=2))


def _apply_attrs(el, attrs):
    for k, v in attrs.items():
        if k in ("href", "xlink:href"):
            el.set("{http://www.w3.org/1999/xlink}href", v)
        else:
            el.set(k, v)


def cmd_update(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    targets = _resolve(root, args, "update")
    changed_all = []
    for el in targets:
        changed = []
        if getattr(args, "attr", None):
            for kv in args.attr:
                if "=" not in kv:
                    die(f"--attr 需为 key=value 形式: {kv}")
                k, v = kv.split("=", 1)
                _apply_attrs(el, {k.strip(): v.strip()})
                changed.append(f"{k}={v}")
        if args.fill is not None:
            el.set("fill", args.fill); changed.append(f"fill={args.fill}")
        if args.stroke is not None:
            el.set("stroke", args.stroke); changed.append(f"stroke={args.stroke}")
        if args.stroke_width is not None:
            el.set("stroke-width", str(args.stroke_width)); changed.append(f"stroke-width={args.stroke_width}")
        if args.opacity is not None:
            el.set("opacity", str(args.opacity)); changed.append(f"opacity={args.opacity}")
        if args.transform is not None:
            el.set("transform", args.transform); changed.append(f"transform={args.transform}")
        if not changed:
            die("update 未指定任何修改（用 --attr/--fill/--stroke/--stroke-width/--opacity/--transform）")
        changed_all.append({"id": el.get("id"), "changed": changed})
    b = _save_maybe(tree, args.svg, getattr(args, "no_backup", False))
    print(json.dumps({"ok": True, "targets": changed_all, "backup": b,
                      "no_backup": getattr(args, "no_backup", False)}, ensure_ascii=False))


def cmd_text(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    targets = _resolve(root, args, "text")
    out = []
    for el in targets:
        if _tag(el) not in ("text", "tspan", "title", "desc"):
            die(f"目标 id={el.get('id')} 是 <{_tag(el)}>，不是文本元素")
        if _tag(el) == "text":
            for child in list(el):
                el.remove(child)
        el.text = args.set
        out.append({"id": el.get("id"), "text": args.set})
    b = _save_maybe(tree, args.svg, getattr(args, "no_backup", False))
    print(json.dumps({"ok": True, "targets": out, "backup": b,
                      "no_backup": getattr(args, "no_backup", False)}, ensure_ascii=False))


# --- transform 工具 ---
_TOK = re.compile(r"([a-zA-Z]+)\s*\(([^)]*)\)")


def _parse_transform(s):
    if not s:
        return []
    out = []
    for m in _TOK.finditer(s):
        op = m.group(1)
        params = [float(x) for x in re.findall(r"-?\d+\.?\d*", m.group(2))]
        out.append((op, params))
    return out


def _fmt_transform(ops):
    def fmt(p):
        s = str(round(p, 4)).rstrip("0").rstrip(".")
        return s if s else "0"
    return " ".join(f"{op}({', '.join(fmt(p) for p in params)})" for op, params in ops)


def _translate(el, dx, dy):
    ops = _parse_transform(el.get("transform"))
    ops.append(("translate", [float(dx), float(dy)]))
    el.set("transform", _fmt_transform(ops))


def cmd_move(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    no_backup = getattr(args, "no_backup", False)
    out = []
    if getattr(args, "batch", None):
        # --batch id:dx,dy id:dx,dy ...（每个 id 不同位移，单进程完成）
        for pair in args.batch:
            if ":" not in pair:
                die(f"--batch 每项需为 id:dx,dy 形式: {pair}")
            eid, off = pair.split(":", 1)
            parts = off.split(",")
            dx_s = parts[0].strip()
            dy_s = parts[1].strip() if len(parts) > 1 else "0"
            el = _find(root, eid.strip())
            if el is None:
                die(f"未找到 id={eid} 的元素")
            _translate(el, dx_s, dy_s)
            out.append({"id": eid.strip(), "transform": el.get("transform")})
    elif len(args.id) > 1:
        # 多个 id 同一位移：move svg id1 id2 id3 --dx -20 --dy 0（单进程）
        for eid in args.id:
            el = _find(root, eid)
            if el is None:
                die(f"未找到 id={eid} 的元素")
            _translate(el, args.dx, args.dy)
            out.append({"id": eid, "transform": el.get("transform")})
    else:
        # 单 id 或过滤器：走原 _resolve 路径
        if len(args.id) == 1:
            el = _find(root, args.id[0])
            if el is None:
                die(f"未找到 id={args.id[0]} 的元素")
            targets = [el]
        else:
            targets = _resolve(root, args, "move")
        for el in targets:
            _translate(el, args.dx, args.dy)
            out.append({"id": el.get("id"), "transform": el.get("transform")})
    b = _save_maybe(tree, args.svg, no_backup)
    print(json.dumps({"ok": True, "targets": out,
                      "backup": b, "no_backup": no_backup}, ensure_ascii=False))


def cmd_scale(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    el = _find(root, args.id)
    if el is None:
        die(f"未找到 id={args.id} 的元素")
    sx = float(args.sx)
    sy = float(args.sy) if args.sy is not None else sx
    cx = float(args.cx) if args.cx is not None else 0.0
    cy = float(args.cy) if args.cy is not None else 0.0
    ops = _parse_transform(el.get("transform"))
    ops = [("translate", [cx, cy]), ("scale", [sx, sy]), ("translate", [-cx, -cy])] + ops
    el.set("transform", _fmt_transform(ops))
    b = _backup_and_save(tree, args.svg)
    print(json.dumps({"ok": True, "id": args.id, "transform": el.get("transform"),
                      "backup": b}, ensure_ascii=False))


def cmd_rotate(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    el = _find(root, args.id)
    if el is None:
        die(f"未找到 id={args.id} 的元素")
    deg = float(args.deg)
    cx = float(args.cx) if args.cx is not None else 0.0
    cy = float(args.cy) if args.cy is not None else 0.0
    ops = _parse_transform(el.get("transform"))
    ops.append(("rotate", [deg, cx, cy]))
    el.set("transform", _fmt_transform(ops))
    b = _backup_and_save(tree, args.svg)
    print(json.dumps({"ok": True, "id": args.id, "transform": el.get("transform"),
                      "backup": b}, ensure_ascii=False))


def cmd_delete(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    targets = _resolve(root, args, "delete")
    out = []
    for el in targets:
        parent = el.getparent()
        if parent is None:
            die(f"id={el.get('id')} 为根元素，拒绝删除")
        parent.remove(el)
        out.append(el.get("id"))
    b = _save_maybe(tree, args.svg, getattr(args, "no_backup", False))
    print(json.dumps({"ok": True, "deleted": out, "backup": b,
                      "no_backup": getattr(args, "no_backup", False)}, ensure_ascii=False))


def cmd_insert(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    parent = root
    if args.parent_id:
        p = _find(root, args.parent_id)
        if p is None:
            die(f"未找到父元素 id={args.parent_id}")
        parent = p
    el = etree.SubElement(parent, etree.QName(SVG_NS, args.tag), nsmap={None: SVG_NS})
    if getattr(args, "attr", None):
        for kv in args.attr:
            if "=" not in kv:
                die(f"--attr 需为 key=value 形式: {kv}")
            k, v = kv.split("=", 1)
            el.set(k.strip(), v.strip())
    if args.text:
        el.text = args.text
    if not el.get("id"):
        existing = {e.get("id") for e in _collect(root) if e.get("id")}
        c = 1
        while f"se-{c}" in existing:
            c += 1
        el.set("id", f"se-{c}")
    b = _save_maybe(tree, args.svg, getattr(args, "no_backup", False))
    print(json.dumps({"ok": True, "inserted_id": el.get("id"), "tag": args.tag,
                      "backup": b, "no_backup": getattr(args, "no_backup", False)},
                     ensure_ascii=False))


def cmd_validate(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    issues = []
    ids = [el.get("id") for el in _collect(root) if el.get("id")]
    if len(ids) != len(set(ids)):
        from collections import Counter
        dups = [i for i, c in Counter(ids).items() if c > 1]
        issues.append({"level": "error", "type": "duplicate_id", "ids": dups})
    idset = set(ids)
    text = etree.tostring(root, encoding="unicode")
    refs = set(re.findall(r"url\(#([^)]+)\)", text)) | set(re.findall(r'href="#([^"]+)"', text))
    missing = sorted(refs - idset)
    if missing:
        issues.append({"level": "warning", "type": "dangling_ref", "ids": missing})
    ok = not any(i["level"] == "error" for i in issues)
    print(json.dumps({"ok": ok, "element_count": len(ids), "issues": issues},
                     ensure_ascii=False, indent=2))


def cmd_export(args):
    tree = _load(args.svg)
    root = _ensure_ns(_root(tree))
    data = _tostring(_root(tree), pretty=args.pretty)
    with open(args.out, "wb") as f:
        f.write(data)
    print(json.dumps({"ok": True, "exported": os.path.abspath(args.out)}, ensure_ascii=False))


# ---------------- CLI ----------------

def _add_filters(p, with_id=False, id_nargs="?"):
    p.add_argument("id", nargs=id_nargs,
                   default=[] if id_nargs == "*" else None,
                   help="元素 id（可多个，同位移）；或改用过滤器" if id_nargs == "*"
                   else "元素 id（或改用过滤器）")
    if with_id:
        p.add_argument("--id", dest="id_f", help="按 id 过滤（等价于位置参数）")
    p.add_argument("--tag", help="按标签过滤")
    p.add_argument("--text", help="按文本内容子串过滤（不区分大小写）")
    p.add_argument("--fattr", metavar="k=v", help="按属性精确匹配过滤")
    p.add_argument("--bbox", metavar="x,y,w,h", help="按区域（相交语义）过滤")
    p.add_argument("--point", metavar="x,y", help="按点命中过滤（配 --radius）")
    p.add_argument("--radius", type=float, default=None, help="--point 的命中半径")
    p.add_argument("--all", action="store_true", help="命中多个时全部应用（默认拒绝）")


def build_parser():
    p = argparse.ArgumentParser(
        prog="svg_toolkit.py",
        description="可寻址、确定性、可空间查询的 SVG 编辑工具（svg-edit-v1.1）")
    sub = p.add_subparsers(dest="command", required=True)

    pi = sub.add_parser("index", help="列出可寻址元素目录（自动补 id）")
    pi.add_argument("svg")
    pi.add_argument("--json", action="store_true")
    pi.set_defaults(func=cmd_index)

    pq = sub.add_parser("query", help="按过滤器查询元素（文本/标签/属性/区域/点命中）")
    pq.add_argument("svg")
    pq.add_argument("--id", dest="id_f")
    _add_filters(pq)
    pq.add_argument("--json", action="store_true")
    pq.add_argument("--limit", type=int, default=80)
    pq.set_defaults(func=cmd_query)

    pr = sub.add_parser("read", help="查看单个元素")
    pr.add_argument("svg")
    pr.add_argument("id")
    pr.set_defaults(func=cmd_read)

    pu = sub.add_parser("update", help="修改元素属性（id 或过滤器 + --all）")
    pu.add_argument("svg")
    _add_filters(pu)
    pu.add_argument("--attr", nargs="+", metavar="k=v", help="修改属性 key=value（可多个）")
    pu.add_argument("--fill")
    pu.add_argument("--stroke")
    pu.add_argument("--stroke-width")
    pu.add_argument("--opacity")
    pu.add_argument("--transform")
    pu.add_argument("--no-backup", action="store_true",
                    help="跳过自动备份（批量编辑用，避免上百份 .bak）")
    pu.set_defaults(func=cmd_update)

    pt = sub.add_parser("text", help="修改文本内容（id 或过滤器 + --all）")
    pt.add_argument("svg")
    _add_filters(pt)
    pt.add_argument("--set", dest="set", required=True, help="新文字")
    pt.add_argument("--no-backup", action="store_true",
                    help="跳过自动备份（批量编辑用，避免上百份 .bak）")
    pt.set_defaults(func=cmd_text)

    pm = sub.add_parser("move", help="平移（id/多id/--batch/过滤器 + --all）")
    pm.add_argument("svg")
    _add_filters(pm, id_nargs="*")
    pm.add_argument("--batch", nargs="+", metavar="id:dx,dy",
                    help="逐 id 不同位移：id1:dx,dy id2:dx,dy ...（单进程批量）")
    pm.add_argument("--dx", type=float, default=0.0)
    pm.add_argument("--dy", type=float, default=0.0)
    pm.add_argument("--no-backup", action="store_true",
                    help="跳过自动备份（批量编辑用，避免上百份 .bak）")
    pm.set_defaults(func=cmd_move)

    ps = sub.add_parser("scale", help="缩放（仅 id）")
    ps.add_argument("svg")
    ps.add_argument("id")
    ps.add_argument("--sx", type=float, required=True)
    ps.add_argument("--sy", type=float, default=None)
    ps.add_argument("--cx", type=float, default=None)
    ps.add_argument("--cy", type=float, default=None)
    ps.set_defaults(func=cmd_scale)

    prt = sub.add_parser("rotate", help="旋转（仅 id）")
    prt.add_argument("svg")
    prt.add_argument("id")
    prt.add_argument("--deg", type=float, required=True)
    prt.add_argument("--cx", type=float, default=None)
    prt.add_argument("--cy", type=float, default=None)
    prt.set_defaults(func=cmd_rotate)

    pd = sub.add_parser("delete", help="删除元素（id 或过滤器 + --all）")
    pd.add_argument("svg")
    _add_filters(pd)
    pd.add_argument("--no-backup", action="store_true",
                    help="跳过自动备份（批量编辑用，避免上百份 .bak）")
    pd.set_defaults(func=cmd_delete)

    pin = sub.add_parser("insert", help="插入新元素")
    pin.add_argument("svg")
    pin.add_argument("tag")
    pin.add_argument("--attr", nargs="+", metavar="k=v", help="可多个")
    pin.add_argument("--text")
    pin.add_argument("--parent-id")
    pin.add_argument("--no-backup", action="store_true",
                    help="跳过自动备份（批量编辑用，避免上百份 .bak）")
    pin.set_defaults(func=cmd_insert)

    pv = sub.add_parser("validate", help="基础校验")
    pv.add_argument("svg")
    pv.add_argument("--json", action="store_true")
    pv.set_defaults(func=cmd_validate)

    pe = sub.add_parser("export", help="导出 SVG")
    pe.add_argument("svg")
    pe.add_argument("out")
    pe.add_argument("--pretty", action="store_true")
    pe.set_defaults(func=cmd_export)

    pb = sub.add_parser("backup", help="手动备份")
    pb.add_argument("svg")
    pb.set_defaults(func=cmd_backup)

    pu2 = sub.add_parser("undo", help="恢复最近一次备份（可连续回退）")
    pu2.add_argument("svg")
    pu2.set_defaults(func=cmd_undo)

    pb2 = sub.add_parser("backups", help="列出全部备份")
    pb2.add_argument("svg")
    pb2.set_defaults(func=cmd_backups)

    return p


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
