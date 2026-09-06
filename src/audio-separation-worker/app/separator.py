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


class TransientSeparationError(RuntimeError):
    """Raised for separation failures that are expected to succeed on retry
    (e.g. transient network/storage errors), as opposed to permanent config errors."""


_TRANSIENT_REMOTE_ERROR_PATTERNS = (
    "errno 22",            # cold model-download/caching race (observed failure mode)
    "invalid argument",
    "instantiate",         # "...instantiate <X> model..." — model-loading race
    "timeout", "timed out",
    "connection reset", "connection refused", "connection aborted",
    "500", "502", "503", "504",
    "internal server error", "bad gateway", "service unavailable", "gateway timeout",
)


def _is_transient_remote_error(message: str) -> bool:
    """Best-effort classification of a remote-API error message as transient (worth an
    automatic retry) vs. permanent (bad model/config — retrying won't help). The remote
    error is opaque (a plain string from the API), so this is pattern-matching on known
    transient failure signatures observed in practice (see TODO.md item #8)."""
    lowered = message.lower()
    return any(p in lowered for p in _TRANSIENT_REMOTE_ERROR_PATTERNS)


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


# Matches the default shown in the front-end's advanced params UI
# (src/front/src/lib/advancedParams.ts). Without this, LocalAudioSeparator falls
# back to the SDK's own default ("WAV") and RemoteAudioSeparator falls back to
# the remote API client's default ("flac") whenever the front-end doesn't send
# an explicit output_format, so the two backends silently disagree with the UI.
_DEFAULT_OUTPUT_FORMAT = "MP3"


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
        ap.setdefault("output_format", _DEFAULT_OUTPUT_FORMAT)
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
        ap.setdefault("output_format", _DEFAULT_OUTPUT_FORMAT)
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
            downloaded_files = result.get("downloaded_files", [])
            expected_files = result.get("files", {})
            expected_count = len(expected_files)

            # The remote client swallows per-file download errors internally and still
            # reports status "completed" even if some/all files failed to download (e.g.
            # transient 500s from the API server when a concurrent job holds files open on
            # the same shared volume). Treat a short download count as a failure so the node
            # is retried instead of silently completing with missing/no stems.
            if expected_count and len(downloaded_files) < expected_count:
                raise TransientSeparationError(
                    f"Remote separation reported success but only {len(downloaded_files)}/"
                    f"{expected_count} output file(s) downloaded — likely a transient "
                    "download failure on the remote API; retry the node."
                )
            return downloaded_files

        error_message = result.get("error", "Unknown error")
        full_message = f"Remote separation failed: {error_message}"
        if _is_transient_remote_error(error_message):
            raise TransientSeparationError(full_message)
        raise RuntimeError(full_message)


def create_audio_separator() -> AudioSeparator:
    """Factory: returns Remote if AUDIO_SEPARATOR_API_URL is set, else Local."""
    if AUDIO_SEPARATOR_API_URL:
        logger.info("Using remote audio separator at %s", AUDIO_SEPARATOR_API_URL)
        return RemoteAudioSeparator(AUDIO_SEPARATOR_API_URL, AUDIO_SEPARATOR_API_KEY)

    logger.info("Using local audio separator")
    return LocalAudioSeparator()
