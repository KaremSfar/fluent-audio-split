"""
Audio Separator API — Modal deployment.

Deploys audio-separator as a GPU-backed FastAPI service on Modal.
All endpoints (except /health) require an X-API-Key header.

Deploy:  modal deploy deploy_modal.py
"""

import hashlib
import json
import logging
import os
import shutil
import traceback
import typing
import uuid
from importlib.metadata import version
from typing import Optional
from urllib.parse import quote

import filetype
import modal
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import PlainTextResponse, Response as StarletteResponse

DEFAULT_MODEL_NAME = "default"

try:
    AUDIO_SEPARATOR_VERSION = version("audio-separator")
except Exception:
    AUDIO_SEPARATOR_VERSION = "unknown"


def _file_hash(filename: str) -> str:
    """Short stable hash of a filename for use in download URLs."""
    return hashlib.sha256(filename.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Modal resources
# ---------------------------------------------------------------------------
app = modal.App("audio-separator")

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.1-devel-ubuntu22.04", add_python="3.13")
    .apt_install([
        "curl", "wget",
        "libsndfile1", "libsndfile1-dev", "libsox-dev", "sox",
        "libportaudio2", "portaudio19-dev", "libasound2-dev", "libpulse-dev", "libjack-dev",
        "libsamplerate0", "libsamplerate0-dev",
        "build-essential", "clang", "gcc", "g++", "make", "cmake", "pkg-config",
    ])
    .run_commands([
        "echo '/usr/local/cuda/lib64' >> /etc/ld.so.conf.d/cuda.conf",
        "ldconfig",
        "wget https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
        "tar -xf ffmpeg-master-latest-linux64-gpl.tar.xz",
        "cp ffmpeg-master-latest-linux64-gpl/bin/* /usr/local/bin/",
        "chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe",
        "ffmpeg -version",
    ])
    .pip_install([
        "audio-separator[gpu]",
        "fastapi>=0.104.0",
        "uvicorn[standard]>=0.24.0",
        "python-multipart>=0.0.6",
        "filetype>=1.2.0",
    ])
    .env({
        "AUDIO_SEPARATOR_MODEL_DIR": "/models",
        "LD_LIBRARY_PATH": "/usr/local/cuda/lib64:$LD_LIBRARY_PATH",
        "PATH": "/usr/local/cuda/bin:$PATH",
    })
)

