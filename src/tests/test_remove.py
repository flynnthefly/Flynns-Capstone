# tests/test_remove.py
import os
import importlib
import pytest
from PIL import Image

def _save_png(path, size=(8, 6), color=(100, 200, 100)):
    from PIL import Image
    Image.new("RGB", size, color).save(path, "PNG")

class FakeDB:
    """Tiny fake DB that tracks filenames in a set to mimic the images table."""
    def __init__(self):
        self.names = set()
        self.last_sql = None
        self.last_params = None

    def execute(self, sql, params=()):
        self.last_sql = (sql or "").lower()
        self.last_params = params
        # we only care about deletes here
        if "delete from images" in self.last_sql:
            (fname,) = params
            # mirror deletion if present
            if fname in self.names:
                self.names.remove(fname)
        return self

    def commit(self):  # mimic sqlite commit
        pass

@pytest.fixture()
def app_and_tmp(tmp_path, monkeypatch):
    app_mod = importlib.import_module("app")

    patches = tmp_path / "patches"
    uploads = tmp_path / "uploads"
    patches.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    app_mod.PATCHES = str(patches)
    app_mod.UPLOADS = str(uploads)

    # Wire a fake database object with get_db()
    db = FakeDB()
    class S:
        @staticmethod
        def get_db():
            return db
    app_mod.database = S

    app_mod.app.config.update(TESTING=True)
    yield app_mod, patches, db

@pytest.fixture()
def client(app_and_tmp):
    app_mod, _, _ = app_and_tmp
    return app_mod.app.test_client()

def test_remove_ok(client, app_and_tmp, record_actuals):
    app_mod, patches, db = app_and_tmp
    fname = "a.png"
    _save_png(patches / fname)
    db.names.add(fname)

    r = client.post("/api/remove", json={"filename": fname})
    assert r.status_code == 200
    js = r.get_json()
    assert js["ok"] is True
    assert js["removed"] == fname
    assert not (patches / fname).exists()
    assert fname not in db.names  # deleted from DB
    record_actuals(1, "Remove OK", r, {
        "removed": js["removed"],
        "fs_exists_after": (patches / fname).exists(),
        "db_names": sorted(db.names),
    })

def test_remove_missing_filename_400(client, record_actuals):
    r = client.post("/api/remove", json={})
    assert r.status_code == 400
    assert "filename required" in r.get_json()["error"].lower()
    record_actuals(2, "Missing filename → 400", r, {"payload": {}})

def test_remove_not_found_404(client, record_actuals):
    payload = {"filename": "nope.png"}
    r = client.post("/api/remove", json={"filename": "nope.png"})
    assert r.status_code == 404
    assert "file not found" in r.get_json()["error"].lower()
    record_actuals(3, "Remove not found → 404", r, {"payload": payload})

def test_remove_oserror_returns_500_and_db_already_deleted(client, app_and_tmp, monkeypatch, record_actuals):
    """Documents current behavior: DB row is deleted before file removal.
    If os.remove fails, response is 500 and DB row is gone.
    """
    app_mod, patches, db = app_and_tmp
    fname = "b.png"
    target = patches / fname
    _save_png(target)
    db.names.add(fname)

    def boom(path):
        raise OSError("permission denied")
    monkeypatch.setattr(os, "remove", boom)

    r = client.post("/api/remove", json={"filename": fname})
    assert r.status_code == 500
    # File still exists because remove failed
    assert target.exists()
    # DB entry has already been removed by the route
    assert fname not in db.names

    record_actuals(4, "OS error during remove → 500 (DB already deleted)", r, {
        "filename": fname,
        "fs_exists_after": target.exists(),
        "db_names": sorted(db.names),
    })
