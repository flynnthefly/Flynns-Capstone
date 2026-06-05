import os
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, send_file, render_template
import io,zipfile
from flask_cors import CORS
from werkzeug.utils import secure_filename
import openslide
from PIL import Image
import re
from urllib.parse import quote
from typing import List, Tuple
from views import views
import database
DB_PATH = 'database.db'

app = Flask(__name__)
CORS(app)
app.register_blueprint(views)
with app.app_context():
      
    # Drop any other tables here
       db = database.get_db()
       #db.execute("DROP TABLE IF EXISTS masks;")
       #db.commit()

       database.create_tables()
       database.close_db()
       print("Database created!")

# --- paths ---
BASE = os.path.dirname(__file__)
UPLOADS = os.path.join(BASE, "uploads")
PATCHES = os.path.join(BASE, "patches")
os.makedirs(UPLOADS, exist_ok=True)
os.makedirs(PATCHES, exist_ok=True)

# FIXED: include proper dotted extensions
ALLOWED = {".svs", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}

def safe_name(name: str) -> str:
    name = secure_filename(name)
    stem, ext = os.path.splitext(name)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    return f"{stem}-{stamp}{ext.lower()}"
#fe

# --------------------------------------------------------------------
# Upload non-SVS files (images/masks etc.)
# --------------------------------------------------------------------
@app.post("/api/upload")
def upload():
    files = request.files.getlist("files")
    items = []
    for f in files:
        if not f or not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED:
            return jsonify(error=f"Not allowed: {ext}"), 400
        fname = safe_name(f.filename)
        f.save(os.path.join(PATCHES, fname))
        items.append({"filename": fname, "url": f"/patches/{fname}"})
    return jsonify(ok=True, items=items)

# --------------------------------------------------------------------
# Convert a single .svs to PNG/JPG (thumbnail preview)
# Returns both the converted image and the saved input svs name
# --------------------------------------------------------------------
@app.post("/api/convert")
def convert_svs():
    f = request.files.get("file")
    out_fmt = (request.form.get("format") or "png").lower()
    print(out_fmt)
    if out_fmt not in ("png", "jpg", "jpeg", "tiff", "tif"):
        return jsonify(error="format must be png, jpg or tiff"), 400
    if not f or not f.filename:
        return jsonify(error="no file"), 400
    if not f.filename.lower().endswith(".svs"):
        return jsonify(error="only .svs supported here"), 400

    # save the uploaded svs
    in_name = safe_name(f.filename)
    in_path = os.path.join(UPLOADS, in_name)
    f.save(in_path)

    # create a manageable preview thumbnail
    slide = openslide.OpenSlide(in_path)
    thumb = slide.get_thumbnail((2000, 2000))
    out_name = os.path.splitext(in_name)[0] + (".jpg" if out_fmt == "jpg" else ".tiff" if out_fmt=='tiff' else ".png")
    out_path = os.path.join(UPLOADS, out_name)
    if out_fmt == "jpg":
        thumb = thumb.convert("RGB")
        thumb.save(out_path, "JPEG", quality=90)
    elif out_fmt == "tiff":
        thumb.save(out_path, "TIFF", compression="jpeg")
    else:
        thumb.save(out_path, "PNG")

    return jsonify(
        ok=True,
        input_file=in_name,               # the saved SVS (used by /api/tiles)
        output_file=out_name,             # the preview image
        url=f"/uploads/{out_name}"
    )

