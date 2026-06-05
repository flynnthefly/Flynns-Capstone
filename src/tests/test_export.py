import io
import os
import importlib
import pytest
from PIL import Image

def _save_png(path, size=(20, 12), color=(30, 200, 30)):
    Image.new("RGB", size, color).save(path, "PNG")

class _CursorLike:
    """Tiny cursor/statement shim returning canned rows based on SQL."""
    def __init__(self, image_id=None, masks=None):
        self._image_id = image_id
        self._masks = masks or []

    # emulate sqlite3.Row access via dict-like rows
    def fetchone(self):
        if self._which == "image":
            return {"id": self._image_id} if self._image_id is not None else None
        return None

    def fetchall(self):
        if self._which == "masks":
            return self._masks
        return []

    def execute(self, sql, params=()):
        sql_low = (sql or "").lower()
        cur = _CursorLike(image_id=self._image_id, masks=self._masks)
        if "from images" in sql_low:
            cur._which = "image"
        elif "from masks" in sql_low:
            cur._which = "masks"
        else:
            cur._which = "other"
        return cur

class _FakeDB:
    def __init__(self, image_id=None, masks=None):
        self._image_id = image_id
        self._masks = masks or []
        # support .execute(...) directly on the DB handle (sqlite3 connection semantics)
        self._cursor = _CursorLike(image_id=image_id, masks=masks)

    def execute(self, sql, params=()):
        return self._cursor.execute(sql, params)

    def close(self): pass

@pytest.fixture()
def app_and_tmp(tmp_path, monkeypatch):
    app_mod = importlib.import_module("app")

    # Redirect only PATCHES (export reads from PATCHES)
    patches = tmp_path / "patches"
    uploads = tmp_path / "uploads"
    patches.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    app_mod.PATCHES = str(patches)
    app_mod.UPLOADS = str(uploads)

    app_mod.app.config.update(TESTING=True)
    yield app_mod, patches

@pytest.fixture()
def client(app_and_tmp):
    app_mod, _ = app_and_tmp
    return app_mod.app.test_client()

def _post_json(client, payload):
    return client.post("/api/export", json=payload)

def _disposition_filename(resp):
    cd = resp.headers.get("Content-Disposition", "")  # attachment; filename="x"; filename*=UTF-8''x
    # Get the last token after '=' and strip quotes
    if "filename*" in cd:
        name = cd.split("filename*=")[-1].split("''")[-1]
    elif "filename=" in cd:
        name = cd.split("filename=")[-1].strip().strip('"')
    else:
        name = ""
    return name

def test_export_keep_png_ok(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, patches = app_and_tmp
    src = patches / "a.png"
    _save_png(src)

    # DB returns no image row -> overlay becomes no-op
    monkeypatch.setattr(app_mod, "database", importlib.import_module("types"), raising=False)
    # inject a minimal object with get_db()
    class _S: pass
    _S.get_db = staticmethod(lambda: _FakeDB(image_id=None, masks=[]))
    app_mod.database = _S

    r = _post_json(client, {"files": ["a.png"], "format": "keep"})
    assert r.status_code == 200
    assert r.mimetype == "image/png"
    name = _disposition_filename(r)
    assert name.endswith("_with_masks.png")
    record_actuals(1, "Export keep → PNG", r, {"disposition": _disposition_filename(r)})

def test_export_jpg_ok(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, patches = app_and_tmp
    src = patches / "a.png"
    _save_png(src)

    # DB returns one image id and one mask polygon
    masks = [{
        "location_data": '[ [0,0], [10,0], [10,10], [0,10] ]',
        "name": "cellA",
        "cell_colour": "#FF000080",  # semi-transparent red
    }]
    class _S: pass
    _S.get_db = staticmethod(lambda: _FakeDB(image_id=42, masks=masks))
    app_mod.database = _S

    r = _post_json(client, {"files": ["a.png"], "format": "jpg"})
    assert r.status_code == 200
    assert r.mimetype == "image/jpeg"
    name = _disposition_filename(r)
    assert name.endswith("_with_masks.jpg")
    record_actuals(2, "Export → JPG (with masks)", r, {"disposition": _disposition_filename(r)})

def test_export_tiff_ok(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, patches = app_and_tmp
    src = patches / "a.png"
    _save_png(src)

    class _S: pass
    _S.get_db = staticmethod(lambda: _FakeDB(image_id=None, masks=[]))
    app_mod.database = _S

    r = _post_json(client, {"files": ["a.png"], "format": "tiff"})
    assert r.status_code == 200
    assert r.mimetype == "image/tiff"
    assert _disposition_filename(r).endswith("_with_masks.tiff")
    record_actuals(3, "Export → TIFF", r, {"disposition": _disposition_filename(r)})

def test_export_requires_files_400(client, record_actuals):
    r = _post_json(client, {})
    assert r.status_code == 400
    assert "no files selected" in r.get_json()["error"].lower()
    record_actuals(4, "Export: missing files → 400", r)

def test_export_multiple_files_400(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    _save_png(patches / "a.png")
    _save_png(patches / "b.png")
    r = _post_json(client, {"files": ["a.png", "b.png"]})
    assert r.status_code == 400
    assert "multiple file export" in r.get_json()["error"].lower()
    record_actuals(5, "Export: multiple files → 400", r)

def test_export_not_found_404(client, record_actuals):
    r = _post_json(client, {"files": ["missing.png"], "format": "keep"})
    assert r.status_code == 404
    assert "not found" in r.get_json()["error"].lower()
    record_actuals(6, "Export: missing source → 404", r)

def test_export_invalid_format_400(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    _save_png(patches / "a.png")
    r = _post_json(client, {"files": ["a.png"], "format": "bmp"})
    assert r.status_code == 400
    assert "invalid format" in r.get_json()["error"].lower()
    record_actuals(7, "Export: invalid format → 400", r)