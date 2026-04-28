from __future__ import annotations

from typing import Any

from analysis import (
    analyze_key,
    analyze_tempo,
    calculate_stretch_ratio,
    time_stretch_audio,
)
from db import (
    create_derived_track_version,
    get_demo_version,
    get_track_version,
    update_demo_version_timing,
    update_job,
)
from storage import (
    load_audio_for_analysis,
    load_audio_for_processing,
    make_derived_storage_key,
    write_derived_audio,
)

ALLOWED_JOB_TYPES = {
    'TEMPO_ANALYSIS',
    'KEY_ANALYSIS',
    'TIME_STRETCH_TO_PROJECT',
    'PROJECT_RETEMPO_FROM_TRACK',
}

LOW_CONFIDENCE_THRESHOLD = 0.35


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


def process_job(conn, job: dict[str, Any]) -> None:
    job_id = job['id']
    job_type = job['type']

    try:
        payload = validate_job_payload(job_type, job.get('payload'))
        update_job(conn, job_id, status='PROCESSING', progress=0, error=None)

        if job_type == 'TEMPO_ANALYSIS':
            result = handle_tempo_analysis(conn, job, payload)
        elif job_type == 'KEY_ANALYSIS':
            result = handle_key_analysis(conn, job, payload)
        elif job_type == 'TIME_STRETCH_TO_PROJECT':
            result = handle_time_stretch_to_project(conn, job, payload)
        elif job_type == 'PROJECT_RETEMPO_FROM_TRACK':
            result = handle_project_retempo_from_track(conn, job, payload)
        else:
            raise ValueError(f'Unsupported job type: {job_type}')

        update_job(conn, job_id, status='COMPLETE', progress=100, result=result)
    except Exception as exc:
        update_job(conn, job_id, status='FAILED', progress=100, error=str(exc))
        raise


def handle_tempo_analysis(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    analysis = analyze_tempo(audio, sample_rate)

    if payload.get('updateDemoTiming') and payload.get('demoVersionId'):
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            tempo_bpm=analysis.tempo_bpm,
            tempo_source='ANALYZED',
        )

    return {
        'tempoBpm': analysis.tempo_bpm,
        'beatTimes': analysis.beat_times,
        'confidence': analysis.confidence,
        'updatedDemoVersionId': payload.get('demoVersionId') if payload.get('updateDemoTiming') else None,
    }


def handle_key_analysis(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    analysis = analyze_key(audio, sample_rate)

    if payload.get('updateDemoTiming') and payload.get('demoVersionId'):
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            musical_key=analysis.musical_key,
            key_source='ANALYZED',
        )

    return {
        'musicalKey': analysis.musical_key,
        'scale': analysis.scale,
        'confidence': analysis.confidence,
        'updatedDemoVersionId': payload.get('demoVersionId') if payload.get('updateDemoTiming') else None,
    }


def handle_time_stretch_to_project(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
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
    source_tempo = _safe_float(payload.get('sourceTempoBpm'))
    analysis = None
    if not source_tempo or source_tempo <= 0:
        analysis = analyze_tempo(audio.mean(axis=1) if audio.ndim == 2 else audio, sample_rate)
        source_tempo = analysis.tempo_bpm
    if source_tempo <= 0:
        raise ValueError('Could not analyze source tempo')

    ratio = calculate_stretch_ratio(source_tempo, target_tempo)
    stretched = time_stretch_audio(audio, sample_rate, ratio)

    derived_storage_key = make_derived_storage_key(demo_version['demoId'], track_version['id'], 'stretch')
    derived_path = write_derived_audio(derived_storage_key, stretched, sample_rate)
    derived_size = derived_path.stat().st_size if derived_path.exists() else None

    derived_track_version_id = create_derived_track_version(
        conn,
        source_track_version=track_version,
        demo_version_id=payload['demoVersionId'],
        storage_key=derived_storage_key,
        processing_job_id=job['id'],
        duration_ms=int(round((stretched.shape[0] / sample_rate) * 1000)),
        sample_rate=sample_rate,
        channels=int(stretched.shape[1]) if stretched.ndim == 2 else 1,
        mime_type='audio/wav',
        size_bytes=derived_size,
        checksum=None,
    )

    return {
        'sourceTempoBpm': source_tempo,
        'targetTempoBpm': target_tempo,
        'stretchRatio': ratio,
        'derivedTrackVersionId': derived_track_version_id,
        'derivedStorageKey': derived_storage_key,
    }


def handle_project_retempo_from_track(conn, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    track_version = get_track_version(conn, payload['trackVersionId'])
    if not track_version:
        raise ValueError('Track version not found')

    audio, sample_rate = load_audio_for_analysis(track_version['storageKey'])
    analysis = analyze_tempo(audio, sample_rate)
    applied = analysis.confidence >= LOW_CONFIDENCE_THRESHOLD and analysis.tempo_bpm > 0

    if applied:
        update_demo_version_timing(
            conn,
            payload['demoVersionId'],
            tempo_bpm=analysis.tempo_bpm,
            tempo_source='ANALYZED',
        )

    return {
        'tempoBpm': analysis.tempo_bpm,
        'beatTimes': analysis.beat_times,
        'confidence': analysis.confidence,
        'appliedToDemoVersion': applied,
        'demoVersionId': payload['demoVersionId'],
        'trackVersionId': payload['trackVersionId'],
    }