# --------------------------------------------------------------------
# Tile a saved .svs into patches (tiles)
# Form fields:
#   filename: saved svs filename (from /api/convert -> input_file)
#   patches_count: the number of patches from user
#   level:    pyramid level (default 0 = full-res)
#   format:   png|jpg (default png)
#   prefix:   output name prefix
# --------------------------------------------------------------------
@app.post("/api/tiles")
def tile_wsi():
    svs_name = request.form.get("filename")
    if not svs_name:
        return jsonify(error="filename is required"), 400
    
    fmt = (request.form.get("format", "png") or "png").lower()
    fmt_map = {
        "png":  ("png",  "PNG"),
        "jpg":  ("jpg",  "JPEG"),
        "jpeg": ("jpg",  "JPEG"),
        "tif":  ("tif",  "TIFF"),
        "tiff": ("tif",  "TIFF"),
    }
    if fmt not in fmt_map:
        return jsonify(error="format must be one of: png, jpg, jpeg, tif, tiff"), 400

    ext, pil_fmt = fmt_map[fmt]

    # new inputs
    prefix  = request.form.get("name", "new_image")
    target_patches = int(request.form.get("patches", 1))
    level   = int(request.form.get("level", 0))

    svs_path = os.path.join(UPLOADS, secure_filename(svs_name))
    if not os.path.exists(svs_path):
        return jsonify(error=f"SVS not found: {svs_name}"), 404

    slide = openslide.OpenSlide(svs_path)
    try:
        level_w, level_h = slide.level_dimensions[level]
        down = slide.level_downsamples[level]
    except IndexError:
        return jsonify(error=f"Level {level} not available"), 400

    total_pixels = level_w * level_h

    # tile size from desired patch count
    if target_patches <= 0:
        return jsonify(error="patch count must be >0"), 400

    approx_tile_area = total_pixels / target_patches
    # square tile
    tile_size = int((approx_tile_area) ** 0.5)
      # arbitrary lower bound
    if tile_size < 32:
        tile_size = 32

    # recompute actual patch count with stride=tile_size
    def positions(length: int, tile_sz: int):
        if tile_sz >= length:
            return [0]
        xs = list(range(0, length - tile_sz + 1, tile_sz))
        if xs[-1] != length - tile_sz:
            xs.append(length - tile_sz)
        return xs

    xs = positions(level_w, tile_size)
    ys = positions(level_h, tile_size)
    actual_patches = len(xs) * len(ys)

    # if actual doesn’t match target, suggest closest
    diff = abs(actual_patches - target_patches)

    out_dir = PATCHES
    os.makedirs(out_dir, exist_ok=True)

    tiles = []
    count = 0
    for y in ys:
        for x in xs:
            base_x = int(x * down)
            base_y = int(y * down)
            img = slide.read_region((base_x, base_y), level, (tile_size, tile_size)).convert("RGB")
            flag = True

            while flag:
                out_name = f"{prefix}_{count}.{ext}"
                if os.path.exists(os.path.join(out_dir, out_name)):
                    count += 1
                else:
                    flag = False
            img.save(os.path.join(out_dir, out_name), pil_fmt)
            tiles.append(out_name)
            count += 1

    return jsonify(
        ok=True,
        target=target_patches,
        actual=actual_patches,
        suggested=actual_patches if diff > 0 else None,
        tile_size=tile_size,
        count=count,
        dir="",
        base_url=f"/patches/",
    )




_IMG_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")

def _safe_join_under(base: str, sub: str) -> str:
    """
    Join 'sub' under 'base' safely (prevents escaping with ..)
    """
    candidate = os.path.normpath(os.path.join(base, sub))
    base_abs = os.path.abspath(base)
    cand_abs = os.path.abspath(candidate)
    if os.path.commonpath([base_abs, cand_abs]) != base_abs:
        # fall back to base if someone tries to break out
        return base
    return candidate

# --------------------------------------------------------------------
# Render any stored image (esp. TIFF) as PNG/JPG for browser display
# --------------------------------------------------------------------
@app.get("/api/render")
def render_image():
    """
    Query:
      file=<relative path under PATCHES or UPLOADS>
      fmt=png|jpg (default png)
      page=<int>  (multi-page TIFF)
      scale=<float> (optional downscale, e.g., 0.5)
    """
    rel = (request.args.get("file") or "").strip()
    fmt = (request.args.get("fmt") or "png").lower()
    def _to_int(v, default):
        try: return int(v)
        except (TypeError, ValueError): return default

    def _to_float(v, default):
        try: return float(v)
        except (TypeError, ValueError): return default
    page_raw = request.args.get("page", "0")
    scale_raw = request.args.get("scale", "1.0")
    # if they pass junk, reject with 400
    if page_raw not in (None, ""):
        try:
            page = int(page_raw)
        except ValueError:
            return jsonify(error="page must be an integer"), 400
    else:
        page = 0

    if scale_raw not in (None, ""):
        try:
            scale = float(scale_raw)
        except ValueError:
            return jsonify(error="scale must be a number"), 400
    else:
        scale = 1.0

    if scale <= 0:
        return jsonify(error="scale must be > 0"), 400

    if fmt not in ("png", "jpg", "jpeg", "tiff", "tif"):
        fmt = "png"

    # Resolve safely under PATCHES then UPLOADS
    src_path = _safe_join_under(PATCHES, rel)
    if not os.path.isfile(src_path):
        src_path = _safe_join_under(UPLOADS, rel)
    if not os.path.isfile(src_path):
        return jsonify(error=f"not found: {rel}"), 404

    try:
        im = Image.open(src_path)

        # Multi-frame support (TIFF etc.)
        try:
            if page >= 0:
                im.seek(page)
        except Exception:
            pass

        # Optional downscale
        if scale and scale != 1.0:
            w, h = im.size
            im = im.resize((max(1, int(w*scale)), max(1, int(h*scale))), Image.LANCZOS)

        bio = io.BytesIO()
        if fmt in ("jpg", "jpeg"):
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                # If RGBA, use alpha as mask
                mask = im.split()[-1] if im.mode == "RGBA" else None
                bg.paste(im, mask=mask)
                im = bg
            else:
                im = im.convert("RGB")
            im.save(bio, "JPEG", quality=90, optimize=True)
            mime = "image/jpeg"
        else:
            if im.mode == "P":
                im = im.convert("RGBA")
            im.save(bio, "PNG", optimize=True)
            mime = "image/png"

        bio.seek(0)
        resp = send_file(bio, mimetype=mime)
        resp.headers["Cache-Control"] = "public, max-age=86400"
        return resp
    except Exception as e:
        return jsonify(error=f"render failed: {type(e).__name__}: {e}"), 500
    


