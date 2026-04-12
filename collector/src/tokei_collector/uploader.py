"""Batch POST events to the worker /v1/ingest endpoint."""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx

from .models import Event

BATCH_SIZE = 50
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.0


class HttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


@dataclass(frozen=True, slots=True)
class UploadResult:
    accepted: int
    deduped: int


class Uploader:
    def __init__(
        self,
        worker_url: str,
        bearer_token: str,
        device_id: str,
        retry_sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.worker_url = worker_url.rstrip("/")
        self.bearer_token = bearer_token
        self.device_id = device_id
        self.retry_sleep = retry_sleep

    def upload(self, events: Sequence[Event]) -> UploadResult:
        total_accepted = 0
        total_deduped = 0
        total_batches = (len(events) + BATCH_SIZE - 1) // BATCH_SIZE
        for batch_idx, i in enumerate(range(0, len(events), BATCH_SIZE)):
            batch = list(events[i : i + BATCH_SIZE])
            if batch_idx > 0:
                self.retry_sleep(1.0)
            result = self._upload_batch(batch)
            total_accepted += result.accepted
            total_deduped += result.deduped
            if total_batches > 5 and (batch_idx + 1) % 10 == 0:
                print(f"  progress: {batch_idx + 1}/{total_batches} batches")
        return UploadResult(accepted=total_accepted, deduped=total_deduped)

    def _upload_batch(self, batch: list[Event]) -> UploadResult:
        payload = {
            "device_id": self.device_id,
            "events": [e.to_dict() for e in batch],
        }
        headers = {"Authorization": f"Bearer {self.bearer_token}"}

        last_err: HttpError | None = None
        for attempt in range(MAX_RETRIES):
            try:
                with httpx.Client(timeout=30.0) as client:
                    response = client.post(
                        f"{self.worker_url}/v1/ingest",
                        json=payload,
                        headers=headers,
                    )
            except httpx.HTTPError as e:
                last_err = HttpError(0, str(e))
                self.retry_sleep(RETRY_BACKOFF_BASE * (2**attempt))
                continue

            if 200 <= response.status_code < 300:
                data = response.json()
                return UploadResult(accepted=int(data["accepted"]), deduped=int(data["deduped"]))

            if 400 <= response.status_code < 500:
                raise HttpError(response.status_code, response.text)

            last_err = HttpError(response.status_code, response.text)
            self.retry_sleep(RETRY_BACKOFF_BASE * (2**attempt))

        assert last_err is not None
        raise last_err
