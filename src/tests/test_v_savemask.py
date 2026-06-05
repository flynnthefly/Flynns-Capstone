import json
import pytest
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def __init__(self):
            self.committed = False
        def execute(self, query, args=()):
            if "SELECT id FROM images" in query:
                return type("R", (), {"fetchone": lambda: {"id": 1}})
            if "INSERT INTO images" in query:
                return type("C", (), {"lastrowid": 2})
            return None
        def commit(self):
            self.committed = True

    monkeypatch.setattr("database.get_db", lambda: DummyDB())

    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_save_mask_success(client):
    payload = {
        "file": "example.png",
        "maskId": 1,
        "polygon": [{"x": 10, "y": 20}, {"x": 30, "y": 40}]
    }
    response = client.post("/save-mask", json=payload)
    assert response.status_code == 201
    assert response.get_json()["ok"]

def test_save_mask_invalid_payload(client):
    response = client.post("/save-mask", json={"file": "", "maskId": "x"})
    assert response.status_code == 400
