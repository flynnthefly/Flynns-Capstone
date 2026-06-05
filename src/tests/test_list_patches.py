# tests/test_list_patches.py
import os
import io
import time
import importlib
import pytest
from PIL import Image

def _write_png(path, size=(8, 6), color=(20, 200, 20)):
    Image.new("RGB", size, color).save(path, "PNG")

def _write_tiff(path, size=(8, 6), color=(200, 20, 20)):
    Image.new("RGB", size, color).save(path, "TIFF")

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
    yield app_mod, patches

@pytest.fixture()
def client(app_and_tmp):
    app_mod, _ = app_and_tmp
    return app_mod.app.test_client()

def test_list_empty_dir_ok(client, app_and_tmp, record_actuals):
    r = client.get("/api/list_patches")
    assert r.status_code == 200
    js = r.get_json()
    assert js["ok"] is True
    assert js["base_url"].endswith("/patches/")  # trailing slash consistent
    assert js["items"] == []
    record_actuals(1, "Empty directory returns nothing", r, {"count": len(js["items"])})

def test_list_filters_extensions_and_subdirs(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    # top-level files
    _write_png(patches / "a.png")
    (patches / "note.txt").write_text("skip me")

    # nested
    d = patches / "sub one"
    d.mkdir()
    _write_png(d / "b.png")
    _write_tiff(d / "c.tif")

    r = client.get("/api/list_patches")
    assert r.status_code == 200
    items = r.get_json()["items"]
    names = { (it["subdir"], it["filename"]) for it in items }
    assert ("", "a.png") in names
    assert ("sub one", "b.png") in names
    assert ("sub one", "c.tif") in names
    # txt filtered out
    assert all(not it["filename"].endswith(".txt") for it in items)
    record_actuals(2, "Filters by image extensions & includes subdirs", r,
                   {"names": sorted(list(names))})

def test_display_url_for_tiff_and_png_urlencoded(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    # create spaced subdir and files
    d = patches / "my folder"
    d.mkdir()
    _write_tiff(d / "scan 01.tiff")
    _write_png(d / "scan 02.png")

    r = client.get("/api/list_patches")
    assert r.status_code == 200
    items = r.get_json()["items"]

    tiff_item = next(it for it in items if it["filename"] == "scan 01.tiff")
    png_item  = next(it for it in items if it["filename"] == "scan 02.png")

    # tiff should render via /api/render with URL-encoded file=
    assert tiff_item["display_url"].startswith("/api/render?file=")
    assert "%20" in tiff_item["display_url"]  # encoded space
    # png should point directly to static /patches path
    assert png_item["display_url"].startswith("/patches/")
    record_actuals(3, "TIFF uses render (URL-encoded), PNG direct", r,
                   {"tiff_display_url": tiff_item["display_url"],
                    "png_display_url": png_item["display_url"]})

def test_sort_by_nat_ascending(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    for fname in ["img10.png", "img2.png", "img1.png"]:
        _write_png(patches / fname)
    r = client.get("/api/list_patches", query_string={"sort": "nat", "order": "asc"})
    names = [it["filename"] for it in r.get_json()["items"]]
    assert names == ["img1.png", "img2.png", "img10.png"]
    record_actuals(4, "Natural sort ascending", r, {"names": names})

def test_sort_by_mtime_asc_desc(client, app_and_tmp, record_actuals):
    app_mod, patches = app_and_tmp
    p1 = patches / "a.png"; _write_png(p1)
    p2 = patches / "b.png"; _write_png(p2)
    p3 = patches / "c.png"; _write_png(p3)

    # set mtimes explicitly
    now = int(time.time())
    os.utime(p1, (now-30, now-30))
    os.utime(p2, (now-20, now-20))
    os.utime(p3, (now-10, now-10))

    r1 = client.get("/api/list_patches", query_string={"sort": "mtime", "order": "asc"})
    asc = [it["filename"] for it in r1.get_json()["items"]]
    assert asc == ["a.png", "b.png", "c.png"]

    r2 = client.get("/api/list_patches", query_string={"sort": "mtime", "order": "desc"})
    desc = [it["filename"] for it in r2.get_json()["items"]]
    assert desc == ["c.png", "b.png", "a.png"]
    record_actuals(5, "Sort by mtime asc/desc", r1, {"asc": asc, "desc": desc})

def test_dir_traversal_is_blocked_returns_empty(client, app_and_tmp, record_actuals):
    # list outside with .. should resolve to base and return empty (safe behavior)
    r = client.get("/api/list_patches", query_string={"dir": "../uploads"})
    assert r.status_code == 200
    assert r.get_json()["items"] == []
    record_actuals(6, "Traversal blocked (../uploads) returns empty", r,
                   {"count": len(r.get_json()["items"])})
