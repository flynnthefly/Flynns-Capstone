import io, os
from PIL import Image

# ---------- /api/upload ----------
def test_upload_allows_images(client, png_bytes):
    data = {
        "files": (io.BytesIO(png_bytes), "x.png")
    }
    res = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert res.status_code == 200
    j = res.get_json()
    assert j["ok"] is True
    assert j["items"][0]["filename"].endswith(".png")

def test_upload_rejects_exe(client):
    data = {
        "files": (io.BytesIO(b"notreal"), "bad.exe")
    }
    res = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert res.status_code == 400
    assert "Not allowed" in res.get_json()["error"]

# ---------- /api/convert ----------
def test_convert_requires_file(client):
    res = client.post("/api/convert", data={})
    assert res.status_code == 400
    assert "no file" in res.get_json()["error"]

def test_convert_rejects_non_svs(client):
    data = {"file": (io.BytesIO(b"xxx"), "a.tiff")}
    res = client.post("/api/convert", data=data, content_type="multipart/form-data")
    assert res.status_code == 400
    assert "only .svs supported" in res.get_json()["error"]

def test_convert_bad_format(client):
    data = {"file": (io.BytesIO(b"xxx"), "a.svs"), "format": "bmp"}
    res = client.post("/api/convert", data=data, content_type="multipart/form-data")
    assert res.status_code == 400
    assert "format must be" in res.get_json()["error"]

def test_convert_ok_with_mock(monkeypatch, client, mock_openslide):
    data = {"file": (io.BytesIO(b"svsdata"), "slide.svs"), "format": "png"}
    res = client.post("/api/convert", data=data, content_type="multipart/form-data")
    assert res.status_code == 200
    j = res.get_json()
    assert j["ok"] is True
    assert j["input_file"].endswith(".svs")
    assert j["output_file"].endswith(".png")

# ---------- /api/tiles ----------
def test_tiles_requires_filename(client):
    res = client.post("/api/tiles", data={"patches": "4"})
    assert res.status_code == 400
    assert "filename is required" in res.get_json()["error"]

def test_tiles_404_when_svs_missing(client):
    res = client.post("/api/tiles", data={"filename": "ghost.svs"})
    assert res.status_code == 404

def test_tiles_generates_with_mock(client, mock_openslide, tmp_path, monkeypatch):
    # Prepare a fake svs saved by convert step
    fake_svs = (tmp_path / "uploads" / "fake.svs")
    fake_svs.parent.mkdir(parents=True, exist_ok=True)
    fake_svs.write_bytes(b"svs")

    # Point app to that uploads dir
    monkeypatch.setattr("app.UPLOADS", str(fake_svs.parent), raising=False)

    res = client.post("/api/tiles", data={
        "filename": "fake.svs",
        "patches": "6",
        "level": "0",
        "format": "png",
        "name": "demo"
    })
    assert res.status_code == 200
    j = res.get_json()
    assert j["ok"] is True
    assert j["actual"] >= 1
    assert j["tile_size"] >= 32

# ---------- /api/render ----------
def test_render_404(client):
    res = client.get("/api/render?file=missing.png")
    assert res.status_code == 404

def test_render_jpg_and_scale(client, png_bytes):
    # place a PNG under PATCHES and render as jpg scaled down
    patches_dir = os.path.abspath(os.path.join(client.application.root_path, "..", "patches"))
    # patched in fixture, better derive from app module directly
    import app as app_module
    with open(os.path.join(app_module.PATCHES, "a.png"), "wb") as f:
        f.write(png_bytes)

    res = client.get("/api/render?file=a.png&fmt=jpg&scale=0.5")
    assert res.status_code == 200
    assert res.mimetype == "image/jpeg"

# ---------- /api/list_patches ----------
def test_list_patches_and_tiff_display_link(client, png_bytes):
    import app as app_module
    # a PNG and a TIFF
    with open(os.path.join(app_module.PATCHES, "p.png"), "wb") as f:
        f.write(png_bytes)
    # write a 1-page tiff
    tiff_path = os.path.join(app_module.PATCHES, "t.tiff")
    Image.new("RGB", (8, 8), (1, 2, 3)).save(tiff_path, "TIFF")

    res = client.get("/api/list_patches")
    assert res.status_code == 200
    j = res.get_json()
    names = [it["filename"] for it in j["items"]]
    assert "p.png" in names and "t.tiff" in names
    # TIFF should use /api/render as display_url
    t = next(it for it in j["items"] if it["filename"] == "t.tiff")
    assert t["display_url"].startswith("/api/render?file=t.tiff")

# ---------- /api/rename ----------
def test_rename_happy_path(client, png_bytes, monkeypatch):
    import app as app_module
    with open(os.path.join(app_module.PATCHES, "old.png"), "wb") as f:
        f.write(png_bytes)

    res = client.post("/api/rename", json={"old": "old.png", "new": "new.png", "subdir": ""})
    assert res.status_code == 200
    j = res.get_json()
    assert j["ok"] is True
    assert j["filename"] == "new.png"

# ---------- /api/remove ----------
def test_remove_404(client):
    res = client.post("/api/remove", json={"filename": "ghost.png"})
    assert res.status_code == 404

def test_remove_ok(client, png_bytes):
    import app as app_module
    path = os.path.join(app_module.PATCHES, "del.png")
    with open(path, "wb") as f:
        f.write(png_bytes)
    res = client.post("/api/remove", json={"filename": "del.png"})
    assert res.status_code == 200
    assert res.get_json()["ok"] is True
    assert not os.path.exists(path)
