from __future__ import annotations

import base64
import mimetypes

from ..config import ProviderConfig
from ..errors import ErrorCode, RagError
from .http import HttpCaller


class VisionProvider:
    """OpenAI-compatible chat-completions vision client for image captions."""

    def __init__(self, cfg: ProviderConfig):
        if not cfg.is_configured():
            raise RagError(
                ErrorCode.VISION_PROVIDER_NOT_CONFIGURED,
                "Vision provider is not fully configured",
                retryable=False,
                suggestion="Configure [vision] provider/base_url/model and its API key env var.",
            )
        self.cfg = cfg
        self.model = cfg.model
        self._caller = HttpCaller(cfg.timeout_seconds, cfg.max_retries, "vision")

    def describe_image(self, image_path: str, prompt: str | None = None,
                       task: str = "caption") -> str:
        if prompt is None:
            prompt = (
                "Transcribe all visible text in this image exactly, then briefly describe charts/diagrams."
                if task == "ocr"
                else "Describe this image factually."
            )
        mime = mimetypes.guess_type(image_path)[0] or "image/png"
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        url = self.cfg.base_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {self.cfg.api_key()}"}
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                }
            ],
            "max_tokens": 800,
        }
        resp = self._caller.post_json(url, headers, payload)
        try:
            return resp["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise RagError(
                ErrorCode.API_REQUEST_FAILED,
                "Vision response missing expected fields",
                retryable=False,
            ) from e
