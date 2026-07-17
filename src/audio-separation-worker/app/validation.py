"""Pre-execution validation for audio-separator advanced params.

Model and stem existence are validated against model_registry.json (the single
source of truth — see app/model_registry.py) instead of a live SDK catalog fetch;
this module only sanity-checks advanced_params keys, which the registry has no
opinion on.
"""

import logging

logger = logging.getLogger("worker.validation")

# ── Known advanced-param keys per architecture ───────────────────────────────
_MDX_KEYS = {
    "mdx_segment_size", "mdx_overlap", "mdx_batch_size",
    "mdx_hop_length", "mdx_enable_denoise",
}
_VR_KEYS = {
    "vr_batch_size", "vr_window_size", "vr_aggression",
    "vr_enable_tta", "vr_high_end_process",
    "vr_enable_post_process", "vr_post_process_threshold",
}
_DEMUCS_KEYS = {
    "demucs_segment_size", "demucs_shifts",
    "demucs_overlap", "demucs_segments_enabled",
}
_MDXC_KEYS = {
    "mdxc_segment_size", "mdxc_override_model_segment_size",
    "mdxc_overlap", "mdxc_batch_size", "mdxc_pitch_shift",
}
_COMMON_KEYS = {
    "output_format", "normalization_threshold", "amplification_threshold",
    "invert_using_spec", "sample_rate", "use_soundfile", "use_autocast",
}
_ALL_KNOWN_KEYS = _MDX_KEYS | _VR_KEYS | _DEMUCS_KEYS | _MDXC_KEYS | _COMMON_KEYS


class SeparationValidator:
    """Validates advanced params. Model/stem existence is the registry's job."""

    def validate(self, advanced_params: dict | None = None) -> None:
        if advanced_params:
            self._validate_params(advanced_params)

    @staticmethod
    def _validate_params(advanced_params: dict) -> None:
        unknown_keys = set(advanced_params) - _ALL_KNOWN_KEYS
        if unknown_keys:
            logger.warning("Ignoring unrecognised advanced params: %s", unknown_keys)

