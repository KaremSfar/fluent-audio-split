"""Merge node: sum several stems into one mix (CPU only, numpy + ffmpeg decode).

Each input is decoded by ffmpeg to stereo float32 at the first input's sample rate, scaled by its gain,
and summed into an accumulator that grows to the longest input (shorter inputs are zero-padded at the end).
The mix is then level-handled per ``level_mode`` and written as 24-bit FLAC.

Alignment note: stems produced by the same separator share the same encoder and settings, so MP3 encoder
delay is identical across inputs and no inter-input offset compensation is applied.
True-peak (inter-sample) level is not measured; the ceiling applies to sample peak.
"""

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

logger = logging.getLogger("worker.merge")

LEVEL_MODES = ("preventClipping", "normalizePeak", "none")
DEFAULT_SAMPLE_RATE = 44100
_CHANNELS = 2


@dataclass(frozen=True)
class MergeInput:
    path: Path
    gain_db: float = 0.0
    label: str = ""


@dataclass(frozen=True)
class MergeResult:
    output_path: Path
    sample_rate: int
    frames: int
    peak_dbfs_pre: float
    applied_gain_db: float


def _to_db(linear: float) -> float:
    return float("-inf") if linear <= 0 else 20.0 * float(np.log10(linear))


def _probe(path: Path) -> tuple[int, int] | None:
    """(sample_rate, channels) via soundfile, falling back to ffprobe (e.g. mp3 on old libsndfile)."""
    try:
        info = sf.info(str(path))
        return int(info.samplerate), int(info.channels)
    except Exception:  # noqa: BLE001 - any decoder failure falls through to ffprobe
        pass
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels",
             "-of", "csv=p=0", str(path)],
            capture_output=True, check=True,
        )
        sr, ch = proc.stdout.decode().strip().splitlines()[0].split(",")[:2]
        return int(sr), int(ch)
    except (subprocess.CalledProcessError, ValueError, IndexError):
        return None


def probe_sample_rate(path: Path) -> int:
    probed = _probe(path)
    if probed is None:
        logger.warning("Could not probe sample rate of %s; using %d", path, DEFAULT_SAMPLE_RATE)
        return DEFAULT_SAMPLE_RATE
    return probed[0]


def decode_to_float(path: Path, sample_rate: int, channels: int = _CHANNELS) -> np.ndarray:
    """Decode any ffmpeg-readable file to a (frames, channels) float32 array at `sample_rate`."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path)]
    probed = _probe(path)
    if channels == 2 and probed is not None and probed[1] == 1:
        # Plain `-ac 2` applies a -3 dB centre mix to mono; duplicate at unity instead.
        cmd += ["-af", "pan=stereo|c0=c0|c1=c0"]
    cmd += ["-f", "f32le", "-ac", str(channels), "-ar", str(sample_rate), "pipe:1"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to decode {path.name}: {proc.stderr.decode(errors='replace').strip()}")
    return np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, channels)


def merge_stems(
    inputs: list[MergeInput],
    out_path: Path,
    level_mode: str = "preventClipping",
    ceiling_db: float = -1.0,
) -> MergeResult:
    if not inputs:
        raise ValueError("merge_stems requires at least one input")
    if level_mode not in LEVEL_MODES:
        raise ValueError(f"Invalid levelMode '{level_mode}'. Expected one of: {', '.join(LEVEL_MODES)}")

    sr = probe_sample_rate(inputs[0].path)
    acc = np.zeros((0, _CHANNELS), dtype=np.float32)

    for inp in inputs:
        x = decode_to_float(inp.path, sr)
        if len(x) > len(acc):
            grown = np.zeros((len(x), _CHANNELS), dtype=np.float32)
            grown[: len(acc)] = acc
            acc = grown
        acc[: len(x)] += x * np.float32(10.0 ** (inp.gain_db / 20.0))

    peak = float(np.max(np.abs(acc))) if acc.size else 0.0
    ceiling = 10.0 ** (ceiling_db / 20.0)
    scale = 1.0

    if peak > 0:
        if level_mode == "preventClipping":
            if peak > ceiling:
                scale = ceiling / peak
        elif level_mode == "normalizePeak":
            scale = ceiling / peak
        elif peak > 1.0:  # "none"
            logger.warning("Merge level mode 'none': peak %.2f dBFS exceeds full scale; samples will be clipped",
                           _to_db(peak))

    if scale != 1.0:
        acc *= np.float32(scale)
    np.clip(acc, -1.0, 1.0, out=acc)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), acc, sr, format="FLAC", subtype="PCM_24")

    result = MergeResult(
        output_path=out_path,
        sample_rate=sr,
        frames=len(acc),
        peak_dbfs_pre=_to_db(peak),
        applied_gain_db=_to_db(scale) if scale != 1.0 else 0.0,
    )
    logger.info("Merged %d inputs -> %s (sr=%d, frames=%d, peak_pre=%.2f dBFS, applied=%.2f dB)",
                len(inputs), out_path.name, sr, result.frames, result.peak_dbfs_pre, result.applied_gain_db)
    return result