volume = modal.Volume.from_name("audio-separator-storage", create_if_missing=True)
models_volume = modal.Volume.from_name("audio-separator-models", create_if_missing=True)
api_key_secret = modal.Secret.from_name("audio-separator-api-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class PrettyJSONResponse(StarletteResponse):
    media_type = "application/json"

    def render(self, content: typing.Any) -> bytes:
        return json.dumps(content, ensure_ascii=False, indent=4, separators=(", ", ": ")).encode("utf-8")


def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> None:
    expected = os.environ.get("API_KEY")
    if not expected or x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Modal functions
# ---------------------------------------------------------------------------
@app.function(
    image=image, gpu="ANY", timeout=1200,
    volumes={"/storage": volume, "/models": models_volume},
    # Keep a GPU container warm for 30s after its last job so sequential nodes in a chained
    # workflow (which fire seconds apart) reuse the same warm, model-loaded container instead of
    # cold-starting each time — while still scaling down quickly once truly idle to cut GPU cost.
    scaledown_window=30,
)
def separate_audio_function(
    audio_data: bytes,
    filename: str,
    models: Optional[list] = None,
    task_id: Optional[str] = None,
    output_format: str = "flac",
    output_bitrate: Optional[str] = None,
    normalization_threshold: float = 0.9,
    amplification_threshold: float = 0.0,
    output_single_stem: Optional[str] = None,
    invert_using_spec: bool = False,
    sample_rate: int = 44100,
    use_soundfile: bool = False,
    use_autocast: bool = False,
    custom_output_names: Optional[dict] = None,
    mdx_segment_size: int = 256,
    mdx_overlap: float = 0.25,
    mdx_batch_size: int = 1,
    mdx_hop_length: int = 1024,
    mdx_enable_denoise: bool = False,
    vr_batch_size: int = 1,
    vr_window_size: int = 512,
    vr_aggression: int = 5,
    vr_enable_tta: bool = False,
    vr_high_end_process: bool = False,
    vr_enable_post_process: bool = False,
    vr_post_process_threshold: float = 0.2,
    demucs_segment_size: str = "Default",
    demucs_shifts: int = 2,
    demucs_overlap: float = 0.25,
    demucs_segments_enabled: bool = True,
    mdxc_segment_size: int = 256,
    mdxc_override_model_segment_size: bool = False,
    mdxc_overlap: int = 8,
    mdxc_batch_size: int = 1,
    mdxc_pitch_shift: int = 0,
) -> dict:
    """Separate audio into stems using one or more models."""
    from audio_separator.separator import Separator

    if task_id is None:
        task_id = str(uuid.uuid4())
    if models is None or len(models) == 0:
        models = [None]

    all_output_files: dict[str, str] = {}
    models_used: list[str] = []
    total_models = len(models)

    def _update_status(status: str, progress: int = 0, error: str = None, files=None):
        data = {
            "task_id": task_id, "status": status, "progress": progress,
            "original_filename": filename, "models_used": models_used,
            "total_models": total_models,
            "current_model_index": len(models_used),
            "files": files or [],
        }
        if error:
            data["error"] = error
        job_status = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)
        job_status[task_id] = data

    output_dir = f"/storage/outputs/{task_id}"
    input_file_path = os.path.join(output_dir, filename)

    try:
        os.makedirs("/storage/uploads", exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs("/models", exist_ok=True)

        with open(input_file_path, "wb") as f:
            f.write(audio_data)

        _update_status("processing", 10)

        separator = Separator(
            log_level=logging.INFO,
            model_file_dir="/models",
            output_dir=output_dir,
            output_format=output_format,
            output_bitrate=output_bitrate,
            normalization_threshold=normalization_threshold,
            amplification_threshold=amplification_threshold,
            output_single_stem=output_single_stem,
            invert_using_spec=invert_using_spec,
            sample_rate=sample_rate,
            use_soundfile=use_soundfile,
            use_autocast=use_autocast,
            ensemble_algorithm="avg_wave" if total_models > 1 else None,
            mdx_params={"hop_length": mdx_hop_length, "segment_size": mdx_segment_size,
                        "overlap": mdx_overlap, "batch_size": mdx_batch_size,
                        "enable_denoise": mdx_enable_denoise},
            vr_params={"batch_size": vr_batch_size, "window_size": vr_window_size,
                       "aggression": vr_aggression, "enable_tta": vr_enable_tta,
                       "enable_post_process": vr_enable_post_process,
                       "post_process_threshold": vr_post_process_threshold,
                       "high_end_process": vr_high_end_process},
            demucs_params={"segment_size": demucs_segment_size, "shifts": demucs_shifts,
                           "overlap": demucs_overlap, "segments_enabled": demucs_segments_enabled},
            mdxc_params={"segment_size": mdxc_segment_size, "batch_size": mdxc_batch_size,
                         "overlap": mdxc_overlap,
                         "override_model_segment_size": mdxc_override_model_segment_size,
                         "pitch_shift": mdxc_pitch_shift},
        )

        _update_status("processing", 30)

        # Load model(s) — list for ensemble, string for single model
        valid_models = [m for m in models if m]
        if len(valid_models) > 1:
            separator.load_model(model_filename=valid_models)
            models_used = list(valid_models)
        elif valid_models:
            separator.load_model(model_filename=valid_models[0])
            models_used = [valid_models[0]]
        else:
            separator.load_model()
            models_used = ["default"]

        _update_status("processing", 50)

        output_files = separator.separate(input_file_path, custom_output_names=custom_output_names)

        if not output_files:
            msg = f"Model(s) {models_used} produced no output files"
            _update_status("error", 0, error=msg)
            return {"task_id": task_id, "status": "error", "error": msg,
                    "models_used": models_used, "original_filename": filename}

        for fname in (os.path.basename(f) for f in output_files):
            all_output_files[_file_hash(fname)] = fname

        volume.commit()
        models_volume.commit()
        _update_status("completed", 100, files=all_output_files)
        return {"task_id": task_id, "status": "completed", "files": all_output_files,
                "models_used": models_used, "original_filename": filename}

    except Exception as e:
        traceback.print_exc()
        try:
            _update_status("error", 0, error=str(e))
        except Exception:
            pass
        if os.path.exists(input_file_path):
            os.unlink(input_file_path)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)
        return {"task_id": task_id, "status": "error", "error": str(e),
                "models_used": models_used, "original_filename": filename}


@app.function(image=image, timeout=300, volumes={"/storage": volume})
def get_job_status_function(task_id: str) -> dict:
    try:
        job_status = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)
        if task_id in job_status:
            return job_status[task_id]
        return {"task_id": task_id, "status": "not_found", "progress": 0,
                "error": "Job not found"}
    except Exception as e:
        return {"task_id": task_id, "status": "error", "error": f"Failed to read status: {e}"}


