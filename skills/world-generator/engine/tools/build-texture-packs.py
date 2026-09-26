#!/usr/bin/env python3
"""Build CC0 PBR texture packs for the world-generator skill.

Downloads ambientCG 1K-JPG zips (CC0), extracts Color/NormalGL/Roughness,
recompresses with PIL to keep embedded size sane, and fetches a Poly Haven
HDRI (CC0) for IBL. Output: engine/assets-bin/packs/<slot>/{color,normalGL,roughness}.jpg
plus engine/assets-bin/hdri/<name>.hdr
"""
import io
import json
import os
import subprocess
import sys
import zipfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
PACKS = os.path.join(ROOT, "assets-bin", "packs")
HDRI = os.path.join(ROOT, "assets-bin", "hdri")
CACHE = "/tmp/opencode/ambientcg-cache"

# slot -> list of sources to try in order (first that downloads wins).
# ambientCG IDs are plain strings; Poly Haven slugs use the "ph:" prefix.
SLOTS = {
    "grass": ["Grass001"],
    "dirt": ["ph:forest_ground_04"],
    "rock": ["Rock034"],
    "concrete": ["Concrete034"],
    "asphalt": ["Asphalt013"],
    "stucco": ["Plaster001"],
    "brick": ["ph:brick_wall_001"],
    "wood": ["Wood026"],
    "rooftile": ["RoofingTiles002", "RoofingTiles011", "RoofingTiles008"],
    "metal": ["Metal031", "Metal022", "Metal017"],
    "bark": ["Bark012", "Bark006", "Bark004"],
    "gravel": ["Gravel012", "Gravel025", "Gravel010"],
}

# recompression profile per map (quality, max dimension)
PROFILE = {
    "color": (80, 1024),
    "normalGL": (88, 1024),
    "roughness": (78, 1024),
}

HDRIS = {
    "day_partly_cloudy_1k.hdr": (
        "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/"
        "kloofendal_48d_partly_cloudy_1k.hdr"
    ),
}


def fetch(url, dest):
    r = subprocess.run(
        ["curl", "-sL", "--max-time", "180", "-o", dest, url],
        capture_output=True,
    )
    return r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 1000


PH_MAPS = {"color": "Diffuse", "normalGL": "nor_gl", "roughness": "Rough"}


def fetch_polyhaven(slug):
    """Download the three 1k jpg maps for a Poly Haven texture slug."""
    api = f"https://api.polyhaven.com/files/{slug}"
    r = subprocess.run(
        ["curl", "-sL", "--max-time", "60", api], capture_output=True, text=True
    )
    try:
        import json as _json

        files = _json.loads(r.stdout)
        out = {}
        for map_name, key in PH_MAPS.items():
            url = files[key]["1k"]["jpg"]["url"]
            dest = os.path.join(CACHE, f"{slug}_{map_name}_1k.jpg")
            if not os.path.exists(dest) and not fetch(url, dest):
                return None
            with open(dest, "rb") as f:
                out[map_name] = f.read()
        return out
    except Exception:
        return None


def load_zip(path):
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return None


def extract_member(z, id_, suffix):
    name = f"{id_}_1K-JPG_{suffix}.jpg"
    try:
        return z.read(name)
    except KeyError:
        return None


def recompress(raw, quality, maxdim):
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if max(img.size) > maxdim:
        img.thumbnail((maxdim, maxdim), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality, optimize=True)
    return out.getvalue(), img.size


def main():
    os.makedirs(PACKS, exist_ok=True)
    os.makedirs(HDRI, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    manifest = {}
    total = 0

    for slot, ids in SLOTS.items():
        maps_bytes = None
        used = None
        for id_ in ids:
            if id_.startswith("ph:"):
                slug = id_[3:]
                got = fetch_polyhaven(slug)
                if got is not None:
                    maps_bytes, used = got, f"polyhaven.com/{slug}"
                    break
                continue
            cache = os.path.join(CACHE, f"{id_}_1K-JPG.zip")
            if not os.path.exists(cache):
                if not fetch(
                    f"https://ambientcg.com/get?file={id_}_1K-JPG.zip", cache
                ):
                    continue
            z = load_zip(cache)
            if z is None:
                continue
            got = {}
            for map_name, suffix in {
                "color": "Color", "normalGL": "NormalGL", "roughness": "Roughness"
            }.items():
                raw = extract_member(z, id_, suffix)
                if raw is None:
                    got = None
                    break
                got[map_name] = raw
            if got is not None:
                maps_bytes, used = got, f"ambientcg.com/{id_}"
                break
        if maps_bytes is None:
            print(f"FAIL {slot}: no working source in {ids}")
            continue

        outdir = os.path.join(PACKS, slot)
        os.makedirs(outdir, exist_ok=True)
        entry = {"source": used, "maps": {}}
        for map_name, (quality, maxdim) in PROFILE.items():
            data, size = recompress(maps_bytes[map_name], quality, maxdim)
            path = os.path.join(outdir, f"{map_name}.jpg")
            with open(path, "wb") as f:
                f.write(data)
            entry["maps"][map_name] = {"file": f"{map_name}.jpg", "bytes": len(data), "size": size}
            total += len(data)
        manifest[slot] = entry
        mb = sum(m["bytes"] for m in entry["maps"].values()) / 1e6
        print(f"OK {slot} <- {used}: {mb:.2f} MB")

    for name, url in HDRIS.items():
        dest = os.path.join(HDRI, name)
        if not os.path.exists(dest):
            if not fetch(url, dest):
                print(f"FAIL hdri {name}")
                continue
        manifest.setdefault("__hdri__", {"files": {}})
        manifest["__hdri__"]["files"][name] = os.path.getsize(dest)
        total += os.path.getsize(dest)
        print(f"OK hdri {name}: {os.path.getsize(dest)/1e6:.2f} MB")

    with open(os.path.join(ROOT, "assets-bin", "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nTOTAL raw: {total/1e6:.2f} MB  (base64 ~{total*1.34/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
