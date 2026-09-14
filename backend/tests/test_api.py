from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repository import InMemoryJobRepository, get_job_repository


@pytest.fixture
def client() -> TestClient:
    repository = InMemoryJobRepository()
    app.dependency_overrides[get_job_repository] = lambda: repository
    test_client = TestClient(app, backend_options={"use_uvloop": True})

    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()


def create_job(client: TestClient) -> dict:
    payload = {
        "title": "Backend Engineer",
        "company": "Example Inc.",
        "skills": ["Python", "FastAPI"],
    }
    response = client.post("/jobs", json=payload)

    assert response.status_code == 201
    body = response.json()
    assert body["id"]
    assert datetime.fromisoformat(body["received_at"])
    assert body["payload"] == payload
    return body


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_job(client: TestClient) -> None:
    create_job(client)


def test_list_jobs_includes_created_job(client: TestClient) -> None:
    created = create_job(client)

    response = client.get("/jobs")

    assert response.status_code == 200
    assert created in response.json()


def test_get_job(client: TestClient) -> None:
    created = create_job(client)

    response = client.get(f"/jobs/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_job_returns_404(client: TestClient) -> None:
    response = client.get("/jobs/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "job not found"}
