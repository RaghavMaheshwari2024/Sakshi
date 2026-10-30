"""OpenAI-SDK clients pointed at Meta Model API (or at a private Glimmer server)."""

from __future__ import annotations

from functools import lru_cache

from openai import AsyncOpenAI, OpenAI

from .. import config


@lru_cache(maxsize=1)
def sync_client() -> OpenAI:
    # The OpenAI SDK does not read MODEL_API_KEY itself, so pass it explicitly.
    return OpenAI(base_url=config.META_BASE_URL, api_key=config.api_key())


def async_client() -> AsyncOpenAI:
    # Not cached: SAM calls use it as an async context manager.
    return AsyncOpenAI(base_url=config.META_BASE_URL, api_key=config.api_key())


@lru_cache(maxsize=1)
def glimmer_client() -> OpenAI:
    """Muse Glimmer on our own hardware, for private mode."""
    return OpenAI(base_url=config.GLIMMER_BASE_URL, api_key=config.GLIMMER_API_KEY)


def text_client_and_model(default_model: str) -> tuple[OpenAI, str, str]:
    """Return (client, model, label) for language steps, honouring private mode."""
    if config.PRIVATE_MODE:
        return glimmer_client(), config.GLIMMER_MODEL, "muse-glimmer (private)"
    return sync_client(), default_model, default_model
