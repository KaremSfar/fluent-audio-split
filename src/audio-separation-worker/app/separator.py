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

# ── Param name mappings: flat configJson key → Separator dict key ─────────────
_MDX_PARAM_MAP = {
    "mdx_segment_size": "segment_size",
    "mdx_overlap": "overlap",
    "mdx_batch_size": "batch_size",
    "mdx_hop_length": "hop_length",
    "mdx_enable_denoise": "enable_denoise",
}
_VR_PARAM_MAP = {
    "vr_batch_size": "batch_size",
    "vr_window_size": "window_size",
    "vr_aggression": "aggression",
    "vr_enable_tta": "enable_tta",
    "vr_high_end_process": "high_end_process",
    "vr_enable_post_process": "enable_post_process",
    "vr_post_process_threshold": "post_process_threshold",
}
_DEMUCS_PARAM_MAP = {
    "demucs_segment_size": "segment_size",
    "demucs_shifts": "shifts",
    "demucs_overlap": "overlap",
    "demucs_segments_enabled": "segments_enabled",
}
_MDXC_PARAM_MAP = {
    "mdxc_segment_size": "segment_size",
    "mdxc_override_model_segment_size": "override_model_segment_size",
    "mdxc_overlap": "overlap",
    "mdxc_batch_size": "batch_size",
    "mdxc_pitch_shift": "pitch_shift",
}
_COMMON_KEYS = {
    "output_format",
    "normalization_threshold",
    "amplification_threshold",
    "invert_using_spec",
    "sample_rate",
    "use_soundfile",
    "use_autocast",
}


def _build_arch_dict(ap: dict, param_map: dict) -> dict | None:
    result = {v: ap[k] for k, v in param_map.items() if k in ap}
    return result or None


class AudioSeparator(ABC):
    """Strategy interface for audio stem separation."""

    @abstractmethod
    def separate(
        self,
        input_path: Path,
        output_dir: Path,
        model_name: str,
        output_names: dict[str, str],
        extra_models: list[str] | None = None,
        ensemble_algorithm: str = "avg_wave",
        advanced_params: dict | None = None,
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
        extra_models: list[str] | None = None,
        ensemble_algorithm: str = "avg_wave",
        advanced_params: dict | None = None,
    ) -> list[str]:
        from audio_separator.separator import Separator

        ap = advanced_params or {}
        models = [model_name] + (extra_models or [])

        common_kwargs = {k: ap[k] for k in _COMMON_KEYS if k in ap}
        mdx_params = _build_arch_dict(ap, _MDX_PARAM_MAP)
        vr_params = _build_arch_dict(ap, _VR_PARAM_MAP)
        demucs_params = _build_arch_dict(ap, _DEMUCS_PARAM_MAP)
        mdxc_params = _build_arch_dict(ap, _MDXC_PARAM_MAP)

        separator = Separator(
            model_file_dir=self.model_file_dir,
            output_dir=str(output_dir),
            ensemble_algorithm=ensemble_algorithm if len(models) > 1 else None,
            **common_kwargs,
            **({"mdx_params": mdx_params} if mdx_params else {}),
            **({"vr_params": vr_params} if vr_params else {}),
            **({"demucs_params": demucs_params} if demucs_params else {}),
            **({"mdxc_params": mdxc_params} if mdxc_params else {}),
        )
        # SDK accepts a list for ensemble, or a string for single model
        separator.load_model(model_filename=models if len(models) > 1 else model_name)
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
        extra_models: list[str] | None = None,
        ensemble_algorithm: str = "avg_wave",
        advanced_params: dict | None = None,
    ) -> list[str]:
        ap = advanced_params or {}
        models = [model_name] + (extra_models or [])

        result = self.client.separate_audio_and_wait(
            str(input_path),
            # Remote API accepts a list for multi-model ensemble
            models=models if len(models) > 1 else None,
            model=model_name if len(models) == 1 else None,
            timeout=600,
            poll_interval=10,
            download=True,
            output_dir=str(output_dir),
            # API client expects a dict and handles JSON serialization internally
            custom_output_names=output_names or None,
            # Pass all advanced params as flat kwargs (same naming as remote API)
            **ap,
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