@app.function(image=image, timeout=300, volumes={"/storage": volume})
def get_file_by_hash_function(task_id: str, file_hash: str) -> tuple[bytes, str]:
    """Retrieve a separated audio file by its hash identifier."""
    volume.reload()
    job_status = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)

    if task_id not in job_status:
        raise FileNotFoundError(f"Task not found: {task_id}")

    files_dict = job_status[task_id].get("files", {})

    actual_filename = None
    if isinstance(files_dict, dict):
        actual_filename = files_dict.get(file_hash)
    elif isinstance(files_dict, list):
        for fname in files_dict:
            if _file_hash(fname) == file_hash:
                actual_filename = fname
                break

    if not actual_filename:
        raise FileNotFoundError(f"File with hash {file_hash} not found")

    file_path = f"/storage/outputs/{task_id}/{actual_filename}"
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found on disk: {actual_filename}")

    with open(file_path, "rb") as f:
        return f.read(), actual_filename


@app.function(image=image, timeout=60, volumes={"/models": models_volume})
def list_available_models() -> dict:
    from audio_separator.separator import Separator
    os.makedirs("/models", exist_ok=True)
    separator = Separator(info_only=True, model_file_dir="/models")
    return separator.list_supported_model_files()


@app.function(image=image, timeout=60, volumes={"/models": models_volume})
def get_simplified_models(filter_sort_by: str = None) -> dict:
    from audio_separator.separator import Separator
    os.makedirs("/models", exist_ok=True)
    separator = Separator(info_only=True, model_file_dir="/models")
    return separator.get_simplified_model_list(filter_sort_by=filter_sort_by)


