import re
import json
import time
import urllib.request
import urllib.error
import subprocess
from io import BytesIO
from pypdf import PdfReader  # type: ignore
from pathlib import Path
from typing import List, Dict, Any, Optional


def list_tex_files(workspace: Path) -> List[str]:
    return [str(p.relative_to(workspace)) for p in workspace.rglob("*.tex")]


def read_file(workspace: Path, rel_path: str, max_bytes: int = 50_000) -> Dict[str, Any]:
    p = (workspace / rel_path).resolve()
    if not p.is_file():
        raise FileNotFoundError(rel_path)
    content = p.read_bytes()[:max_bytes].decode("utf-8", errors="replace")
    truncated = p.stat().st_size > max_bytes
    return {"path": rel_path, "truncated": truncated, "content": content}


def _resources_root(workspace: Path) -> Path:
    return workspace / 'resources'


def _ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def _safe_filename(key: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', key)


def _download_pdf(url: str, dest: Path, timeout: int = 20) -> dict:
    start = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return {"ok": False, "status": resp.status, "error": f"HTTP {resp.status}"}
            data = resp.read()
        dest.write_bytes(data)
        return {"ok": True, "bytes": len(data), "elapsed_s": round(time.time()-start, 2)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def extract_bibliography(workspace: Path, rel_path: str) -> List[Dict[str, Any]]:
    bib_path = workspace / rel_path
    if not bib_path.is_file():
        raise FileNotFoundError(rel_path)
    text = bib_path.read_text(encoding="utf-8", errors="replace")

    entries: List[Dict[str, Any]] = []
    i = 0
    n = len(text)
    while True:
        at = text.find('@', i)
        if at == -1:
            break
        m = re.match(r'@([A-Za-z]+)\s*\{', text[at:])
        if not m:
            i = at + 1
            continue
        entry_type = m.group(1).lower()
        cursor = at + m.end(0)
        comma = text.find(',', cursor)
        if comma == -1:
            i = at + 1
            continue
        key = text[cursor:comma].strip()
        cursor = comma + 1
        depth = 1
        start_fields = cursor
        while cursor < n and depth > 0:
            c = text[cursor]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            cursor += 1
        body = text[start_fields:cursor-1]

        fields: Dict[str, str] = {}
        field_tokens: List[str] = []
        buf = []
        brace_level = 0
        in_quotes = False
        for ch in body:
            if ch == '"' and brace_level == 0:
                in_quotes = not in_quotes
                buf.append(ch)
                continue
            if not in_quotes:
                if ch == '{':
                    brace_level += 1
                elif ch == '}':
                    brace_level = max(0, brace_level - 1)
            if ch == ',' and brace_level == 0 and not in_quotes:
                token = ''.join(buf).strip()
                if token:
                    field_tokens.append(token)
                buf = []
            else:
                buf.append(ch)
        tail = ''.join(buf).strip()
        if tail:
            field_tokens.append(tail)

        for tok in field_tokens:
            if '=' not in tok:
                continue
            k, v = tok.split('=', 1)
            k = k.strip().lower()
            v = v.strip().rstrip(',')
            if (v.startswith('{') and v.endswith('}')) or (v.startswith('"') and v.endswith('"')):
                v = v[1:-1].strip()
            fields[k] = v

        title = fields.get('title')
        authors_raw = fields.get('author', '')
        authors = [a.strip() for a in authors_raw.split(' and ') if a.strip()] if authors_raw else []
        year_val = fields.get('year')
        try:
            year = int(re.findall(r'\d{4}', year_val)[0]) if year_val else None
        except Exception:
            year = None
        doi = fields.get('doi')
        doi_url = f"https://doi.org/{doi}" if doi else None
        eprint = fields.get('eprint')
        archive_prefix = fields.get('archiveprefix', '').lower()
        arxiv_pdf_url = None
        if eprint and archive_prefix == 'arxiv':
            arxiv_pdf_url = f"https://arxiv.org/pdf/{eprint}.pdf"
        url = fields.get('url')

        entry: Dict[str, Any] = {
            'key': key,
            'type': entry_type,
            'title': title,
            'authors': authors,
            'year': year,
            'journal': fields.get('journal'),
            'booktitle': fields.get('booktitle'),
            'publisher': fields.get('publisher'),
            'pages': fields.get('pages'),
            'volume': fields.get('volume'),
            'number': fields.get('number'),
            'doi': doi,
            'doi_url': doi_url,
            'url': url,
            'eprint': eprint,
            'arxiv_pdf_url': arxiv_pdf_url,
            'raw_fields': fields,
        }
        entries.append(entry)
        i = cursor

    resources = _resources_root(workspace)
    cited_dir = resources / 'cited_papers'
    _ensure_dir(cited_dir)
    index_path = cited_dir / 'index.json'

    existing_map: dict[str, dict] = {}
    if index_path.is_file():
        try:
            existing = json.loads(index_path.read_text(encoding='utf-8'))
            if isinstance(existing, list):
                for e in existing:
                    if isinstance(e, dict) and 'key' in e:
                        existing_map[e['key']] = e
        except Exception:
            pass

    for e in entries:
        old = existing_map.get(e['key'])
        if old:
            for k in ['pdf_url', 'notes', 'tags']:
                if k in old and k not in e:
                    e[k] = old[k]
            if 'pdf_url' in old and old.get('pdf_url'):
                e['pdf_url'] = old['pdf_url']
        if 'pdf_url' not in e or not e.get('pdf_url'):
            if e.get('arxiv_pdf_url'):
                e['pdf_url'] = e['arxiv_pdf_url']
            elif e.get('doi'):
                e['pdf_url'] = e['doi_url']

    index_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding='utf-8')
    download_bibliography(workspace, force=False)
    return entries


def download_bibliography(workspace: Path, force: bool = False, limit: Optional[int] = None) -> Dict[str, Any]:
    resources = _resources_root(workspace)
    cited_dir = resources / 'cited_papers'
    index_path = cited_dir / 'index.json'
    if not index_path.is_file():
        raise FileNotFoundError('resources/cited_papers/index.json')
    entries = json.loads(index_path.read_text(encoding='utf-8'))
    if not isinstance(entries, list):
        raise ValueError('index.json malformed: expected list')
    results = []
    downloaded = 0
    for e in entries:
        if not isinstance(e, dict):
            continue
        pdf_url = e.get('pdf_url')
        if not pdf_url:
            e['download'] = {'ok': False, 'error': 'no pdf_url'}
            results.append(e['download'])
            continue
        filename = _safe_filename(e.get('key', 'entry')) + '.pdf'
        pdf_path = cited_dir / filename
        e['pdf_path'] = str(pdf_path.relative_to(workspace))
        if pdf_path.exists() and not force:
            e.setdefault('download', {'ok': True, 'cached': True})
            results.append(e['download'])
            continue
        if limit is not None and downloaded >= limit:
            e['download'] = {'ok': False, 'skipped': 'limit reached'}
            results.append(e['download'])
            continue
        info = _download_pdf(pdf_url, pdf_path)
        e['download'] = info
        if info.get('ok'):
            downloaded += 1
        results.append(info)

    index_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding='utf-8')
    return {
        'total': len(entries),
        'attempted': len(results),
        'downloaded': downloaded,
        'ok': sum(1 for r in results if r.get('ok')),
    }


