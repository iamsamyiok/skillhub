from __future__ import annotations

from ..config import ProviderConfig
from ..errors import ErrorCode, RagError
from .http import HttpCaller


class AsrProvider:
    """OpenAI-compatible /audio/transcriptions client with segment timestamps."""

    def __init__(self, cfg: ProviderConfig):
        if not cfg.is_configured():
            raise RagError(
                ErrorCode.ASR_PROVIDER_NOT_CONFIGURED,
                "ASR provider is not fully configured",
                retryable=False,
                suggestion="Configure [asr] provider/base_url/model and its API key env var.",
            )
        self.cfg = cfg
        self.model = cfg.model
        self._caller = HttpCaller(cfg.timeout_seconds, cfg.max_retries, "asr")

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        """Returns {'text': str, 'segments': [{'start': s, 'end': s, 'text': str}], 'timestamp_precision': 'segment'|'unavailable'}"""
        url = self.cfg.base_url.rstrip("/") + "/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.cfg.api_key()}"}
        with open(audio_path, "rb") as f:
            resp = self._caller.post_multipart(
                url,
                headers,
                data={"model": self.model, "response_format": "verbose_json",
                      **({"language": language} if language else {})},
                files={"file": (audio_path.split("/")[-1].split("\\")[-1], f)},
            )
        segments = resp.get("segments") or []
        return {
            "text": resp.get("text", ""),
            "segments": [
                {"start": s.get("start"), "end": s.get("end"), "text": s.get("text", "")}
                for s in segments
            ],
            "timestamp_precision": "segment" if segments else "unavailable",
        }