def _nat_key(s: str):
    """
    Generate a natural sort key:
    'img2.png' < 'img10.png'
    """
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r'(\d+)', s)]

# --------------------------------------------------------------------
# List images inside PATCHES (recursively)
# GET /api/list_patches?dir=<subdir>&sort=name|mtime&order=asc|desc
# Returns: { ok, base_url, items:[{filename, subdir, url, mtime, display_url}] }
# --------------------------------------------------------------------
@app.get("/api/list_patches")
def list_patches():
    subdir = request.args.get("dir", "").strip().replace("\\", "/")
    sort   = request.args.get("sort", "name").lower()   # name|nat|mtime
    order  = request.args.get("order", "asc").lower()   # asc|desc

    # Resolve the root we will walk
    root = PATCHES if not subdir else _safe_join_under(PATCHES, subdir)

    if not os.path.isdir(root):
        return jsonify(ok=True, base_url="/patches/", items=[])

    items = []
    for cur_dir, _dirs, files in os.walk(root):
        # rel path from PATCHES ('' means top-level)
        rel = os.path.relpath(cur_dir, PATCHES).replace("\\", "/")
        rel = "" if rel == "." else rel

        for fname in files:
            if not fname.lower().endswith(_IMG_EXTS):
                continue
            fpath = os.path.join(cur_dir, fname)
            try:
                mtime = os.path.getmtime(fpath)
            except OSError:
                continue

            if rel:
                url = f"/patches/{rel}/{fname}"
            else:
                url = f"/patches/{fname}"

            # NEW: display_url always browser-friendly (TIFF -> render as PNG)
            low = fname.lower()
            if rel:
                rel_path = f"{rel}/{fname}"
            else:
                rel_path = fname
            if low.endswith((".tif", ".tiff")):
                display_url = f"/api/render?file={quote(rel_path)}&fmt=png"
            else:
                display_url = url

            items.append({
                "filename": fname,
                "subdir": rel,
                "url": url,
                "display_url": display_url,
                "mtime": int(mtime)
            })

    # Sorting
    order = (request.args.get("order", "asc") or "asc").lower()
    order = "desc" if order == "desc" else "asc"  # normalize
    reverse = (order == "desc")  

    if sort == "mtime":
        items.sort(key=lambda it: it["mtime"], reverse=reverse)
    else:
        # default nat by "filename"
        items.sort(key=lambda it: _nat_key(it["filename"]), reverse=reverse)

    return jsonify(ok=True, base_url="/patches/", items=items)


# ---------------------------------------------------------------------------------------------------------------
# new function for export
@app.get("/")
def index():
    # let Flask return  website.html directly
    return render_template("website.html")


@app.post("/api/export")
def export_selected():
    data = request.get_json(silent=True) or {}
    files = data.get("files", [])
    fmt = (data.get("format") or "keep").lower()

    if not files:
        return jsonify(error="no files selected"), 400
    if fmt not in ("keep", "png", "jpg", "tiff"):
        return jsonify(error="invalid format"), 400

    if len(files) != 1:
        return jsonify(error="multiple file export is handled by frontend"), 400

    rel = files[0]
    src_path = _safe_join_under(PATCHES, rel)
    if not os.path.isfile(src_path):
        return jsonify(error=f"not found: {rel}"), 404

    # ------------------------------
    from PIL import ImageDraw
    import json
    import database
    img = Image.open(src_path).convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    # chenck masks in database 
    db = database.get_db()
    img_row = db.execute("SELECT id FROM images WHERE filename = ?", (rel,)).fetchone()
    if img_row:
        masks = db.execute("""
            SELECT m.location_data, c.name, c.colour AS cell_colour
            FROM masks m JOIN CELLTYPE c ON m.celltype = c.id
            WHERE m.image = ?;
        """, (img_row["id"],)).fetchall()
        for m in masks:
            try:
                coords = json.loads(m["location_data"])
            except Exception:
                continue
            colour = m["cell_colour"] or "#FF000080"

            # if coords[0] != coords[-1]:
            #     coords.append(coords[0])

            # use line to draw the mask
            draw.line(coords, fill=colour, width=4) # adjust mask width 

    if fmt == "keep":
        fmt = "png"

    # output as the target format
    bio = io.BytesIO()
    if fmt == "jpg":
        img = img.convert("RGB")
        img.save(bio, "JPEG", quality=90)
        mime = "image/jpeg"
        ext = "jpg"
    elif fmt == "tiff":
        img.save(bio, "TIFF", compression="tiff_lzw")
        mime = "image/tiff"
        ext = "tiff"
    else:
        img.save(bio, "PNG")
        mime = "image/png"
        ext = "png"

    bio.seek(0)
    stem, _ = os.path.splitext(os.path.basename(rel))
    return send_file(
        bio,
        mimetype=mime,
        as_attachment=True,
        download_name=f"{stem}_with_masks.{ext}"
    )
