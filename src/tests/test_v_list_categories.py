import pytest
from views import views

@pytest.fixture
def client(monkeypatch):
    class DummyDB:
        def execute(self, q):
            return type("R", (), {"fetchall": lambda: [
                {"id": 1, "name": "A", "colour": "#fff"},
                {"id": 2, "name": "B", "colour": "#000"}
            ]})
    monkeypatch.setattr("database.get_db", lambda: DummyDB())
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(views)
    return app.test_client()

def test_list_categories(client):
    r = client.get("/categories")
    assert r.status_code == 200
    data = r.get_json()
    assert len(data) == 2
