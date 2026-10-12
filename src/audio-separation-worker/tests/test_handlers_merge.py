import json
import shutil

import numpy as np
import pytest
import soundfile as sf

from app import handlers
from app.storage import LocalFileStorageProvider

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available")

EXEC_ID = "11111111-1111-1111-1111-111111111111"
NODE_ID = "c0ffee00-0000-0000-0000-000000000000"


@pytest.fixture
def events(monkeypatch):
    calls = {"started": [], "completed": [], "failed": []}
    monkeypatch.setattr(handlers, "publish_node_started", lambda *a, **k: calls["started"].append((a, k)))
    monkeypatch.setattr(handlers, "publish_node_completed", lambda *a, **k: calls["completed"].append((a, k)))
    monkeypatch.setattr(handlers, "publish_node_failed", lambda *a, **k: calls["failed"].append((a, k)))
    return calls


def make_stem(root, rel, freq):
    t = np.arange(22050) / 44100
    x = (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(p), np.stack([x, x], axis=1), 44100, subtype="PCM_24")


def payload(artifacts, config=None):
    return {
        "workflowExecutionId": EXEC_ID,
        "nodeExecutionId": NODE_ID,
        "nodeType": "Merge",
        "inputArtifactPath": "",
        "inputArtifacts": artifacts,
        "outputArtifactDir": f"executions/{EXEC_ID}/nodes/{NODE_ID}/",
        "configJson": json.dumps(config if config is not None else {"levelMode": "preventClipping", "ceilingDb": -1}),
    }


def test_merge_success_publishes_started_and_completed(tmp_path, events):
    make_stem(tmp_path, "x/vocals.wav", 440)
    make_stem(tmp_path, "x/bass.wav", 110)
    storage = LocalFileStorageProvider(str(tmp_path))
    handlers.handle_process_node(
        payload([{"path": "x/vocals.wav", "label": "Vocals", "gainDb": 0.0},
                 {"path": "x/bass.wav", "label": "Bass", "gainDb": -3.0}]),
        storage,
    )
    assert len(events["started"]) == 1 and not events["failed"]
    (args, _), = events["completed"]
    assert args[0] == EXEC_ID and args[1] == NODE_ID
    mix = args[2]
    assert list(mix) == ["Mix"]
    assert mix["Mix"] == f"executions/{EXEC_ID}/nodes/{NODE_ID}/mix_c0ffe.flac"
    assert (tmp_path / mix["Mix"]).exists()
    assert sf.info(str(tmp_path / mix["Mix"])).subtype == "PCM_24"


def test_merge_fewer_than_two_inputs_fails_non_transient(tmp_path, events):
    make_stem(tmp_path, "x/vocals.wav", 440)
    handlers.handle_process_node(
        payload([{"path": "x/vocals.wav", "label": "Vocals", "gainDb": 0.0}]),
        LocalFileStorageProvider(str(tmp_path)),
    )
    assert not events["completed"]
    (args, kwargs), = events["failed"]
    assert "at least 2" in args[2]
    assert kwargs["is_transient"] is False


def test_merge_invalid_level_mode_fails_non_transient(tmp_path, events):
    make_stem(tmp_path, "x/a.wav", 440)
    make_stem(tmp_path, "x/b.wav", 220)
    handlers.handle_process_node(
        payload([{"path": "x/a.wav", "label": "A", "gainDb": 0}, {"path": "x/b.wav", "label": "B", "gainDb": 0}],
                {"levelMode": "loud"}),
        LocalFileStorageProvider(str(tmp_path)),
    )
    (args, kwargs), = events["failed"]
    assert "levelMode" in args[2] and kwargs["is_transient"] is False


def test_merge_missing_input_file_is_transient(tmp_path, events):
    make_stem(tmp_path, "x/a.wav", 440)
    handlers.handle_process_node(
        payload([{"path": "x/a.wav", "label": "A", "gainDb": 0}, {"path": "x/missing.wav", "label": "B", "gainDb": 0}]),
        LocalFileStorageProvider(str(tmp_path)),
    )
    (args, kwargs), = events["failed"]
    assert kwargs["is_transient"] is True  # OSError (shared volume lag)


def test_merge_decode_error_is_not_transient(tmp_path, events):
    make_stem(tmp_path, "x/a.wav", 440)
    (tmp_path / "x" / "bad.wav").write_bytes(b"not audio")
    handlers.handle_process_node(
        payload([{"path": "x/a.wav", "label": "A", "gainDb": 0}, {"path": "x/bad.wav", "label": "B", "gainDb": 0}]),
        LocalFileStorageProvider(str(tmp_path)),
    )
    (args, kwargs), = events["failed"]
    assert kwargs["is_transient"] is False
