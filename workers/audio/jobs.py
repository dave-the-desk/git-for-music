from __future__ import annotations

import hashlib
import json
import os
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from analysis import (
    analyze_key,
    analyze_loudness,
    analyze_tempo,
    compute_waveform_peaks,
    calculate_stretch_ratio,
    time_stretch_audio,
)
from db import (
    create_derived_track_version,
    get_audio_asset_by_track_version,
    get_demo_version,
    get_track_version,
    upsert_audio_asset_metadata,
    update_demo_version_timing,
    update_job,
)
from storage import (
    make_analysis_storage_key,
    load_audio_for_analysis,
    load_audio_for_processing,
    make_derived_storage_key,
    make_peaks_storage_key,
    build_json_artifact_bytes,
    write_json_artifact,
    write_derived_audio,
)

ALLOWED_JOB_TYPES = {
    'GENERATE_WAVEFORM_PEAKS',
    'ANALYZE_TEMPO',
    'ANALYZE_KEY',
    'ANALYZE_LOUDNESS',
    'CREATE_DERIVED_AUDIO',
    'TEMPO_ANALYSIS',
    'KEY_ANALYSIS',
    'TIME_STRETCH_TO_PROJECT',
    'PROJECT_RETEMPO_FROM_TRACK',
}

LOW_CONFIDENCE_THRESHOLD = 0.35
WEB_APP_URL = os.environ.get('DAW_WEB_APP_URL', 'http://127.0.0.1:3000').rstrip('/')
WORKER_CALLBACK_SECRET = os.environ.get('DAW_WORKER_CALLBACK_SECRET', '').strip()


def normalize_payload(raw_payload: Any) -> dict[str, Any]:
    if raw_payload is None:
        return {}
    if isinstance(raw_payload, dict):
        return raw_payload
    raise ValueError('Job payload must be an object')


def validate_job_payload(job_type: str, payload: Any) -> dict[str, Any]:
    if job_type not in ALLOWED_JOB_TYPES:
        raise ValueError(f'Unsupported job type: {job_type}')

    data = normalize_payload(payload)

    track_version_id = data.get('trackVersionId')
    if not isinstance(track_version_id, str) or not track_version_id.strip():
        raise ValueError('trackVersionId is required')
    data['trackVersionId'] = track_version_id

    if job_type in {'TIME_STRETCH_TO_PROJECT', 'PROJECT_RETEMPO_FROM_TRACK'}:
        demo_version_id = data.get('demoVersionId')
        if not isinstance(demo_version_id, str) or not demo_version_id.strip():
            raise ValueError('demoVersionId is required')
        data['demoVersionId'] = demo_version_id

    if 'sourceTempoBpm' in data and data['sourceTempoBpm'] is not None:
        source_tempo = float(data['sourceTempoBpm'])
        if source_tempo <= 0:
            raise ValueError('sourceTempoBpm must be positive')
        data['sourceTempoBpm'] = source_tempo

    if 'targetTempoBpm' in data and data['targetTempoBpm'] is not None:
        target_tempo = float(data['targetTempoBpm'])
        if target_tempo <= 0:
            raise ValueError('targetTempoBpm must be positive')
        data['targetTempoBpm'] = target_tempo

    data['updateDemoTiming'] = bool(data.get('updateDemoTiming'))
    return data


def _canonical_job_type(job_type: str) -> str:
    aliases = {
        'TEMPO_ANALYSIS': 'ANALYZE_TEMPO',
        'KEY_ANALYSIS': 'ANALYZE_KEY',
        'TIME_STRETCH_TO_PROJECT': 'CREATE_DERIVED_AUDIO',
    }
    return aliases.get(job_type, job_type)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _write_canonical_peaks(conn, track_version: dict[str, Any], audio: Any, sample_rate: int) -> dict[str, Any]:
    peaks = compute_waveform_peaks(audio, sample_rate)
    payload = {
        'trackVersionId': track_version['id'],
        'sampleRate': sample_rate,
        'windowMs': 10,
        'peaks': peaks,
    }
    peaks_key = make_peaks_storage_key(track_version, track_version['id'])
    peaks_path = write_json_artifact(peaks_key, payload)
    peaks_bytes = build_json_artifact_bytes(payload)

    original_asset = get_audio_asset_by_track_version(conn, track_version['id'], 'ORIGINAL')
    asset_id = f"{track_version['id']}:peaks"
    checksum = hashlib.sha256(peaks_bytes).hexdigest()
    upsert_audio_asset_metadata(
        conn,
        asset_id=asset_id,
        project_id=track_version['projectId'],
        demo_id=track_version['demoId'],
        track_id=track_version['trackId'],
        track_version_id=track_version['id'],
        asset_kind='PEAKS',
        storage_key=f'/{peaks_key}',
        mime_type='application/json',
        sample_rate=sample_rate,
        bit_depth=0,
        channel_count=int(track_version['channels'] or 1),
        duration_ms=int(track_version['durationMs'] or 0),
        size_bytes=peaks_path.stat().st_size if peaks_path.exists() else len(peaks_bytes),
        checksum=checksum,
        parent_asset_id=original_asset['id'] if original_asset else None,
    )

    return {
        'assetId': asset_id,
        'assetKind': 'PEAKS',
        'storageKey': f'/{peaks_key}',
        'trackVersionId': track_version['id'],
        'sampleRate': sample_rate,
        'windowMs': 10,
        'peaks': peaks,
    }


