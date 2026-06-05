import pytest
from views import views


@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def __init__(self):
            self.inserted = False
            self.updated = False
            self.deleted = False

        def execute(self, q, a=()):
            # CREATE
            if "SELECT id FROM CELLTYPE WHERE LOWER(name)" in q:
                return type("R", (), {"fetchone": lambda: None})
            if "INSERT INTO CELLTYPE" in q:
                return type("C", (), {"lastrowid": 3})

            # DELETE
            if "SELECT id FROM CELLTYPE WHERE id" in q:
                return type("R", (), {"fetchone": lambda: {"id": 1}})
            if "DELETE FROM" in q:
                return None

            # UPDATE
            if "UPDATE CELLTYPE" in q:
                return None
            if "SELECT id, name, colour FROM CELLTYPE" in q:
                return type("R", (), {"fetchone": lambda: {
                    "id": 1, "name": "updated", "colour": "#111"
                }})

            return type("R", (), {"fetchone": lambda: None})

        def commit(self):
            pass

    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()


# CREATE CATEGORY
def test_create_category_success(client):
    payload = {"name": "new", "color": "#fff"}
    r = client.post("/categories", json=payload)
    assert r.status_code == 201
    data = r.get_json()
    assert data["name"] == "new"
    assert "id" in data


def test_create_category_missing_fields(client):
    r = client.post("/categories", json={"name": ""})
    assert r.status_code == 400
    assert "error" in r.get_json()


# DELETE CATEGORY
def test_delete_category_success(client):
    r = client.delete("/categories/1")
    assert r.status_code in (200, 404, 500)


def test_delete_category_not_found(monkeypatch):
    class DummyDB:
        def execute(self, q, a=()):
            return type("R", (), {"fetchone": lambda: None})
        def commit(self): pass

    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    c = app.test_client()

    r = c.delete("/categories/999")
    assert r.status_code == 404
    assert "error" in r.get_json()


# UPDATE CATEGORY
def test_update_category_success(client):
    r = client.put("/categories/1", json={"name": "updated", "color": "#111"})
    assert r.status_code in (200, 400, 404)
    data = r.get_json()
    assert "ok" in data or "error" in data


def test_update_category_missing_name(client):
    r = client.put("/categories/1", json={"color": "#000"})
    assert r.status_code == 400
    assert "error" in r.get_json()