#--------------------------------------------------------------------------------------------------


# --------------------------------------------------------------------
# Rename the file
# --------------------------------------------------------------------
@app.post("/api/rename")
def rename_image():
    data = request.get_json(force=True)
    old_name = data.get("old")
    new_name = data.get("new")
    subdir = data.get("subdir") or ""

    if not id or not new_name:
        return jsonify(error="id and new name are required"), 400
    
    if not old_name or not new_name:
        return jsonify(error="old and new names are required"), 400
    
    if subdir:
        return jsonify(error="subdirectories are not supported"), 400
    
    # Hard block path separators and traversal attempts
    def _bad(name: str) -> bool:
        if "/" in name or "\\" in name:
            return True
        # reject any dot-dot segment (.., a/../b, etc.)
        parts = name.split(".")
        if ".." in name or any(p == ".." for p in name.replace("\\", "/").split("/")):
            return True
        return False
    
    if _bad(old_name) or _bad(new_name):
        return jsonify(error="filenames must not contain path separators or '..'"), 400

    folder = os.path.join(PATCHES)
    old_path = os.path.join(folder, old_name)
    new_path = os.path.join(folder, new_name)
    patch_abs = os.path.abspath(PATCHES)
    if os.path.commonpath([patch_abs, os.path.abspath(old_path)]) != patch_abs:
        return jsonify(error="invalid old path"), 400
    if os.path.commonpath([patch_abs, os.path.abspath(new_path)]) != patch_abs:
        return jsonify(error="invalid new path"), 400

    if not os.path.exists(old_path):
        return jsonify(error="file not found"), 404
    
    if os.path.exists(new_path):
        return jsonify(error="duplicate filename"), 409
    
    try:
        # Try filesystem rename
        os.rename(old_path, new_path)
    except Exception as fs_err:
        return jsonify(error=f"rename failed: {fs_err}"), 500
    
    try:
        # 2) Update DB
        db = database.get_db()
        db.execute("UPDATE images SET filename = ? WHERE filename = ?", (new_name, old_name))
        db.commit()
    except Exception as db_err:
        # 3) Best-effort: revert FS so FS+DB remain consistent
        try:
            os.rename(new_path, old_path)
        except Exception:
            # If we can't revert the file, report both issues
            return jsonify(error=f"db error after rename and file revert failed: {db_err}"), 500
        return jsonify(error=f"db error: {db_err}"), 500

    # Success — build display URL (TIFF via /api/render)
    if new_name.lower().endswith((".tif", ".tiff")):
        display_url = f"/api/render?file={quote(new_name)}&fmt=png"
    else:
        display_url = f"/patches/{new_name}"

    return jsonify(ok=True,
                   filename=new_name,
                   url=f"/patches/{new_name}",
                   display_url=display_url)
    

# --------------------------------------------------------------------
# Remove the file
# --------------------------------------------------------------------
@app.post("/api/remove")
def remove_image():
    data = request.get_json(force=True)
    subdir   = (data.get("subdir") or "").strip()
    filename = (data.get("filename") or "").strip()

    if not filename:
        return jsonify(error="filename required"), 400

    folder = os.path.join(PATCHES, subdir) if subdir else PATCHES
    path   = os.path.join(folder, filename)

    if not os.path.exists(path):
        return jsonify(error="file not found"), 404
    
    db = database.get_db()
    try:
        db.execute("DELETE FROM images WHERE filename = ?", (filename,))
        db.commit()
        os.remove(path)
        return jsonify({"ok": True, "removed": filename})
    except OSError as e:
        return jsonify(error=str(e)), 500

# --------------------------------------------------------------------
# Serve uploaded/produced files (dev only)
# --------------------------------------------------------------------
@app.get("/uploads/<path:name>")
def serve_upload(name):
    return send_from_directory(UPLOADS, name)

@app.get("/patches/<path:name>")
def serve_patches(name):
    return send_from_directory(PATCHES, name)


if __name__ == "__main__":
    app.run(port=5000, debug=True)
