"""Trims an audio file to a [start, end) range using ffmpeg, for pre-separation clipping."""

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("worker.audio_trim")


def trim_audio(input_path: Path, output_path: Path, start: float | None, end: float | None) -> None:
    """Trim `input_path` to [start, end] seconds (either bound optional) into `output_path`.

    Uses ffmpeg with -ss/-to placed AFTER -i for frame-accurate (not fast/keyframe) seeking —
    separation quality depends on exact boundaries. Re-encodes to PCM WAV so the output format
    is universally readable regardless of the source codec.
    """
    args = ["ffmpeg", "-y", "-i", str(input_path)]
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    if end is not None:
        args += ["-to", f"{end:.3f}"]
    args += ["-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(output_path)]

    logger.info("Trimming %s → %s (start=%s, end=%s)", input_path, output_path, start, end)
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.strip().splitlines()[-15:])
        raise RuntimeError(f"ffmpeg trim failed (exit {result.returncode}): {stderr_tail}")
