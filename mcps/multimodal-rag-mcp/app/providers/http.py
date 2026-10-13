from __future__ import annotations

import random
import time
from typing import Any

import httpx

from ..errors import ErrorCode, RagError


def _map_status(status: int) -> RagError:
    if status in (401, 403):
        return RagError(
            ErrorCode.API_AUTH_FAILED,
            f"API auth failed (HTTP {status})",
            retryable=False,
            suggestion="Check the API key env var and account permissions.",
        )
    if status == 429:
        return RagError(ErrorCode.API_RATE_LIMITED, "API rate limited (HTTP 429)")
    if status == 404:
        return RagError(
            ErrorCode.API_REQUEST_FAILED,
            "API endpoint or model not found (HTTP 404)",
            retryable=False,
            suggestion="Check base_url and model name.",
        )
    if 400 <= status < 500:
        return RagError(
            ErrorCode.API_REQUEST_FAILED,
            f"API rejected request (HTTP {status})",
            retryable=False,
        )
    return RagError(ErrorCode.API_REQUEST_FAILED, f"API server error (HTTP {status})")


class HttpCaller:
    def __init__(self, timeout_seconds: int, max_retries: int, label: str):
        self.timeout = timeout_seconds
        self.max_retries = max_retries
        self.label = label

    def post_json(self, url: str, headers: dict, payload: dict) -> dict[str, Any]:
        return self._call(url, headers, payload, expect_json=True)

    def post_multipart(self, url: str, headers: dict, data: dict, files: dict) -> dict[str, Any]:
        return self._call(url, headers, payload=None, expect_json=True, data=data, files=files)

    def _call(self, url, headers, payload, expect_json=True, data=None, files=None):
        last_err: RagError | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    if payload is not None:
                        resp = client.post(url, headers=headers, json=payload)
                    else:
                        resp = client.post(url, headers=headers, data=data, files=files)
                if resp.status_code == 200:
                    if expect_json:
                        try:
                            return resp.json()
                        except ValueError as e:
                            raise RagError(
                                ErrorCode.API_REQUEST_FAILED,
                                f"{self.label}: invalid JSON response",
                                retryable=False,
                            ) from e
                    return {}
                err = _map_status(resp.status_code)
                err.details["http_status"] = resp.status_code
                if not err.retryable or attempt >= self.max_retries:
                    raise err
                last_err = err
            except httpx.TimeoutException as e:
                last_err = RagError(ErrorCode.API_TIMEOUT, f"{self.label}: request timed out")
                if attempt >= self.max_retries:
                    raise last_err from e
            except httpx.HTTPError as e:
                last_err = RagError(
                    ErrorCode.API_REQUEST_FAILED, f"{self.label}: network error: {type(e).__name__}"
                )
                if attempt >= self.max_retries:
                    raise last_err from e
            # exponential backoff with jitter
            delay = min(30.0, (2 ** attempt) + random.uniform(0, 1))
            time.sleep(delay)
        raise last_err or RagError(ErrorCode.API_REQUEST_FAILED, f"{self.label}: failed")
