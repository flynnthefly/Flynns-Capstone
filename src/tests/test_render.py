# tests/test_render.py
import io
import os
import importlib
import pytest
from PIL import Image, TiffImagePlugin

@pytest.fixture()
def app_and_tmp(tmp_path, monkeypatch):
    # Import your app module
    app_mod = importlib.import_module("app")

    # Redirect PATCHES & UPLOADS to temporary dirs
    patches = tmp_path / "patches"
    uploads = tmp_path / "uploads"
    patches.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    app_mod.PATCHES = str(patches)
    app_mod.UPLOADS = str(uploads)

    app_mod.app.config.update(TESTING=True)
    yield app_mod, patches, uploads

@pytest.fixture()
def client(app_and_tmp):
    app_mod, *_ = app_and_tmp
    return app_mod.app.test_client()

def _save_png_rgba(path, size=(20, 10), color=(0, 0, 255, 128)):
    img = Image.new("RGBA", size, color)
    img.save(path, "PNG")

def _save_png_rgb(path, size=(18, 12), color=(10, 200, 10)):
    img = Image.new("RGB", size, color)
    img.save(path, "PNG")

def _save_multipage_tiff(path):
    p0 = Image.new("RGB", (16, 16), (255, 0, 0))
    p1 = Image.new("RGB", (16, 16), (0, 255, 0))
    p0.save(path, format="TIFF", save_all=True, append_images=[p1])

def _img_from_response(resp):
    bio = io.BytesIO(resp.data)
    return Image.open(bio)

def test_render_png_default(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    p = patches / "a.png"
    _save_png_rgb(p)

    r = client.get("/api/render", query_string={"file": "a.png"})
    assert r.status_code == 200
    assert r.mimetype == "image/png"
    assert "Cache-Control" in r.headers
    img = _img_from_response(r)
    assert img.format == "PNG"
    assert img.size == (18, 12)
    record_actuals(1, "Render PNG (default)", r,
                   {"mimetype": r.mimetype, "size": img.size, "format": img.format})

def test_render_rgba_to_jpg(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    p = patches / "rgba.png"
    _save_png_rgba(p)  # semi-transparent blue

    r = client.get("/api/render", query_string={"file": "rgba.png", "fmt": "jpg"})
    assert r.status_code == 200
    assert r.mimetype == "image/jpeg"
    img = _img_from_response(r)
    assert img.format == "JPEG"
    assert img.mode == "RGB"
    record_actuals(2, "Render RGBA PNG → JPG (alpha flattened)", r,
                   {"mimetype": r.mimetype, "format": img.format, "mode": img.mode})

def test_render_from_uploads_dir(client, app_and_tmp, record_actuals):
    app_mod, _, uploads = app_and_tmp
    q = uploads / "u.png"
    _save_png_rgb(q, size=(9, 7))

    r = client.get("/api/render", query_string={"file": "u.png"})
    assert r.status_code == 200
    img = _img_from_response(r)
    assert img.size == (9, 7)
    record_actuals(3, "Render from UPLOADS", r, {"size": img.size})

def test_render_multipage_tiff_page_selection(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    t = patches / "m.tiff"
    _save_multipage_tiff(t)

    # Valid page 1
    r1 = client.get("/api/render", query_string={"file": "m.tiff", "page": "1"})
    assert r1.status_code == 200
    # Out of range falls back silently to first frame (still 200)
    r2 = client.get("/api/render", query_string={"file": "m.tiff", "page": "9"})
    assert r2.status_code == 200
    record_actuals(4, "Render multipage TIFF (page=1 and out-of-range→fallback)", r1,
                   {"page1_status": r1.status_code, "page9_status": r2.status_code})

def test_render_with_scale_half_size(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    p = patches / "big.png"
    _save_png_rgb(p, size=(40, 20))

    r = client.get("/api/render", query_string={"file": "big.png", "scale": "0.5"})
    assert r.status_code == 200
    img = _img_from_response(r)
    assert img.size == (20, 10)
    record_actuals(5, "Render with scale=0.5", r, {"size": img.size})

def test_render_not_found_404(client, record_actuals):
    r = client.get("/api/render", query_string={"file": "nope.png"})
    assert r.status_code == 404
    assert "not found" in r.get_json()["error"]
    record_actuals(6, "Render missing file → 404", r)


def test_render_path_traversal_blocked(client, app_and_tmp, record_actuals):
    # Tries to escape into uploads via ../
    r = client.get("/api/render", query_string={"file": "../uploads/hack.png"})
    assert r.status_code == 404
    record_actuals(7, "Render traversal blocked", r)

def test_render_unknown_fmt_fallsback_to_png(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    p = patches / "c.png"
    _save_png_rgb(p)

    r = client.get("/api/render", query_string={"file": "c.png", "fmt": "bmp"})
    assert r.status_code == 200
    assert r.mimetype == "image/png"
    record_actuals(8, "Unknown fmt → fallback to PNG", r, {"mimetype": r.mimetype})

def test_render_bad_query_types_400(client, app_and_tmp, record_actuals):
    app_mod, patches, _ = app_and_tmp
    p = patches / "v.png"
    _save_png_rgb(p)

    r1 = client.get("/api/render", query_string={"file": "v.png", "page": "abc"})
    assert r1.status_code == 400
    assert "page" in r1.get_json()["error"].lower()
    record_actuals(9, "Bad query type: page='abc' → 400", r1)

    r2 = client.get("/api/render", query_string={"file": "v.png", "scale": "oops"})
    assert r2.status_code == 400
    assert "scale" in r2.get_json()["error"].lower()
    record_actuals(10, "Bad query type: scale='oops' → 400", r2)
