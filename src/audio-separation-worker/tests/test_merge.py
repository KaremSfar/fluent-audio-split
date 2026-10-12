import logging
import shutil
import subprocess

import numpy as np
import pytest
import soundfile as sf

from app.merge import MergeInput, merge_stems

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available")

SR = 44100


def sine(freq, seconds, amp=0.25, sr=SR):
    t = np.arange(int(seconds * sr)) / sr
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def write(path, data, sr=SR, subtype="PCM_24"):
    sf.write(str(path), data, sr, subtype=subtype)
    return path


def stereo(mono):
    return np.stack([mono, mono], axis=1)


def peak_db(x):
    return 20 * np.log10(np.max(np.abs(x)))


def read(path):
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return data, sr


def test_sum_two_sines(tmp_path):
    a, b = sine(440, 1.0), sine(880, 1.0)
    pa = write(tmp_path / "a.wav", stereo(a))
    pb = write(tmp_path / "b.wav", stereo(b))
    out = tmp_path / "mix.flac"
    res = merge_stems([MergeInput(pa, 0, "a"), MergeInput(pb, 0, "b")], out)
    data, sr = read(out)
    assert sr == SR and res.sample_rate == SR
    assert data.shape == (len(a), 2)
    np.testing.assert_allclose(data[:, 0], a + b, atol=1e-4)
    np.testing.assert_allclose(data[:, 1], a + b, atol=1e-4)
    assert res.applied_gain_db == 0.0


def test_gain_applied(tmp_path):
    a = sine(440, 0.5, amp=0.4)
    pa = write(tmp_path / "a.wav", stereo(a))
    pb = write(tmp_path / "b.wav", stereo(np.zeros_like(a)))
    out = tmp_path / "mix.flac"
    merge_stems([MergeInput(pa, -6.0, "a"), MergeInput(pb, 0, "b")], out)
    data, _ = read(out)
    np.testing.assert_allclose(data[:, 0], a * 10 ** (-6 / 20), atol=1e-4)
    assert abs(10 ** (-6 / 20) - 0.501) < 0.001


def test_length_mismatch_zero_pads(tmp_path):
    a, b = sine(440, 1.0), sine(660, 0.5)
    pa = write(tmp_path / "a.wav", stereo(a))
    pb = write(tmp_path / "b.wav", stereo(b))
    out = tmp_path / "mix.flac"
    res = merge_stems([MergeInput(pa, 0, "a"), MergeInput(pb, 0, "b")], out)
    data, _ = read(out)
    assert res.frames == len(a) == data.shape[0]
    tail = data[len(b):, 0]
    np.testing.assert_allclose(tail, a[len(b):], atol=1e-4)
    # also when the first input is the shorter one
    out2 = tmp_path / "mix2.flac"
    merge_stems([MergeInput(pb, 0, "b"), MergeInput(pa, 0, "a")], out2)
    data2, _ = read(out2)
    assert data2.shape[0] == len(a)


def test_mono_plus_stereo_gives_stereo(tmp_path):
    a, b = sine(440, 0.5), sine(880, 0.5)
    pa = write(tmp_path / "mono.wav", a)  # 1-D => mono file
    pb = write(tmp_path / "st.wav", np.stack([b, -b], axis=1))
    out = tmp_path / "mix.flac"
    merge_stems([MergeInput(pa, 0, "m"), MergeInput(pb, 0, "s")], out)
    data, _ = read(out)
    assert data.shape[1] == 2
    np.testing.assert_allclose(data[:, 0], a + b, atol=1e-4)
    np.testing.assert_allclose(data[:, 1], a - b, atol=1e-4)


def test_resamples_to_first_input_rate(tmp_path):
    a = sine(440, 1.0, sr=48000)
    b = sine(440, 1.0, sr=44100)
    pa = write(tmp_path / "a48.wav", stereo(a), sr=48000)
    pb = write(tmp_path / "b44.wav", stereo(b), sr=44100)
    out = tmp_path / "mix.flac"
    res = merge_stems([MergeInput(pa, 0, "a"), MergeInput(pb, 0, "b")], out)
    data, sr = read(out)
    assert sr == res.sample_rate == 48000
    assert abs(data.shape[0] - 48000) <= 2


def test_mp3_input_decodes(tmp_path):
    a = sine(440, 1.0)
    wav = write(tmp_path / "a.wav", stereo(a))
    mp3 = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), str(mp3)], check=True)
    pb = write(tmp_path / "b.wav", stereo(sine(880, 1.0)))
    out = tmp_path / "mix.flac"
    res = merge_stems([MergeInput(mp3, 0, "a"), MergeInput(pb, 0, "b")], out)
    assert res.sample_rate == SR
    assert abs(res.frames - SR) < 5000  # mp3 encoder delay/padding


def _loud_pair(tmp_path, amp):
    a = sine(440, 1.0, amp=amp)
    pa = write(tmp_path / "a.wav", stereo(a))
    pb = write(tmp_path / "b.wav", stereo(a))  # identical -> peaks add: 2*amp
    return [MergeInput(pa, 0, "a"), MergeInput(pb, 0, "b")]


def test_prevent_clipping_scales_to_ceiling(tmp_path):
    out = tmp_path / "mix.flac"
    res = merge_stems(_loud_pair(tmp_path, 0.9), out, "preventClipping")  # raw peak 1.8
    data, _ = read(out)
    assert abs(peak_db(data) - (-1.0)) < 0.01
    assert res.applied_gain_db < 0 and res.peak_dbfs_pre > 0


def test_prevent_clipping_leaves_quiet_mix_untouched(tmp_path):
    out = tmp_path / "mix.flac"
    res = merge_stems(_loud_pair(tmp_path, 0.1), out, "preventClipping")  # raw peak 0.2
    data, _ = read(out)
    assert abs(np.max(np.abs(data)) - 0.2) < 1e-3
    assert res.applied_gain_db == 0.0


def test_normalize_peak_boosts(tmp_path):
    out = tmp_path / "mix.flac"
    res = merge_stems(_loud_pair(tmp_path, 0.05), out, "normalizePeak", ceiling_db=-3.0)
    data, _ = read(out)
    assert abs(peak_db(data) - (-3.0)) < 0.01
    assert res.applied_gain_db > 0


def test_none_clips_and_warns(tmp_path, caplog):
    out = tmp_path / "mix.flac"
    with caplog.at_level(logging.WARNING, logger="worker.merge"):
        res = merge_stems(_loud_pair(tmp_path, 0.9), out, "none")
    data, _ = read(out)
    assert np.max(np.abs(data)) <= 1.0
    assert np.max(np.abs(data)) > 0.999  # clipped at full scale
    assert res.applied_gain_db == 0.0
    assert any("clipped" in r.message for r in caplog.records)


def test_output_is_flac_pcm24(tmp_path):
    out = tmp_path / "mix.flac"
    merge_stems(_loud_pair(tmp_path, 0.1), out)
    info = sf.info(str(out))
    assert info.format == "FLAC" and info.subtype == "PCM_24"


def test_invalid_level_mode_raises(tmp_path):
    with pytest.raises(ValueError):
        merge_stems(_loud_pair(tmp_path, 0.1), tmp_path / "m.flac", "bogus")
