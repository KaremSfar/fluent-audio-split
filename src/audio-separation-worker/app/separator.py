"""
Audio separation abstraction layer.

Provides two implementations:
- LocalAudioSeparator: runs ML inference on the local machine (requires GPU/CPU + models)
- RemoteAudioSeparator: delegates to a remote audio-separator API server

Selection is driven by the AUDIO_SEPARATOR_API_URL environment variable.
"""

import gc
import logging
from abc import ABC, abstractmethod
from pathlib import Path

from app.config import AUDIO_SEPARATOR_API_KEY, AUDIO_SEPARATOR_API_URL, MODEL_FILE_DIR

logger = logging.getLogger("worker.separator")


class AudioSeparator(ABC):
    """Strategy interface for audio stem separation."""

    @abstractmethod
    def separate(
        self,
        input_path: Path,
        output_dir: Path,
        model_name: str,
        output_names: dict[str, str],
    ) -> list[str]:
        """Run separation and return a list of absolute output file paths."""
        ...


class LocalAudioSeparator(AudioSeparator):
    """Runs audio-separator ML models on the local machine."""

    def __init__(self, model_file_dir: str = MODEL_FILE_DIR) -> None:
        self.model_file_dir = model_file_dir

    def separate(
        self,
        input_path: Path,
        output_dir: Path,
        model_name: str,
        output_names: dict[str, str],
    ) -> list[str]:
        from audio_separator.separator import Separator

        separator = Separator(
            model_file_dir=self.model_file_dir,
            output_dir=str(output_dir),
        )
        separator.load_model(model_filename=model_name)
        output_files: list[str] = separator.separate(str(input_path), output_names)
        del separator
        gc.collect()
        return output_files


class RemoteAudioSeparator(AudioSeparator):
    """Delegates separation to a remote audio-separator API server."""

    def __init__(self, api_url: str, api_key: str = "") -> None:
        from audio_separator.remote import AudioSeparatorAPIClient

        self.client = AudioSeparatorAPIClient(api_url, logger)
        if api_key:
            self.client.session.headers["X-API-Key"] = api_key

    def separate(
        self,
        input_path: Path,
        output_dir: Path,
        model_name: str,
        output_names: dict[str, str],
    ) -> list[str]:
        result = self.client.separate_audio_and_wait(
            str(input_path),
            model=model_name,
            timeout=600,
            poll_interval=10,
            download=True,
            output_dir=str(output_dir),
        )

        if result.get("status") == "completed":
            return result.get("downloaded_files", [])

        raise RuntimeError(
            f"Remote separation failed: {result.get('error', 'Unknown error')}"
        )


def create_audio_separator() -> AudioSeparator:
    """Factory: returns Remote if AUDIO_SEPARATOR_API_URL is set, else Local."""
    if AUDIO_SEPARATOR_API_URL:
        logger.info("Using remote audio separator at %s", AUDIO_SEPARATOR_API_URL)
        return RemoteAudioSeparator(AUDIO_SEPARATOR_API_URL, AUDIO_SEPARATOR_API_KEY)

    logger.info("Using local audio separator")
    return LocalAudioSeparator()
