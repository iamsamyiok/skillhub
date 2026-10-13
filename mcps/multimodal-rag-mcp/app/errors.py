from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class ErrorCode:
    LIBRARY_NOT_FOUND = "LIBRARY_NOT_FOUND"
    LIBRARY_DISABLED = "LIBRARY_DISABLED"
    PATH_OUTSIDE_LIBRARY = "PATH_OUTSIDE_LIBRARY"
    EXTERNAL_FILE_NOT_ALLOWED = "EXTERNAL_FILE_NOT_ALLOWED"
    FILE_NOT_FOUND = "FILE_NOT_FOUND"
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    PARSER_DEPENDENCY_MISSING = "PARSER_DEPENDENCY_MISSING"
    PARSER_FAILED = "PARSER_FAILED"
    VISION_PROVIDER_NOT_CONFIGURED = "VISION_PROVIDER_NOT_CONFIGURED"
    ASR_PROVIDER_NOT_CONFIGURED = "ASR_PROVIDER_NOT_CONFIGURED"
    EMBEDDING_PROVIDER_NOT_CONFIGURED = "EMBEDDING_PROVIDER_NOT_CONFIGURED"
    EMBEDDING_DIMENSION_MISMATCH = "EMBEDDING_DIMENSION_MISMATCH"
    API_AUTH_FAILED = "API_AUTH_FAILED"
    API_RATE_LIMITED = "API_RATE_LIMITED"
    API_TIMEOUT = "API_TIMEOUT"
    API_REQUEST_FAILED = "API_REQUEST_FAILED"
    ZVEC_WRITE_FAILED = "ZVEC_WRITE_FAILED"
    METADATA_WRITE_FAILED = "METADATA_WRITE_FAILED"
    INDEX_INCONSISTENT = "INDEX_INCONSISTENT"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"
    CLIENT_CANNOT_ACCESS_URI = "CLIENT_CANNOT_ACCESS_URI"
    OPERATION_CONFIRMATION_REQUIRED = "OPERATION_CONFIRMATION_REQUIRED"
    CONFIG_INVALID = "CONFIG_INVALID"
    INTERNAL_ERROR = "INTERNAL_ERROR"


RETRYABLE_CODES = {
    ErrorCode.API_RATE_LIMITED,
    ErrorCode.API_TIMEOUT,
    ErrorCode.API_REQUEST_FAILED,
    ErrorCode.ZVEC_WRITE_FAILED,
    ErrorCode.METADATA_WRITE_FAILED,
}


@dataclass
class RagError(Exception):
    code: str
    message: str
    retryable: bool | None = None
    suggestion: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.retryable is None:
            self.retryable = self.code in RETRYABLE_CODES
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "error_code": self.code,
            "message": self.message,
            "retryable": bool(self.retryable),
            "suggestion": self.suggestion,
            "details": self.details,
        }
