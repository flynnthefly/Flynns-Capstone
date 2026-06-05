# tests/test_convert.py
import io
import os
import re
import importlib
from datetime import datetime
from PIL import Image
import pytest
from werkzeug.datastructures import FileMultiDict

class FakeSlide:
    def __init__(self, path):
        # could assert path exists; keep simple
        self._path = path
    def get_thumbnail(self, size):
        # Return a tiny image; Pillow will re-save with requested format
        return Image.new("RGB", (10, 10), (0, 255, 0))

@pytest.fixture()
def app_mod(tmp_path, monkeypatch):
    # Import your app module fresh so globals are bound
    app = importlib.import_module("app")

    # Redirect UPLOADS to a tmp folder
    uploads = tmp_path / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    app.UPLOADS = str(uploads)

    # Monkeypatch OpenSlide
    import openslide
    monkeypatch.setattr(openslide, "OpenSlide", lambda p: FakeSlide(p))

    return app

@pytest.fixture()
def client(app_mod):
    app_mod.app.config.update(TESTING=True)
    return app_mod.app.test_client()

def _post_svs(client, fname="slide.svs", fmt="png"):
    fmd = FileMultiDict()
    # Content can be empty; FakeSlide doesn't read it
    fmd.add_file("file", io.BytesIO(b"dummy"), filename=fname, content_type="application/octet-stream")
    fmd.add("format", fmt)
    return client.post("/api/convert", data=fmd, content_type="multipart/form-data")

def _read_image(path):
    with Image.open(path) as im:
        return im.format, im.mode, im.size

def test_convert_png_success(client, app_mod, record_actuals):
    r = _post_svs(client, "slide.svs", "png")
    assert r.status_code == 200
    js = r.get_json()
    assert js["ok"] is True
    assert js["input_file"].lower().endswith(".svs")
    assert js["output_file"].lower().endswith(".png")
    out_path = os.path.join(app_mod.UPLOADS, js["output_file"])
    assert os.path.exists(out_path)
    fmt, mode, size = _read_image(out_path)
    assert fmt == "PNG"
    assert size == (10, 10)
    record_actuals(
        1,
        "Convert SVS to PNG",
        r,
        {"output_file": js["output_file"], "exists": os.path.exists(out_path)}
    )

def test_convert_jpg_success_rgb(client, app_mod, record_actuals):
    r = _post_svs(client, "slide.svs", "jpg")
    assert r.status_code == 200
    js = r.get_json()
    out_path = os.path.join(app_mod.UPLOADS, js["output_file"])
    fmt, mode, size = _read_image(out_path)
    assert js["output_file"].lower().endswith(".jpg")
    assert fmt in ("JPEG", "JPG")
    assert mode == "RGB"
    record_actuals(
        2,
        "Convert SVS to JPG",
        r,
        {"output_file": js["output_file"], "path": out_path}
    )

def test_convert_tiff_success(client, app_mod, record_actuals):
    r = _post_svs(client, "slide.svs", "tiff")
    assert r.status_code == 200
    js = r.get_json()
    out_path = os.path.join(app_mod.UPLOADS, js["output_file"])
    fmt, mode, size = _read_image(out_path)
    assert js["output_file"].lower().endswith(".tiff")
    assert fmt == "TIFF"
    record_actuals(3, "Convert SVS to TIFF", r,
                   {"output_file": js["output_file"], "path": out_path})

def test_filename_sanitized_and_timestamped(client, app_mod, record_actuals):
    r = _post_svs(client, "Weird Name (1).SVS", "png")
    assert r.status_code == 200
    js = r.get_json()
    in_name = js["input_file"]
    # secure_filename removes spaces/parens; timestamp suffix present
    stem, ext = os.path.splitext(in_name)
    assert ext.lower() == ".svs"
    assert re.search(r"-\d{8}-\d{6}-\d{6}$", stem) is not None
    record_actuals(4, "Filename sanitized & timestamped", r,
                   {"input_file": in_name})

def test_uppercase_svs_allowed(client, record_actuals):
    r = _post_svs(client, "MY.SVS", "jpg")
    assert r.status_code == 200
    record_actuals(5, "Uppercase .SVS allowed (-> JPG)", r)

def test_missing_file_returns_400(client, record_actuals):
    r = client.post("/api/convert", data={"format": "png"}, content_type="multipart/form-data")
    assert r.status_code == 400
    assert "no file" in r.get_json()["error"].lower()
    record_actuals(6, "Missing file -> 400", r)

def test_non_svs_rejected(client, record_actuals):
    fmd = FileMultiDict()
    fmd.add_file("file", io.BytesIO(b"x"), filename="a.tiff", content_type="image/tiff")
    fmd.add("format", "png")
    r = client.post("/api/convert", data=fmd, content_type="multipart/form-data")
    assert r.status_code == 400
    assert "only .svs" in r.get_json()["error"].lower()
    record_actuals(7, "Non-SVS rejected -> 400", r)

def test_unsupported_format_rejected(client, record_actuals):
    r = _post_svs(client, "slide.svs", "gif")
    assert r.status_code == 400
    assert "format must be" in r.get_json()["error"].lower()
    record_actuals(8, "Unsupported output format -> 400", r)
