import pytest
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def execute(self, query, ids):
            return type("C", (), {"rowcount": len(ids)})
        def commit(self): pass

    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_delete_masks_multiple(client):
    response = client.post("/delete-masks", json={"ids": [1, 2, 3]})
    data = response.get_json()
    assert data["ok"] and data["deleted"] == 3

def test_delete_masks_invalid_ids(client):
    response = client.post("/delete-masks", json={"ids": "abc"})
    assert response.status_code == 400
