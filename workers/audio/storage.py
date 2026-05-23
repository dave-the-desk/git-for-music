from __future__ import annotations

import json
import os
import re
from pathlib import Path

from analysis import load_audio_multichannel, load_audio_mono, write_audio


def _default_public_dir() -> Path:
    current = Path(__file__).resolve()
    for base in (current.parent, current.parent.parent, current.parent.parent.parent):
        candidate = base / 'apps/web/public'
        if candidate.exists():
            return candidate
    return Path('/data/public')


PUBLIC_DIR = Path(os.environ.get('WEB_PUBLIC_DIR', _default_public_dir()))


def normalize_storage_key(storage_key: str) -> str:
    if storage_key.startswith('/uploads/'):
        return storage_key.removeprefix('/uploads/')
    return storage_key.lstrip('/')


def sanitize_storage_name(value: str) -> str:
    sanitized = re.sub(r'[^a-zA-Z0-9._-]', '-', value)
    sanitized = re.sub(r'-+', '-', sanitized)
    return sanitized.strip('-.') or 'asset'


def resolve_storage_path(storage_key: str) -> Path:
    relative = normalize_storage_key(storage_key)
    return PUBLIC_DIR / relative


def _storage_root(track_version: dict[str, str]) -> str:
    return (
        f"projects/{sanitize_storage_name(track_version['projectId'])}"
        f"/demos/{sanitize_storage_name(track_version['demoId'])}"
        f"/tracks/{sanitize_storage_name(track_version['trackId'])}"
        f"/versions/{sanitize_storage_name(track_version['id'])}"
    )


def _asset_name(asset_id: str, extension: str = '.wav') -> str:
    cleaned_extension = extension if extension.startswith('.') else f'.{extension}'
    return f"{sanitize_storage_name(asset_id)}{cleaned_extension}"


def load_audio_for_analysis(storage_key: str):
    return load_audio_mono(resolve_storage_path(storage_key))


def load_audio_for_processing(storage_key: str):
    return load_audio_multichannel(resolve_storage_path(storage_key))


def write_derived_audio(storage_key: str, audio, sample_rate: int) -> Path:
    path = resolve_storage_path(storage_key)
    write_audio(path, audio, sample_rate)
    return path


def build_json_artifact_bytes(payload: dict) -> bytes:
    return json.dumps(payload, indent=2, sort_keys=True).encode('utf-8')


def write_json_artifact(storage_key: str, payload: dict) -> Path:
    path = resolve_storage_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(build_json_artifact_bytes(payload))
    return path


def make_original_storage_key(track_version: dict, asset_id: str) -> str:
    return f"{_storage_root(track_version)}/originals/{_asset_name(asset_id)}"


def make_derived_storage_key(track_version: dict, asset_id: str) -> str:
    return f"{_storage_root(track_version)}/derived/{_asset_name(asset_id)}"


def make_peaks_storage_key(track_version: dict, asset_id: str) -> str:
    return f"{_storage_root(track_version)}/peaks/{sanitize_storage_name(asset_id)}.json"


def make_analysis_storage_key(project_id: str, demo_id: str, job_id: str) -> str:
    return (
        f"projects/{sanitize_storage_name(project_id)}/demos/{sanitize_storage_name(demo_id)}"
        f"/analysis/{sanitize_storage_name(job_id)}.json"
    )


def make_transcript_storage_key(track_version: dict, asset_id: str) -> str:
    return f"{_storage_root(track_version)}/transcripts/{sanitize_storage_name(asset_id)}.json"


def make_stem_storage_key(track_version: dict, asset_id: str, file_name: str | None = None) -> str:
    extension = '.wav' if not file_name else Path(file_name).suffix or '.wav'
    return f"{_storage_root(track_version)}/stems/{_asset_name(asset_id, extension)}"
