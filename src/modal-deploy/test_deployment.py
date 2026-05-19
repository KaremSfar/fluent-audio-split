#!/usr/bin/env python3
"""
Test script for the audio-separator Modal deployment.

Usage:
  export AUDIO_SEPARATOR_API_URL="https://YOUR_USERNAME--audio-separator-api.modal.run"
  export AUDIO_SEPARATOR_API_KEY="your-secret-key"

  python test_deployment.py                    # health check + model list only
  python test_deployment.py song.mp3           # full separation test
"""

import os
import sys
import time
import logging

import requests

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("test")

API_URL = os.environ.get("AUDIO_SEPARATOR_API_URL", "").rstrip("/")
API_KEY = os.environ.get("AUDIO_SEPARATOR_API_KEY", "")

if not API_URL:
    sys.exit("❌ Set AUDIO_SEPARATOR_API_URL first")
if not API_KEY:
    sys.exit("❌ Set AUDIO_SEPARATOR_API_KEY first")

headers = {"X-API-Key": API_KEY}


def test_health() -> bool:
    print("\n🏥 Testing /health ...")
    r = requests.get(f"{API_URL}/health")
    print(f"   Status: {r.status_code}  {r.json()}")
    return r.status_code == 200


def test_auth_rejected() -> bool:
    print("\n🔒 Testing auth rejection (no key) ...")
    r = requests.get(f"{API_URL}/models")
    print(f"   Status: {r.status_code} (expected 401)")
    return r.status_code in (401, 422)


def test_models() -> bool:
    print("\n📋 Testing /models ...")
    r = requests.get(f"{API_URL}/models", headers=headers)
    if r.status_code != 200:
        print(f"   ❌ Status {r.status_code}: {r.text[:200]}")
        return False
    lines = r.text.strip().split("\n")
    print(f"   ✅ Got {len(lines)} lines of model data")
    for line in lines[:5]:
        print(f"   {line}")
    if len(lines) > 5:
        print(f"   ... and {len(lines) - 5} more")
    return True


def test_separation(file_path: str) -> bool:
    """Full separation test — tries SDK client, falls back to raw HTTP."""
    try:
        from audio_separator.remote import AudioSeparatorAPIClient
    except ImportError:
        print("\n⚠️  audio-separator not installed — falling back to raw HTTP")
        return _test_separation_raw(file_path)

    print(f"\n🎶 Separating with SDK client: {file_path}")
    os.makedirs("./test_output", exist_ok=True)
    client = AudioSeparatorAPIClient(API_URL, logger)
    client.session.headers["X-API-Key"] = API_KEY

    result = client.separate_audio_and_wait(
        file_path, timeout=600, poll_interval=10,
        download=True, output_dir="./test_output",
    )

    if result.get("status") == "completed":
        print("   ✅ Separation completed!")
        for f in result.get("downloaded_files", []):
            print(f"   📁 {f}")
        return True

    print(f"   ❌ Failed: {result.get('error', result)}")
    return False


def _test_separation_raw(file_path: str) -> bool:
    """Fallback: test separation with plain requests."""
    print(f"\n🎶 Separating (raw HTTP): {file_path}")
    with open(file_path, "rb") as f:
        r = requests.post(f"{API_URL}/separate", headers=headers, files={"file": f})

    if r.status_code != 200:
        print(f"   ❌ Submit failed: {r.status_code} {r.text[:200]}")
        return False

    task_id = r.json()["task_id"]
    print(f"   📤 Submitted — task_id: {task_id}")

    for _ in range(60):
        status = requests.get(f"{API_URL}/status/{task_id}", headers=headers).json()
        state = status["status"]
        print(f"   ⏳ {state} ({status.get('progress', 0)}%)", end="\r")

        if state == "completed":
            os.makedirs("./test_output", exist_ok=True)
            print("\n   ✅ Done! Files:")
            for file_hash, filename in status.get("files", {}).items():
                data = requests.get(f"{API_URL}/download/{task_id}/{file_hash}", headers=headers)
                out = f"./test_output/{filename}"
                with open(out, "wb") as fout:
                    fout.write(data.content)
                print(f"   📁 {out}")
            return True
        elif state == "error":
            print(f"\n   ❌ Error: {status.get('error')}")
            return False
        time.sleep(10)

    print("\n   ❌ Timeout")
    return False


if __name__ == "__main__":
    results = [
        ("Health check", test_health()),
        ("Auth rejection", test_auth_rejected()),
        ("Model listing", test_models()),
    ]

    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        if not os.path.exists(audio_file):
            sys.exit(f"❌ File not found: {audio_file}")
        results.append(("Separation", test_separation(audio_file)))

    print("\n" + "=" * 40)
    print("Results:")
    all_pass = True
    for name, passed in results:
        print(f"  {'✅' if passed else '❌'} {name}")
        if not passed:
            all_pass = False

    sys.exit(0 if all_pass else 1)
