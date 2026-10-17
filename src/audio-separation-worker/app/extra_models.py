"""Community models that the audio-separator SDK doesn't ship, fetched straight from Hugging Face.

The SDK refuses any model filename missing from its own registry, so `install()` wraps
`Separator.download_model_files`: our models are downloaded here and returned in the SDK's
own tuple shape, everything else is delegated untouched. No SDK fork needed.

Dependency-free on purpose: also loaded by src/modal-deploy/deploy_modal.py, which copies
this file into the Modal image — keep it free of `app.*` imports.
"""

import logging
import os

logger = logging.getLogger("worker.extra_models")

_HF = "https://huggingface.co"

# filename -> (friendly name, architecture, [ckpt, yaml] paths under huggingface.co). The yaml is what the SDK
# builds the network from, so it must be returned as `yaml_config_filename`. Files are saved locally as
# `<filename>` / `<filename stem>.yaml`; the SDK only detects Roformers when "roformer" is in that yaml
# path, so the filename must contain it whatever the upstream file is called.
EXTRA_MODELS: dict[str, tuple[str, str, list[str]]] = {
    "gilliaan_melroformer_centerwide_v3.ckpt": (
        "gilliaan CenterWide v3 (Mel-Band Roformer)", "MDXC",
        ["gilliaan/CenterWide-Models/resolve/main/MelbandRoformer/gilliaan_melroformer_centerwide_v3.ckpt",
         "gilliaan/CenterWide-Models/resolve/main/MelbandRoformer/gilliaan_melroformer_centerwide_v3.yaml"],
    ),
    "gilliaan_bsroformer_centerwide_v3beta.ckpt": (
        "gilliaan CenterWide v3 beta (BS-Roformer)", "MDXC",
        ["gilliaan/CenterWide-Models/resolve/main/BandSplitRoformer/gilliaan_bsroformer_centerwide_v3beta.ckpt",
         "gilliaan/CenterWide-Models/resolve/main/BandSplitRoformer/gilliaan_bsroformer_centerwide_v3beta.yaml"],
    ),
    # MVSep Mega 53 re-hosted as one single-stem BS-Roformer per instrument (original: ZFTurbo/MSST v1.0.21).
    "bs_roformer_mega53_violin_mvsep.ckpt": (
        "MVSep Mega 53 - Violin (BS-Roformer)", "MDXC",
        ["noblebarkrr/BS-Roformer-MVSep-Mega-53-stems/resolve/main/v1/bs_mega_53stem_violin_mvsep.ckpt",
         "noblebarkrr/BS-Roformer-MVSep-Mega-53-stems/resolve/main/v1/bs_mega_53stem_violin_mvsep_config.yaml"],
    ),
    "bs_roformer_mega53_saxophone_mvsep.ckpt": (
        "MVSep Mega 53 - Saxophone (BS-Roformer)", "MDXC",
        ["noblebarkrr/BS-Roformer-MVSep-Mega-53-stems/resolve/main/v1/bs_mega_53stem_saxophone_mvsep.ckpt",
         "noblebarkrr/BS-Roformer-MVSep-Mega-53-stems/resolve/main/v1/bs_mega_53stem_saxophone_mvsep_config.yaml"],
    ),
}

_installed = False


def install() -> None:
    """Idempotently patch Separator.download_model_files to know EXTRA_MODELS."""
    global _installed
    if _installed:
        return
    from audio_separator.separator import Separator

    original = Separator.download_model_files

    def download_model_files(self, model_filename):
        spec = EXTRA_MODELS.get(model_filename)
        if spec is None:
            return original(self, model_filename)

        friendly_name, model_type, repo_paths = spec
        yaml_filename = os.path.splitext(model_filename)[0] + ".yaml"
        for repo_path in repo_paths:
            local_name = yaml_filename if repo_path.endswith(".yaml") else model_filename
            self.download_file_if_not_exists(f"{_HF}/{repo_path}", os.path.join(self.model_file_dir, local_name))
        self.model_friendly_name = friendly_name
        return model_filename, model_type, friendly_name, os.path.join(self.model_file_dir, model_filename), yaml_filename

    Separator.download_model_files = download_model_files
    _installed = True
    logger.info("Registered %d extra models", len(EXTRA_MODELS))
