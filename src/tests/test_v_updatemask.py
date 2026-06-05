import pytest
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def execute(self, q, a): pass
        def commit(self): pass
    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_update_masks_success(client):
    payload = {
        "updates": [
            {"id": 1, "location_data": [{"x": 1, "y": 2}, {"x": 3, "y": 4}]}
        ]
    }
    r = client.post("/update-masks", json=payload)
    assert r.status_code == 200
    assert r.get_json()["ok"]

def test_update_masks_invalid_type(client):
    r = client.post("/update-masks", json={"updates": "notalist"})
    assert r.status_code == 400
