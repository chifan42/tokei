import pytest
from pytest_httpx import HTTPXMock

from tokei_collector.models import Event
from tokei_collector.uploader import (
    BATCH_SIZE,
    HttpError,
    Uploader,
    UploadResult,
)


def sample_event(i: int = 0) -> Event:
    return Event(
        tool="claude_code",
        event_uuid=f"uuid-{i}",
        ts=1744370000 + i,
        model="claude-sonnet-4-5",
        input_tokens=100,
        output_tokens=50,
    )


def test_uploader_posts_events(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 2, "deduped": 0},
    )
    u = Uploader("https://worker.example", "test-token", "dev-1")
    result = u.upload([sample_event(0), sample_event(1)])
    assert result == UploadResult(accepted=2, deduped=0)


def test_uploader_splits_into_batches(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": BATCH_SIZE, "deduped": 0},
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 1, "deduped": 0},
    )

    events = [sample_event(i) for i in range(BATCH_SIZE + 1)]
    u = Uploader("https://worker.example", "test-token", "dev-1")
    result = u.upload(events)
    assert result.accepted == BATCH_SIZE + 1


def test_uploader_retries_on_5xx(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=500,
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=500,
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 1, "deduped": 0},
    )

    u = Uploader("https://worker.example", "test-token", "dev-1", retry_sleep=lambda _: None)
    result = u.upload([sample_event(0)])
    assert result.accepted == 1


def test_uploader_does_not_retry_on_4xx(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=401,
        text="UNAUTHORIZED",
    )
    u = Uploader("https://worker.example", "test-token", "dev-1", retry_sleep=lambda _: None)
    with pytest.raises(HttpError, match="401"):
        u.upload([sample_event(0)])


def test_uploader_sets_bearer_header(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        match_headers={"Authorization": "Bearer my-token"},
        json={"accepted": 1, "deduped": 0},
    )
    u = Uploader("https://worker.example", "my-token", "dev-1")
    u.upload([sample_event(0)])
