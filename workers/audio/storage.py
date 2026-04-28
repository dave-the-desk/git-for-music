from __future__ import annotations

import os
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


def resolve_storage_path(storage_key: str) -> Path:
    relative = storage_key.lstrip('/')
    return PUBLIC_DIR / relative


def load_audio_for_analysis(storage_key: str):
    return load_audio_mono(resolve_storage_path(storage_key))


def load_audio_for_processing(storage_key: str):
    return load_audio_multichannel(resolve_storage_path(storage_key))


def write_derived_audio(storage_key: str, audio, sample_rate: int) -> Path:
    path = resolve_storage_path(storage_key)
    write_audio(path, audio, sample_rate)
    return path


def make_derived_storage_key(demo_id: str, track_version_id: str, suffix: str = 'stretch') -> str:
    return f'/uploads/demos/{demo_id}/derived/{track_version_id}-{suffix}.wav'