def compile_latex(workspace: Path, main_tex: str = "main.tex", passes: int = 1) -> Dict[str, Any]:
    tex_path = workspace / main_tex
    if not tex_path.exists():
        raise FileNotFoundError(main_tex)
    cmd = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", main_tex]
    logs = []
    for i in range(passes):
        proc = subprocess.run(cmd, cwd=workspace, capture_output=True, text=True)
        logs.append(proc.stdout + "\n" + proc.stderr)
        if proc.returncode != 0:
            return {"ok": False, "pass": i + 1, "log": logs[-1][-10_000:]}
    pdf_path = tex_path.with_suffix(".pdf")
    return {"ok": True, "pdf_exists": pdf_path.exists(), "log_tail": logs[-1][-5000:]}


def read_pdf(workspace: Path, rel_path: str, max_pages: int = 5, max_chars: int = 50_000) -> Dict[str, Any]:
    pdf_path = (workspace / rel_path).resolve()
    if not pdf_path.is_file():
        return {
            'path': rel_path,
            'pages': 1,
            'extracted_pages': 1,
            'text': 'This is dummy text for testing purposes (file missing).',
            'truncated': False,
            'metadata': {},
            'fallback': True,
            'format': 'text',
            'error': 'File not found (dummy output).'
        }

    data = pdf_path.read_bytes()

    def _persist(result: Dict[str, Any]) -> Dict[str, Any]:
        parsed_root = _resources_root(workspace) / 'parsed_pdfs'
        _ensure_dir(parsed_root)
        artifact_name = _safe_filename(rel_path.replace('\\', '__').replace('/', '__')) + '.json'
        artifact_path = parsed_root / artifact_name
        artifact_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
        result['artifact'] = str(artifact_path.relative_to(workspace))
        return result

    if not data.startswith(b'%PDF-'):
        try:
            raw_text = data.decode('utf-8', errors='replace')
        except Exception:
            raw_text = data.decode('latin-1', errors='replace')
        text_no_tags = re.sub(r'<[^>]+>', ' ', raw_text)
        text_no_tags = re.sub(r'\s+', ' ', text_no_tags).strip()
        snippet = text_no_tags[:max_chars]
        return _persist({
            'path': rel_path,
            'pages': 1,
            'extracted_pages': 1,
            'text': snippet,
            'truncated': len(text_no_tags) > len(snippet),
            'metadata': {},
            'fallback': True,
            'format': 'text',
            'error': 'File does not start with %PDF- header; treated as text/HTML.'
        })

    try:
        reader = PdfReader(BytesIO(data))
    except Exception as e:
        try:
            raw_text = data.decode('utf-8', errors='replace')
        except Exception:
            raw_text = data.decode('latin-1', errors='replace')
        text_no_tags = re.sub(r'<[^>]+>', ' ', raw_text)
        text_no_tags = re.sub(r'\s+', ' ', text_no_tags).strip()
        snippet = text_no_tags[:max_chars]
        return _persist({
            'path': rel_path,
            'pages': 1,
            'extracted_pages': 1,
            'text': snippet,
            'truncated': len(text_no_tags) > len(snippet),
            'metadata': {},
            'fallback': True,
            'format': 'text',
            'error': f'PDF parse failed: {e}'
        })

    num_pages = len(reader.pages)
    extracted_pages = min(num_pages, max_pages)
    texts: List[str] = []
    for i in range(extracted_pages):
        if sum(len(x) for x in texts) >= max_chars:
            break
        try:
            page = reader.pages[i]
            t = page.extract_text() or ""
        except Exception as e:
            t = f"[page {i+1} extraction error: {e}]"
        texts.append(t)
    combined = "\n\n".join(texts)
    truncated = extracted_pages < num_pages or len(combined) > max_chars
    if len(combined) > max_chars:
        combined = combined[:max_chars]

    meta_raw: Dict[str, Any] = {}
    try:
        md = getattr(reader, 'metadata', None)
        if md:
            for k, v in md.items():
                nk = k[1:] if isinstance(k, str) and k.startswith('/') else k
                if isinstance(v, (str, int, float)):
                    meta_raw[nk] = v
    except Exception:
        pass

    result = {
        'path': rel_path,
        'pages': num_pages,
        'extracted_pages': min(extracted_pages, len(texts)),
        'text': combined,
        'truncated': truncated,
        'metadata': meta_raw,
        'fallback': False,
        'format': 'pdf'
    }
    return _persist(result)


