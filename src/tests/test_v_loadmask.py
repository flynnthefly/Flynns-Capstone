import pytest
import json
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def execute(self, query, args=()):
            if "SELECT id FROM images" in query:
                return type("R", (), {"fetchone": lambda: {"id": 1}})
            if "SELECT id, location_data" in query:
                return type("R", (), {"fetchall": lambda: [
                    {"id": 5, "location_data": json.dumps([(1, 2), (3, 4)])}
                ]})
    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_load_masks_success(client):
    response = client.get("/load-masks?id=mask_1&file=test.png")
    assert response.status_code == 200
    data = response.get_json()
    assert data[0]["id"] == 5

def test_load_masks_invalid_input(client):
    response = client.get("/load-masks?id=&file=")
    assert response.get_json() == []
