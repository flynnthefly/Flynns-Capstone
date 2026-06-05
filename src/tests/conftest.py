import io, os, types
from PIL import Image
import pytest
import json

# Import the app module under test
import app as app_module

class _ExecResult:
    def __init__(self, rows=None): self._rows = rows or []
    def fetchone(self): return self._rows[0] if self._rows else None
    def fetchall(self): return self._rows

class FakeDB:
    def __init__(self, rows=None): self.rows = rows or []
    def execute(self, *_args, **_kwargs): return _ExecResult(self.rows)
    def commit(self): pass

@pytest.fixture
def client(tmp_path, monkeypatch):
    """
    Flask test client with isolated temp PATCHES/UPLOADS and a fake DB.
    """
    # Isolate file system
    uploads = tmp_path / "uploads"
    patches = tmp_path / "patches"
    uploads.mkdir()
    patches.mkdir()

    monkeypatch.setattr(app_module, "UPLOADS", str(uploads))
    monkeypatch.setattr(app_module, "PATCHES", str(patches))

    # Fake DB object for endpoints that call database.get_db()
    def _fake_get_db():
        return FakeDB()
    monkeypatch.setattr(app_module.database, "get_db", _fake_get_db, raising=True)

    # Create a fresh Flask client
    app_module.app.config.update(TESTING=True)
    with app_module.app.test_client() as c:
        yield c

@pytest.fixture
def png_bytes():
    """Small valid PNG image bytes."""
    bio = io.BytesIO()
    Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(bio, "PNG")
    bio.seek(0)
    return bio.getvalue()

@pytest.fixture
def jpg_bytes():
    bio = io.BytesIO()
    Image.new("RGB", (16, 16), (0, 255, 0)).save(bio, "JPEG", quality=80)
    bio.seek(0)
    return bio.getvalue()

@pytest.fixture
def mock_openslide(monkeypatch):
    """
    Patch openslide.OpenSlide so tests don’t need real SVS files.
    """
    class FakeSlide:
        level_dimensions = [(400, 300), (200, 150)]
        level_downsamples = [1.0, 2.0]
        def __init__(self, path): self.path = path
        def get_thumbnail(self, size):
            from PIL import Image
            return Image.new("RGBA", size, (0, 0, 255, 255))
        def read_region(self, loc, level, size):
            from PIL import Image
            return Image.new("RGBA", size, (255, 255, 255, 255))
    monkeypatch.setattr(app_module.openslide, "OpenSlide", FakeSlide, raising=True)



@pytest.fixture
def record_actuals():
    rows = []
    def rec(id, desc, resp=None, extra=None):
        row = {"ID": id, "Description": desc}
        if resp is not None:
            row["Status"] = resp.status_code
            try:
                row["JSON"] = resp.get_json()
            except Exception:
                row["JSON"] = None
        if extra is not None:
            row["Extra"] = extra
        rows.append(row)
    yield rec
    # print a compact summary at the end of the test run
    print("\n\n=== ACTUAL RESULTS (Upload API) ===")
    for r in rows:
        js = json.dumps(r.get("JSON"), ensure_ascii=False)
        extra = json.dumps(r.get("Extra"), ensure_ascii=False)
        print(f"[{r['ID']}] {r['Description']} -> status={r['Status']} json={js} extra={extra}")
