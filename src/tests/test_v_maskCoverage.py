import pytest
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def execute(self, q, a=()):
            if "SELECT id FROM images" in q:
                return type("R", (), {"fetchone": lambda: {"id": 1}})
            if "SELECT celltype AS id" in q:
                return type("R", (), {"fetchall": lambda: [
                    {"id": 1, "count": 5},
                    {"id": 2, "count": 3},
                ]})
    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_mask_coverage(client):
    r = client.get("/mask-coverage?file=test.png")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, list)
    assert data[0]["count"] == 5