# ---------------------------------------------------------------------------
# FastAPI web app
# ---------------------------------------------------------------------------
web_app = FastAPI(
    title="Audio Separator API",
    description="Separate vocals from instrumental tracks using AI",
    version=AUDIO_SEPARATOR_VERSION,
)
web_app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@web_app.post("/separate")
async def separate_audio(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    models: Optional[str] = Form(None),
    output_format: str = Form("flac"),
    output_bitrate: Optional[str] = Form(None),
    normalization_threshold: float = Form(0.9),
    amplification_threshold: float = Form(0.0),
    output_single_stem: Optional[str] = Form(None),
    invert_using_spec: bool = Form(False),
    sample_rate: int = Form(44100),
    use_soundfile: bool = Form(False),
    use_autocast: bool = Form(False),
    custom_output_names: Optional[str] = Form(None),
    mdx_segment_size: int = Form(256),
    mdx_overlap: float = Form(0.25),
    mdx_batch_size: int = Form(1),
    mdx_hop_length: int = Form(1024),
    mdx_enable_denoise: bool = Form(False),
    vr_batch_size: int = Form(1),
    vr_window_size: int = Form(512),
    vr_aggression: int = Form(5),
    vr_enable_tta: bool = Form(False),
    vr_high_end_process: bool = Form(False),
    vr_enable_post_process: bool = Form(False),
    vr_post_process_threshold: float = Form(0.2),
    demucs_segment_size: str = Form("Default"),
    demucs_shifts: int = Form(2),
    demucs_overlap: float = Form(0.25),
    demucs_segments_enabled: bool = Form(True),
    mdxc_segment_size: int = Form(256),
    mdxc_override_model_segment_size: bool = Form(False),
    mdxc_overlap: int = Form(8),
    mdxc_batch_size: int = Form(1),
    mdxc_pitch_shift: int = Form(0),
    _auth: None = Depends(verify_api_key),
) -> dict:
    """Upload an audio file and start asynchronous stem separation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    try:
        models_list = None
        if models:
            models_list = json.loads(models)
            if not isinstance(models_list, list):
                raise HTTPException(status_code=400, detail="models must be a JSON list")
        elif model:
            models_list = [model]

        custom_names = None
        if custom_output_names:
            custom_names = json.loads(custom_output_names)
            if not isinstance(custom_names, dict):
                raise HTTPException(status_code=400, detail="custom_output_names must be a JSON object")

        audio_data = await file.read()
        task_id = str(uuid.uuid4())

        job_status = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)
        job_status[task_id] = {
            "task_id": task_id, "status": "submitted", "progress": 0,
            "original_filename": file.filename,
            "models_used": models_list or ["default"],
            "total_models": len(models_list) if models_list else 1,
            "current_model_index": 0, "files": [],
        }

        separate_audio_function.spawn(
            audio_data, file.filename, models_list, task_id,
            output_format, output_bitrate, normalization_threshold,
            amplification_threshold, output_single_stem, invert_using_spec,
            sample_rate, use_soundfile, use_autocast, custom_names,
            mdx_segment_size, mdx_overlap, mdx_batch_size, mdx_hop_length, mdx_enable_denoise,
            vr_batch_size, vr_window_size, vr_aggression, vr_enable_tta,
            vr_high_end_process, vr_enable_post_process, vr_post_process_threshold,
            demucs_segment_size, demucs_shifts, demucs_overlap, demucs_segments_enabled,
            mdxc_segment_size, mdxc_override_model_segment_size, mdxc_overlap,
            mdxc_batch_size, mdxc_pitch_shift,
        )

        return {
            "task_id": task_id, "status": "submitted",
            "message": "Use /status/{task_id} to check progress.",
            "models_used": models_list or ["default"],
            "original_filename": file.filename,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Separation failed: {e}") from e


@web_app.get("/status/{task_id}")
async def get_job_status(task_id: str, _auth: None = Depends(verify_api_key)) -> dict:
    return get_job_status_function.remote(task_id)


@web_app.get("/download/{task_id}/{file_hash}")
async def download_file(task_id: str, file_hash: str, _auth: None = Depends(verify_api_key)) -> Response:
    from starlette.responses import FileResponse

    try:
        volume.reload()
        job_status_dict = modal.Dict.from_name("audio-separator-job-status", create_if_missing=True)

        if task_id not in job_status_dict:
            raise FileNotFoundError(f"Task not found: {task_id}")

        files_dict = job_status_dict[task_id].get("files", {})
        actual_filename = None

        if isinstance(files_dict, dict) and file_hash in files_dict:
            actual_filename = files_dict[file_hash]
        elif isinstance(files_dict, list):
            for fname in files_dict:
                if _file_hash(fname) == file_hash:
                    actual_filename = fname
                    break

        if not actual_filename:
            raise FileNotFoundError(f"File with hash {file_hash} not found")

        file_path = f"/storage/outputs/{task_id}/{actual_filename}"
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found on disk: {actual_filename}")

        content_type = filetype.guess_mime(file_path) or "application/octet-stream"
        ascii_name = "".join(c if ord(c) < 128 else "_" for c in actual_filename)
        encoded_name = quote(actual_filename, safe="")
        disposition = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded_name}'

        return FileResponse(path=file_path, media_type=content_type,
                            headers={"Content-Disposition": disposition})
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {e}") from e


@web_app.get("/models-json")
async def get_available_models(_auth: None = Depends(verify_api_key)) -> PrettyJSONResponse:
    return PrettyJSONResponse(content=list_available_models.remote())


@web_app.get("/models")
async def get_simplified_models_list(
    filter_sort_by: str = None,
    _auth: None = Depends(verify_api_key),
) -> PlainTextResponse:
    models_data = get_simplified_models.remote(filter_sort_by=filter_sort_by)
    if not models_data:
        return PlainTextResponse("No models found")

    fw = max(len("Model Filename"), max(len(k) for k in models_data))
    aw = max(len("Arch"), max(len(v["Type"]) for v in models_data.values()))
    sw = max(len("Output Stems (SDR)"), max(len(", ".join(v["Stems"])) for v in models_data.values()))
    nw = max(len("Friendly Name"), max(len(v["Name"]) for v in models_data.values()))
    total = fw + aw + sw + nw + 15

    lines = [
        "-" * total,
        f"{'Model Filename':<{fw}}  {'Arch':<{aw}}  {'Output Stems (SDR)':<{sw}}  Friendly Name",
        "-" * total,
    ]
    for fname, info in models_data.items():
        stems = ", ".join(info["Stems"])
        lines.append(f"{fname:<{fw}}  {info['Type']:<{aw}}  {stems:<{sw}}  {info['Name']}")

    return PlainTextResponse("\n".join(lines))


@web_app.get("/health")
async def health_check() -> dict:
    return {"status": "healthy", "service": "audio-separator-api", "version": AUDIO_SEPARATOR_VERSION}


@web_app.get("/")
async def root() -> dict:
    return {
        "message": "Audio Separator API",
        "version": AUDIO_SEPARATOR_VERSION,
        "endpoints": {
            "POST /separate": "Upload and separate audio file",
            "GET /status/{task_id}": "Get job status and progress",
            "GET /download/{task_id}/{file_hash}": "Download separated file",
            "GET /models-json": "List models (JSON)",
            "GET /models": "List models (plain text)",
            "GET /health": "Health check",
        },
    }


@app.function(
    image=image, timeout=600, scaledown_window=30,
    volumes={"/storage": volume}, secrets=[api_key_secret],
    max_containers=2,
)
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def api() -> FastAPI:
    return web_app