def _write_analysis_artifact(
    track_version: dict[str, Any],
    job_id: str,
    payload: dict[str, Any],
) -> None:
    analysis_key = make_analysis_storage_key(track_version['projectId'], track_version['demoId'], job_id)
    write_json_artifact(analysis_key, payload)


def _publish_job_status(
    job_id: str,
    status: str,
    *,
    message: str | None = None,
) -> None:
    if not WEB_APP_URL or not WORKER_CALLBACK_SECRET:
        return

    payload = {
        'status': status,
        'message': message,
    }
    request = urllib_request.Request(
        f'{WEB_APP_URL}/api/internal/daw/jobs/{job_id}/asset-status',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'x-daw-worker-secret': WORKER_CALLBACK_SECRET,
        },
        method='POST',
    )

    try:
        with urllib_request.urlopen(request, timeout=5):
            pass
    except urllib_error.URLError:
        return


def process_job(conn, job: dict[str, Any]) -> None:
    job_id = job['id']
    job_type = job['type']
    canonical_type = _canonical_job_type(job_type)

    try:
        payload = validate_job_payload(job_type, job.get('payload'))
        update_job(conn, job_id, status='PROCESSING', progress=0, error=None)
        _publish_job_status(job_id, 'processing', message='Processing started')

        if canonical_type == 'GENERATE_WAVEFORM_PEAKS':
            result = handle_generate_waveform_peaks(conn, job, payload)
        elif canonical_type == 'ANALYZE_TEMPO':
            result = handle_tempo_analysis(conn, job, payload)
        elif canonical_type == 'ANALYZE_KEY':
            result = handle_key_analysis(conn, job, payload)
        elif canonical_type == 'ANALYZE_LOUDNESS':
            result = handle_loudness_analysis(conn, job, payload)
        elif canonical_type == 'CREATE_DERIVED_AUDIO':
            result = handle_create_derived_audio(conn, job, payload)
        elif job_type == 'PROJECT_RETEMPO_FROM_TRACK':
            result = handle_project_retempo_from_track(conn, job, payload)
        else:
            raise ValueError(f'Unsupported job type: {job_type}')

        update_job(conn, job_id, status='COMPLETE', progress=100, result=result)
        _publish_job_status(job_id, 'complete', message='Processing complete')
    except Exception as exc:
        update_job(conn, job_id, status='FAILED', progress=100, error=str(exc))
        _publish_job_status(job_id, 'failed', message=str(exc))
        raise


def handle_tempo_analysis(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    _write_canonical_peaks(conn, track_version, audio, sample_rate)
    analysis = analyze_tempo(audio, sample_rate)
    result = {
        'tempoBpm': analysis.tempo_bpm,
        'beatTimes': analysis.beat_times,
        'confidence': analysis.confidence,
        'updatedDemoVersionId': payload.get('demoVersionId') if payload.get('updateDemoTiming') else None,
    }

    if payload.get('updateDemoTiming') and payload.get('demoVersionId'):
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            tempo_bpm=analysis.tempo_bpm,
            tempo_source='ANALYZED',
        )

    _write_analysis_artifact(track_version, job['id'], result)
    return result


def handle_key_analysis(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    _write_canonical_peaks(conn, track_version, audio, sample_rate)
    analysis = analyze_key(audio, sample_rate)
    result = {
        'musicalKey': analysis.musical_key,
        'scale': analysis.scale,
        'confidence': analysis.confidence,
        'updatedDemoVersionId': payload.get('demoVersionId') if payload.get('updateDemoTiming') else None,
    }

    if payload.get('updateDemoTiming') and payload.get('demoVersionId'):
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            musical_key=analysis.musical_key,
            key_source='ANALYZED',
        )

    _write_analysis_artifact(track_version, job['id'], result)
    return result


