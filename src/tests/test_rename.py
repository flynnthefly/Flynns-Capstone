# tests/test_rename.py
import os
import importlib
import pytest
from PIL import Image

def _save_png(path, size=(10, 8), color=(40, 200, 40)):
    Image.new("RGB", size, color).save(path, "PNG")

@pytest.fixture()
def app_and_tmp(tmp_path, monkeypatch):
    app_mod = importlib.import_module("app")

    patches = tmp_path / "patches"
    uploads = tmp_path / "uploads"
    patches.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    app_mod.PATCHES = str(patches)
    app_mod.UPLOADS = str(uploads)
    app_mod.app.config.update(TESTING=True)

    # minimal fake DB
    class FakeDB:
        def __init__(self):
            # store filenames as keys to simulate images table
            self.names = set()
        def execute(self, sql, params=()):
            sql_low = (sql or "").lower()
            if "update images set filename" in sql_low:
                new_name, old_name = params
                # reflect rename in our set if present; allow missing (no row) too
                if old_name in self.names:
                    self.names.remove(old_name)
                self.names.add(new_name)
                return self
            return self
        def commit(self): pass

    db = FakeDB()
    # expose get_db()
    class S:
        @staticmethod
        def get_db():
            return db
    app_mod.database = S

    yield app_mod, patches, db

@pytest.fixture()
def client(app_and_tmp):
    app_mod, _, _ = app_and_tmp
    return app_mod.app.test_client()

def test_rename_basic_ok(client, app_and_tmp, record_actuals):
    app_mod, patches, db = app_and_tmp
    src = patches / "a.png"
    _save_png(src)
    db.names.add("a.png")  # simulate row exists

    r = client.post("/api/rename", json={"old": "a.png", "new": "b.png"})
    assert r.status_code == 200
    js = r.get_json()
    assert js["ok"] is True
    assert js["filename"] == "b.png"
    assert os.path.exists(patches / "b.png")
    assert not os.path.exists(patches / "a.png")
    assert "b.png" in db.names
    record_actuals(1, "Basic rename OK", r, {
        "old": "a.png",
        "new": "b.png",
        "fs_after": sorted(os.listdir(patches)),
        "db_names": sorted(db.names),
    })

def test_rename_subdir_is_rejected_400(client, app_and_tmp, record_actuals):
    # subdirectories are not supported
    payload = {"old": "x.png", "new": "y.png", "subdir": "s1"}
    r = client.post("/api/rename", json={"old": "x.png", "new": "y.png", "subdir": "s1"})
    assert r.status_code == 400
    assert "subdirectories" in r.get_json()["error"].lower()
    record_actuals(2, "Subdir rename rejected", r, {"payload": payload})

def test_rename_missing_fields_400(client, record_actuals):
    r = client.post("/api/rename", json={"old": "a.png"})
    assert r.status_code == 400
    r2 = client.post("/api/rename", json={"new": "b.png"})
    assert r2.status_code == 400
    record_actuals("3a", "Missing field (new) → 400", r2, {"payload": {"old": "a.png"}})

def test_rename_reject_separators(client, app_and_tmp, record_actuals):
    app_mod, patches, db = app_and_tmp
    (patches / "a.png").write_bytes(b"x"); db.names.add("a.png")
    payload = {"old": "a.png", "new": "../b.png"}
    r = client.post("/api/rename", json={"old": "a.png", "new": "../b.png"})
    assert r.status_code == 400
    record_actuals(4, "Reject path separators in new name", r, {"payload": payload})

def test_rename_not_found_404(client, record_actuals):
    payload = {"old": "nope.png", "new": "b.png"}
    r = client.post("/api/rename", json={"old": "nope.png", "new": "b.png"})
    assert r.status_code == 404
    record_actuals(5, "Old file not found → 404", r, {"payload": payload})

def test_rename_duplicate_409(client, app_and_tmp, record_actuals):
    app_mod, patches, db = app_and_tmp
    (patches / "a.png").write_bytes(b"x"); db.names.add("a.png")
    (patches / "b.png").write_bytes(b"x"); db.names.add("b.png")

    payload = {"old": "a.png", "new": "b.png"}
    r = client.post("/api/rename", json={"old": "a.png", "new": "b.png"})
    assert r.status_code == 409
    record_actuals(6, "Duplicate target → 409", r, {
        "payload": payload,
        "fs_after": sorted(os.listdir(patches)),
        "db_names": sorted(db.names),
    })

def test_rename_db_failure_500(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, patches, db = app_and_tmp
    (patches / "a.png").write_bytes(b"x"); db.names.add("a.png")

    class BoomDB:
        @staticmethod
        def get_db():
            class DB:
                def execute(*a, **k): raise RuntimeError("db down")
                def commit(*a, **k): pass
            return DB()
    app_mod.database = BoomDB

    payload = {"old": "a.png", "new": "b.png"}
    r = client.post("/api/rename", json={"old": "a.png", "new": "b.png"})
    assert r.status_code == 500
    assert os.path.exists(patches / "a.png")  # file unchanged
    record_actuals(7, "DB failure → 500 (FS unchanged)", r, {
        "payload": payload,
        "fs_after": sorted(os.listdir(patches)),
    })

def test_rename_fs_failure_rolls_back_db(client, app_and_tmp, monkeypatch, record_actuals):
    app_mod, patches, db = app_and_tmp
    (patches / "a.png").write_bytes(b"x"); db.names.add("a.png")

    real_rename = os.rename
    def boom(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "rename", boom)

    payload = {"old": "a.png", "new": "b.png"}
    r = client.post("/api/rename", json={"old": "a.png", "new": "b.png"})
    assert r.status_code == 500
    # DB rolled back to old name
    assert "a.png" in db.names
    assert "b.png" not in db.names
    assert os.path.exists(patches / "a.png")
    record_actuals(8, "FS failure → rollback DB", r, {
        "payload": payload,
        "db_names": sorted(db.names),
        "fs_after": sorted(os.listdir(patches)),
    })

def test_rename_tiff_display_url_uses_render(client, app_and_tmp, record_actuals):
    app_mod, patches, db = app_and_tmp
    (patches / "c.tiff").write_bytes(b"t"); db.names.add("c.tiff")
    payload = {"old": "c.tiff", "new": "d.tiff"}
    r = client.post("/api/rename", json={"old": "c.tiff", "new": "d.tiff"})
    assert r.status_code == 200
    js = r.get_json()
    assert js["display_url"].startswith("/api/render?file=")
    assert js["display_url"].endswith("&fmt=png")
    record_actuals(9, "TIFF rename returns render display_url", r, {
        "payload": payload,
        "display_url": js.get("display_url"),
    })