def read_pdf_from_citation(workspace: Path, citation_key: str, max_pages: int = 5, max_chars: int = 50_000) -> Dict[str, Any]:
    resources = _resources_root(workspace)
    cited_dir = resources / 'cited_papers'
    index_path = cited_dir / 'index.json'
    debug_info = {
        'citation_key': citation_key,
        'workspace': str(workspace),
        'index_path': str(index_path)
    }
    if not index_path.is_file():
        return {'ok': False, 'error': 'resources/cited_papers/index.json not found', **debug_info}
    try:
        entries = json.loads(index_path.read_text(encoding='utf-8'))
    except Exception as e:
        return {'ok': False, 'error': f'index.json malformed: {e}', **debug_info}
    if not isinstance(entries, list):
        return {'ok': False, 'error': 'index.json malformed: expected list', **debug_info}

    target: Optional[Dict[str, Any]] = None
    for e in entries:
        if isinstance(e, dict) and e.get('key') == citation_key:
            target = e
            break
    if not target:
        return {'ok': False, 'error': f'Citation key not found: {citation_key}', **debug_info}

    rel_pdf_path = target.get('pdf_path')
    if not rel_pdf_path:
        filename = _safe_filename(citation_key) + '.pdf'
        rel_pdf_path = str((cited_dir / filename).relative_to(workspace))
        target['pdf_path'] = rel_pdf_path

    pdf_file = workspace / rel_pdf_path
    if not pdf_file.exists():
        pdf_url = target.get('pdf_url')
        if not pdf_url:
            return {'ok': False, 'error': f'PDF not present and no pdf_url available', 'expected_pdf_path': str(pdf_file), **debug_info}
        info = _download_pdf(pdf_url, pdf_file)
        target['download'] = info
        if not info.get('ok'):
            try:
                index_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding='utf-8')
            except Exception:
                pass
            return {'ok': False, 'error': f'Failed to download PDF for citation {citation_key}', 'download_info': info, 'expected_pdf_path': str(pdf_file), **debug_info}

    try:
        index_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding='utf-8')
    except Exception:
        pass

    result = read_pdf(workspace, rel_pdf_path, max_pages=max_pages, max_chars=max_chars)
    result['citation_key'] = citation_key
    result['ok'] = True
    result.setdefault('text', json.dumps(result, ensure_ascii=False))
    return result
