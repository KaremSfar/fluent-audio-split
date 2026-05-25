"""Pre-execution validation for audio-separator models and parameters.

Uses the python-audio-separator SDK to verify that requested models exist
and that the requested stems match what the model can produce,
before any separation work (local or remote) is attempted.
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
    """Validates model names, stems, and advanced parameters against the SDK catalog."""

    def __init__(self) -> None:
        self._model_catalog: dict[str, list[str]] | None = None

    def _load_catalog(self) -> dict[str, list[str]]:
        """Build a {model_filename: [stem_names]} map from the SDK.

        Uses ``Separator(info_only=True)`` to avoid GPU/device setup,
        then calls ``list_supported_model_files()`` which returns models
        grouped by architecture type.
        """
        if self._model_catalog is None:
            from audio_separator.separator import Separator

            sep = Separator(info_only=True)
            grouped = sep.list_supported_model_files()
            catalog: dict[str, list[str]] = {}
            for _arch, models in grouped.items():
                for _name, info in models.items():
                    filename = info.get("filename", "")
                    stems = info.get("stems") or []
                    if filename:
                        catalog[filename] = stems
            self._model_catalog = catalog
        return self._model_catalog

    def validate(
        self,
        model_name: str,
        stems: list[str] | None = None,
        extra_models: list[str] | None = None,
        advanced_params: dict | None = None,
    ) -> None:
        """Raise ``ValueError`` if any model, stem, or param is invalid."""
        self._validate_models(model_name, extra_models)
        if stems:
            self._validate_stems(model_name, stems)
        if advanced_params:
            self._validate_params(advanced_params)

    def _validate_models(
        self, model_name: str, extra_models: list[str] | None
    ) -> None:
        models = [model_name] + (extra_models or [])
        catalog = self._load_catalog()
        unknown = [m for m in models if m not in catalog]
        if unknown:
            raise ValueError(
                f"Model(s) not found: {unknown}. "
                f"Use a valid audio-separator model filename."
            )

    @staticmethod
    def _normalize_stem(stem: str) -> str:
        """Normalize a stem name for comparison: lowercase, strip spaces/hyphens/underscores."""
        return stem.lower().replace(" ", "").replace("-", "").replace("_", "")

    def _validate_stems(self, model_name: str, stems: list[str]) -> None:
        catalog = self._load_catalog()
        known_stems = catalog.get(model_name, [])
        if not known_stems:
            # Model has no stem metadata — skip validation
            return
        known_normalized = {self._normalize_stem(s) for s in known_stems}
        invalid = [s for s in stems if self._normalize_stem(s) not in known_normalized]
        if invalid:
            raise ValueError(
                f"Stem(s) {invalid} not available for model '{model_name}'. "
                f"Available stems: {known_stems}"
            )

    @staticmethod
    def _validate_params(advanced_params: dict) -> None:
        unknown_keys = set(advanced_params) - _ALL_KNOWN_KEYS
        if unknown_keys:
            logger.warning("Ignoring unrecognised advanced params: %s", unknown_keys)
