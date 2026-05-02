from __future__ import annotations

import os
import re
from pathlib import Path
from pathlib import PurePosixPath

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
    return sanitized.strip('-.') or 'audio.wav'


def resolve_storage_path(storage_key: str) -> Path:
    relative = normalize_storage_key(storage_key)
    return PUBLIC_DIR / relative


def load_audio_for_analysis(storage_key: str):
    return load_audio_mono(resolve_storage_path(storage_key))


def load_audio_for_processing(storage_key: str):
    return load_audio_multichannel(resolve_storage_path(storage_key))


def write_derived_audio(storage_key: str, audio, sample_rate: int) -> Path:
    path = resolve_storage_path(storage_key)
    write_audio(path, audio, sample_rate)
    return path


def make_derived_storage_key(track_version: dict, job_id: str, file_name: str | None = None) -> str:
    storage_key = track_version['storageKey']
    resolved_name = sanitize_storage_name(
        file_name or PurePosixPath(normalize_storage_key(storage_key)).name or 'audio.wav'
    )
    object_key = (
        f"groups/{track_version['groupId']}/projects/{track_version['projectId']}/demos/{track_version['demoId']}"
        f"/tracks/{track_version['trackId']}/versions/{track_version['id']}/derived/{job_id}/{resolved_name}"
    )
    return f'/uploads/{object_key}'
