# tests/test_upload.py
import io
import os
import re
import shutil
import importlib
import tempfile
import pytest
from werkzeug.datastructures import FileMultiDict

@pytest.fixture()
def app_and_tmp(tmp_path):
    """
    Import the Flask app, but point PATCHES at a tmp dir.
    """
    # Import your app module fresh each time (so globals are re-bound)
    app_mod = importlib.import_module("app")
    # redirect PATCHES to a temp folder
    tmp_dir = tmp_path / "patches"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    app_mod.PATCHES = str(tmp_dir)
    # also make sure uploads exists (your module expects it)
    os.makedirs(app_mod.UPLOADS, exist_ok=True)
    yield app_mod.app, tmp_dir
    # no cleanup needed; pytest tmp_path handles it

@pytest.fixture()
def client(app_and_tmp):
    app, _ = app_and_tmp
    app.config.update(TESTING=True)
    return app.test_client()

def _post_files(client, items):
    """
    items: list of tuples (filename, bytes, mimetype)
    """
    fmd = FileMultiDict()
    for fname, content, mime in items:
        fmd.add_file("files", io.BytesIO(content), filename=fname, content_type=mime)
    return client.post("/api/upload", data=fmd, content_type="multipart/form-data")

def test_single_png_ok(client, app_and_tmp, record_actuals):
    app, patch_dir = app_and_tmp
    resp = _post_files(client, [("one.png", b"abc", "image/png")])
    assert resp.status_code == 200
    js = resp.get_json()
    assert js["ok"] is True
    assert len(js["items"]) == 1
    saved_name = js["items"][0]["filename"]
    record_actuals(1, "Upload single PNG", resp, {"saved_name": saved_name})
    assert saved_name.endswith(".png")
    assert os.path.exists(os.path.join(patch_dir, saved_name))

def test_multiple_allowed_files(client, app_and_tmp, record_actuals):
    app, patch_dir = app_and_tmp
    resp = _post_files(client, [
        ("a.jpg", b"jpg", "image/jpeg"),
        ("b.tiff", b"tiff", "image/tiff"),
    ])
    assert resp.status_code == 200
    js = resp.get_json()
    record_actuals(2, "Upload JPG+TIFF", resp, {"files": [it["filename"] for it in resp.get_json()["items"]]})
    assert len(js["items"]) == 2
    for it in js["items"]:
        assert os.path.exists(os.path.join(patch_dir, it["filename"]))
        assert it["url"].startswith("/patches/")

def test_weird_name_sanitized_and_timestamped(client, app_and_tmp, record_actuals):
    app, patch_dir = app_and_tmp
    resp = _post_files(client, [("weird name (1).PNG", b"xyz", "image/png")])
    assert resp.status_code == 200
    fn = resp.get_json()["items"][0]["filename"]
    # secure_filename should turn spaces & parens into underscores etc.
    assert fn.lower().endswith(".png")
    stem = os.path.splitext(fn)[0]
    # expect a timestamp suffix like -YYYYmmdd-HHMMSS-ffffff
    assert re.search(r"-\d{8}-\d{6}-\d{6}$", stem) is not None
    assert os.path.exists(os.path.join(patch_dir, fn))
    record_actuals(3, "Weird name sanitized", resp)

def test_uppercase_extension_allowed(client, record_actuals):
    resp = _post_files(client, [("X.JPG", b"d", "image/jpeg")])
    assert resp.status_code == 200
    js = resp.get_json()
    assert js["ok"] is True
    assert js["items"][0]["filename"].endswith(".jpg")  # lower-cased
    record_actuals(4, "Uppercase JPG accepted", resp)

def test_empty_entry_is_ignored(client, record_actuals):
    # one valid file + one empty filename
    data = [
        ("valid.png", b"ok", "image/png"),
    ]
    # Manually craft the multipart with one empty filename part
    from werkzeug.datastructures import FileMultiDict
    fmd = FileMultiDict()
    fmd.add_file("files", io.BytesIO(b"ok"), filename="valid.png", content_type="image/png")
    fmd.add_file("files", io.BytesIO(b""), filename="", content_type="application/octet-stream")
    resp = client.post("/api/upload", data=fmd, content_type="multipart/form-data")
    assert resp.status_code == 200
    js = resp.get_json()
    assert len(js["items"]) == 1
    record_actuals(5, "Empty file ignored", resp)

def test_duplicate_names_get_unique_timestamps(client, app_and_tmp, record_actuals):
    # Upload same name twice
    r1 = _post_files(client, [("dup.png", b"a", "image/png")])
    r2 = _post_files(client, [("dup.png", b"b", "image/png")])
    f1 = r1.get_json()["items"][0]["filename"]
    f2 = r2.get_json()["items"][0]["filename"]
    assert f1 != f2  # timestamped -> unique
    record_actuals(6, "Duplicate names unique", r2, {
        "first": r1.get_json()["items"][0]["filename"],
        "second": r2.get_json()["items"][0]["filename"]
    })

def test_disallowed_extension_returns_400(client, app_and_tmp, record_actuals):
    app, patch_dir = app_and_tmp
    resp = _post_files(client, [("nope.gif", b"gif", "image/gif")])
    assert resp.status_code == 400
    js = resp.get_json()
    assert "Not allowed" in js["error"]
    # ensure nothing saved
    assert len(os.listdir(patch_dir)) == 0
    record_actuals(7, "Disallowed extension", resp)

def test_no_files_returns_empty_items(client, record_actuals):
    # Current code returns ok=True with empty items
    resp = client.post("/api/upload", data={}, content_type="multipart/form-data")
    assert resp.status_code == 200
    js = resp.get_json()
    assert js["ok"] is True
    assert js["items"] == []
    record_actuals(8, "No files -> empty items", resp)
