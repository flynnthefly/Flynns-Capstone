# tests/test_tiles.py
import io
import os
import importlib
import pytest
from PIL import Image

class FakeSlide:
    """Configurable fake OpenSlide with N levels."""
    def __init__(self, level_dimensions, level_downsamples):
        self.level_dimensions = level_dimensions
        self.level_downsamples = level_downsamples

    def read_region(self, location, level, size):
        # Return an RGB image of exactly (w,h) requested
        w, h = size
        return Image.new("RGB", (w, h), (50, 200, 50))

def make_fake_openslide(level_dims, downsamples):
    """Factory returning a callable that mimics openslide.OpenSlide."""
    def _ctor(path):
        # 'path' is ignored by our fake
        return FakeSlide(level_dims, downsamples)
    return _ctor

@pytest.fixture()
def app_and_tmp(tmp_path, monkeypatch):
    app_mod = importlib.import_module("app")

    # Redirect folders
    uploads_dir = tmp_path / "uploads"
    patches_dir = tmp_path / "patches"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    patches_dir.mkdir(parents=True, exist_ok=True)
    app_mod.UPLOADS = str(uploads_dir)
    app_mod.PATCHES = str(patches_dir)

    # Default fake: single level 100x60 at level 0
    fake_ctor = make_fake_openslide([(100, 60)], [1.0])
    app_mod.openslide.OpenSlide = fake_ctor  # monkey-patch

    app_mod.app.config.update(TESTING=True)
    yield app_mod, uploads_dir, patches_dir

@pytest.fixture()
def client(app_and_tmp):
    app_mod, _, _ = app_and_tmp
    return app_mod.app.test_client()

def _touch(path):
    with open(path, "wb") as f:
        f.write(b"fake-svs")

def test_tiles_png_default_ok(client, app_and_tmp, record_actuals):
    app_mod, uploads_dir, patches_dir = app_and_tmp
    svs = "foo.svs"
    _touch(os.path.join(uploads_dir, svs))

    r = client.post(
        "/api/tiles",
        data={
            "filename": svs,
            "patches": "6",     # target
            "level": "0"        # existing level
            # no format -> default png
        },
        content_type="multipart/form-data",
    )
    assert r.status_code == 200
    js = r.get_json()
    assert js["ok"] is True
    assert js["base_url"] == "/patches/"
    assert js["tile_size"] >= 32
    # ensure exactly 'count' files exist and they are .png
    files = os.listdir(patches_dir)
    assert len(files) == js["count"]
    assert all(f.lower().endswith(".png") for f in files)
    record_actuals(1, "PNG default tiling succeeds", r, {"count": len(files)})

def test_tiles_jpg_prefix_and_uniqueness(client, app_and_tmp, record_actuals):
    app_mod, uploads_dir, patches_dir = app_and_tmp
    svs = "bar.svs"
    _touch(os.path.join(uploads_dir, svs))

    # Pre-create a file to force the collision logic
    pre = patches_dir / "mytile_0.jpg"
    pre.write_bytes(b"old")

    r = client.post(
        "/api/tiles",
        data={
            "filename": svs,
            "patches": "4",
            "level": "0",
            "format": "jpg",
            "name": "mytile",
        },
        content_type="multipart/form-data",
    )
    assert r.status_code == 200
    files = os.listdir(patches_dir)
    # We should have original + new ones; none should overwrite 'mytile_0.jpg'
    assert pre.exists()
    new_files = [f for f in files if f.startswith("mytile_")]
    assert len(new_files) >= 1
    assert all(f.endswith(".jpg") for f in new_files)
    assert len(set(new_files)) == len(new_files)  # all unique
    record_actuals(2, "JPG tiling with prefix; ensure uniqueness", r, {"file_count": len(files)})


def test_tiles_missing_filename_400(client, record_actuals):
    r = client.post("/api/tiles", data={"patches": "4"}, content_type="multipart/form-data")
    assert r.status_code == 400
    assert "filename is required" in r.get_json()["error"]
    record_actuals(3, "Missing filename rejected", r)

def test_tiles_missing_file_on_disk_404(client, app_and_tmp, record_actuals):
    r = client.post(
        "/api/tiles",
        data={"filename": "nope.svs", "patches": "2"},
        content_type="multipart/form-data",
    )
    assert r.status_code == 404
    assert "SVS not found" in r.get_json()["error"]
    record_actuals(4, "Missing SVS file returns 404", r)

def test_tiles_invalid_level_400(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, uploads_dir, _ = app_and_tmp
    svs = "z.svs"
    _touch(os.path.join(uploads_dir, svs))

    # Only one level -> index 1 should be invalid
    r = client.post(
        "/api/tiles",
        data={"filename": svs, "patches": "2", "level": "5"},
        content_type="multipart/form-data",
    )
    assert r.status_code == 400
    assert "Level" in r.get_json()["error"]
    record_actuals(5, "Invalid level rejected", r)

def test_tiles_non_positive_patches_400(client, app_and_tmp, record_actuals):
    app_mod, uploads_dir, _ = app_and_tmp
    svs = "n.svs"
    _touch(os.path.join(uploads_dir, svs))

    r = client.post(
        "/api/tiles",
        data={"filename": svs, "patches": "0"},
        content_type="multipart/form-data",
    )
    assert r.status_code == 400
    assert "patch count must be >0" in r.get_json()["error"]
    record_actuals(6, "Non-positive patch count rejected", r)

def test_tiles_small_slide_uses_min_tile_and_one_patch(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, uploads_dir, patches_dir = app_and_tmp
    svs = "tiny.svs"
    _touch(os.path.join(uploads_dir, svs))

    # Replace OpenSlide with a tiny level (16x16) so tile_size->32 and single patch
    app_mod.openslide.OpenSlide = make_fake_openslide([(16, 16)], [1.0])

    r = client.post(
        "/api/tiles",
        data={"filename": svs, "patches": "10", "level": "0", "format": "png"},
        content_type="multipart/form-data",
    )
    assert r.status_code == 200
    js = r.get_json()
    assert js["actual"] == 1
    assert js["tile_size"] >= 32
    files = os.listdir(patches_dir)
    assert len(files) == js["count"] == 1
    assert files[0].endswith(".png")
    record_actuals(7, "Tiny slide uses min tile size and one patch", r, {"tile_size": js["tile_size"], "actual": js["actual"]})

def test_tiles_unknown_format_400(client, app_and_tmp, record_actuals):
    app_mod, uploads_dir, _ = app_and_tmp
    svs = "badfmt.svs"
    _touch(os.path.join(uploads_dir, svs))

    r = client.post(
        "/api/tiles",
        data={"filename": svs, "patches": "2", "format": "bmp"},
        content_type="multipart/form-data",
    )
    assert r.status_code == 400
    msg = r.get_json()["error"].lower()
    # match your endpoint’s message; adjust text if you changed it
    assert "format" in msg and ("png" in msg and "jpg" in msg)
    record_actuals(8, "Unknown output format rejected", r)
