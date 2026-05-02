from __future__ import annotations

from types import SimpleNamespace

import pytest
import numpy as np
from pathlib import Path

import jobs
from analysis import calculate_stretch_ratio


def test_validate_job_payload_requires_track_version_id() -> None:
    with pytest.raises(ValueError):
        jobs.validate_job_payload('TEMPO_ANALYSIS', {})


def test_validate_job_payload_requires_demo_version_for_retempo() -> None:
    with pytest.raises(ValueError):
        jobs.validate_job_payload(
            'PROJECT_RETEMPO_FROM_TRACK',
            {'trackVersionId': 'track_1'},
        )


def test_calculate_stretch_ratio() -> None:
    assert calculate_stretch_ratio(120, 90) == pytest.approx(0.75)
    assert calculate_stretch_ratio(90, 120) == pytest.approx(1.3333333)


def test_time_stretch_creates_derived_track_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source_track_version = {
        'id': 'track_version_1',
        'storageKey': '/uploads/demos/demo_1/source.wav',
        'startOffsetMs': 0,
        'durationMs': 1000,
        'sampleRate': 48000,
        'channels': 2,
        'mimeType': 'audio/wav',
        'sizeBytes': 1234,
        'checksum': 'abc',
        'isDerived': False,
        'operationType': 'ORIGINAL',
        'parentTrackVersionId': None,
        'trackId': 'track_1',
        'demoVersionId': 'demo_version_1',
        'demoId': 'demo_1',
        'tempoBpm': 120,
        'timeSignatureNum': 4,
        'timeSignatureDen': 4,
        'musicalKey': None,
        'tempoSource': 'MANUAL',
        'keySource': 'MANUAL',
        'groupId': 'group_1',
        'projectId': 'project_1',
    }
    demo_version = {
        'id': 'demo_version_1',
        'demoId': 'demo_1',
        'tempoBpm': 90,
        'timeSignatureNum': 4,
        'timeSignatureDen': 4,
        'musicalKey': None,
        'tempoSource': 'MANUAL',
        'keySource': 'MANUAL',
    }
    conn = SimpleNamespace()
    created = {}

    monkeypatch.setattr(jobs, 'get_track_version', lambda _conn, _id: source_track_version)
    monkeypatch.setattr(jobs, 'get_demo_version', lambda _conn, _id: demo_version)
    monkeypatch.setattr(jobs, 'load_audio_for_processing', lambda _key: (np.zeros((4, 2), dtype='float32'), 48000))
    monkeypatch.setattr(jobs, 'analyze_tempo', lambda audio, sr: SimpleNamespace(tempo_bpm=120.0, beat_times=[0.0], confidence=0.9))
    monkeypatch.setattr(jobs, 'calculate_stretch_ratio', lambda source, target: 0.75)
    monkeypatch.setattr(jobs, 'time_stretch_audio', lambda audio, sr, ratio: np.zeros((3, 2), dtype='float32'))
    def fake_write_derived_audio(storage_key, audio, sample_rate):
        derived_path = tmp_path / 'derived.wav'
        derived_path.write_bytes(b'fake-audio')
        return derived_path

    monkeypatch.setattr(jobs, 'write_derived_audio', fake_write_derived_audio)

    def fake_create_derived_track_version(**kwargs):
        created['kwargs'] = kwargs
        return 'derived_track_version_1'

    monkeypatch.setattr(jobs, 'create_derived_track_version', fake_create_derived_track_version)

    result = jobs.handle_time_stretch_to_project(
        conn,
        {'id': 'job_1', 'type': 'TIME_STRETCH_TO_PROJECT'},
        {'trackVersionId': 'track_version_1', 'demoVersionId': 'demo_version_1'},
    )

    assert result['derivedTrackVersionId'] == 'derived_track_version_1'
    assert source_track_version['storageKey'] == '/uploads/demos/demo_1/source.wav'
    assert created['kwargs']['source_track_version']['id'] == 'track_version_1'
    assert created['kwargs']['processing_job_id'] == 'job_1'