def handle_generate_waveform_peaks(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    result = _write_canonical_peaks(conn, track_version, audio, sample_rate)
    _write_analysis_artifact(track_version, job['id'], result)
    return result


def handle_loudness_analysis(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    _write_canonical_peaks(conn, track_version, audio, sample_rate)
    analysis = analyze_loudness(audio, sample_rate)
    result = {
        'integratedLufs': analysis.integrated_lufs,
        'peakDbfs': analysis.peak_dbfs,
        'rmsDbfs': analysis.rms_dbfs,
    }
    _write_analysis_artifact(track_version, job['id'], result)
    return result


def handle_create_derived_audio(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    demo_version = get_demo_version(conn, payload['demoVersionId'])
    if not demo_version:
        raise ValueError('Demo version not found')
    target_tempo = _safe_float(payload.get('targetTempoBpm')) or _safe_float(demo_version['tempoBpm'])
    if not target_tempo:
        raise ValueError('Project tempo is not set')

    audio, sample_rate = load_audio_for_processing(track_version['storageKey'])
    _write_canonical_peaks(conn, track_version, audio, sample_rate)
    source_tempo = _safe_float(payload.get('sourceTempoBpm'))
    analysis = None
    if not source_tempo or source_tempo <= 0:
        analysis = analyze_tempo(audio.mean(axis=1) if audio.ndim == 2 else audio, sample_rate)
        source_tempo = analysis.tempo_bpm
    if source_tempo <= 0:
        raise ValueError('Could not analyze source tempo')

    ratio = calculate_stretch_ratio(source_tempo, target_tempo)
    stretched = time_stretch_audio(audio, sample_rate, ratio)

    derived_storage_key = make_derived_storage_key(track_version, job['id'])
    derived_path = write_derived_audio(derived_storage_key, stretched, sample_rate)
    derived_size = derived_path.stat().st_size if derived_path.exists() else None
    derived_bytes = derived_path.read_bytes() if derived_path.exists() else b''
    derived_checksum = hashlib.sha256(derived_bytes).hexdigest() if derived_bytes else ''

    derived_track_version_id = create_derived_track_version(
        conn,
        source_track_version=track_version,
        demo_version_id=payload['demoVersionId'],
        storage_key=f'/{derived_storage_key}',
        processing_job_id=job['id'],
        duration_ms=int(round((stretched.shape[0] / sample_rate) * 1000)),
        sample_rate=sample_rate,
        channels=int(stretched.shape[1]) if stretched.ndim == 2 else 1,
        mime_type='audio/wav',
        size_bytes=derived_size,
        checksum=derived_checksum or None,
    )

    original_asset = get_audio_asset_by_track_version(conn, track_version['id'], 'ORIGINAL')
    derived_asset_id = f"{job['id']}:derived"
    upsert_audio_asset_metadata(
        conn,
        asset_id=derived_asset_id,
        project_id=track_version['projectId'],
        demo_id=track_version['demoId'],
        track_id=track_version['trackId'],
        track_version_id=derived_track_version_id,
        asset_kind='DERIVED',
        storage_key=f'/{derived_storage_key}',
        mime_type='audio/wav',
        sample_rate=sample_rate,
        bit_depth=int(track_version['bitDepth'] or 16),
        channel_count=int(stretched.shape[1]) if stretched.ndim == 2 else 1,
        duration_ms=int(round((stretched.shape[0] / sample_rate) * 1000)),
        size_bytes=derived_size or 0,
        checksum=derived_checksum,
        parent_asset_id=original_asset['id'] if original_asset else None,
    )

    result = {
        'sourceTempoBpm': source_tempo,
        'targetTempoBpm': target_tempo,
        'stretchRatio': ratio,
        'derivedTrackVersionId': derived_track_version_id,
        'derivedAssetId': derived_asset_id,
        'derivedStorageKey': f'/{derived_storage_key}',
    }
    _write_analysis_artifact(track_version, job['id'], result)
    return result


def handle_project_retempo_from_track(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    _write_canonical_peaks(conn, track_version, audio, sample_rate)
    analysis = analyze_tempo(audio, sample_rate)
    applied = analysis.confidence >= LOW_CONFIDENCE_THRESHOLD and analysis.tempo_bpm > 0

    if applied:
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            tempo_bpm=analysis.tempo_bpm,
            tempo_source='ANALYZED',
        )

    result = {
        'tempoBpm': analysis.tempo_bpm,
        'beatTimes': analysis.beat_times,
        'confidence': analysis.confidence,
        'appliedToDemoVersion': applied,
        'demoVersionId': payload['demoVersionId'],
        'trackVersionId': payload['trackVersionId'],
    }
    _write_analysis_artifact(track_version, job['id'], result)
    return result
