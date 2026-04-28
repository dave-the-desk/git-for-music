from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

try:
    import pyrubberband as pyrb
except Exception:  # pragma: no cover - optional runtime dependency
    pyrb = None

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], dtype=float)
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], dtype=float)


@dataclass(frozen=True)
class TempoAnalysisResult:
    tempo_bpm: float
    beat_times: list[float]
    confidence: float


@dataclass(frozen=True)
class KeyAnalysisResult:
    musical_key: str
    scale: str
    confidence: float


def calculate_stretch_ratio(source_tempo_bpm: float, target_tempo_bpm: float) -> float:
    if source_tempo_bpm <= 0 or target_tempo_bpm <= 0:
        raise ValueError('Tempo values must be positive')
    return target_tempo_bpm / source_tempo_bpm


def load_audio_mono(path: Path) -> tuple[np.ndarray, int]:
    audio, sample_rate = librosa.load(str(path), sr=None, mono=True)
    return audio.astype(np.float32, copy=False), int(sample_rate)


def load_audio_multichannel(path: Path) -> tuple[np.ndarray, int]:
    audio, sample_rate = librosa.load(str(path), sr=None, mono=False)
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[:, None]
    elif audio.ndim == 2:
        audio = audio.T
    return audio, int(sample_rate)


def write_audio(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, sample_rate, subtype='PCM_16')


def analyze_tempo(audio: np.ndarray, sample_rate: int) -> TempoAnalysisResult:
    onset_envelope = librosa.onset.onset_strength(y=audio, sr=sample_rate)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=sample_rate,
        trim=False,
        units='frames',
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate).astype(float).tolist()

    tempogram = librosa.feature.tempogram(onset_envelope=onset_envelope, sr=sample_rate)
    if tempogram.size:
        spectrum = np.mean(tempogram, axis=1)
        sorted_values = np.sort(spectrum)
        peak = float(sorted_values[-1]) if sorted_values.size else 0.0
        second = float(sorted_values[-2]) if sorted_values.size > 1 else 0.0
        confidence = peak / (peak + second + 1e-9) if peak > 0 else 0.0
    else:
        confidence = 0.0

    tempo_value = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    return TempoAnalysisResult(tempo_bpm=tempo_value, beat_times=beat_times, confidence=float(confidence))


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def analyze_key(audio: np.ndarray, sample_rate: int) -> KeyAnalysisResult:
    chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate)
    profile = np.mean(chroma, axis=1)
    if not np.any(profile):
        raise ValueError('Unable to detect key from silent audio')

    normalized_profile = profile / max(float(np.linalg.norm(profile)), 1e-9)

    scored_keys: list[tuple[float, str, str]] = []
    for scale_name, template in (('major', MAJOR_PROFILE), ('minor', MINOR_PROFILE)):
        template = template / max(float(np.linalg.norm(template)), 1e-9)
        for offset, note in enumerate(NOTE_NAMES):
            key_profile = np.roll(template, offset)
            score = _cosine_similarity(normalized_profile, key_profile)
            scored_keys.append((score, note, scale_name))

    scored_keys.sort(key=lambda item: item[0], reverse=True)
    best_score, best_note, best_scale = scored_keys[0]
    second_score = scored_keys[1][0] if len(scored_keys) > 1 else 0.0
    confidence = max(0.0, best_score - second_score)
    return KeyAnalysisResult(
        musical_key=f'{best_note} {best_scale}',
        scale=best_scale,
        confidence=float(confidence),
    )


def time_stretch_audio(audio: np.ndarray, sample_rate: int, ratio: float) -> np.ndarray:
    if ratio <= 0:
        raise ValueError('Stretch ratio must be positive')
    if pyrb is not None:
        try:
            stretched = pyrb.time_stretch(audio, sample_rate, ratio)
        except Exception:
            stretched = None
    else:
        stretched = None

    if stretched is None:
        # Fallback for environments without rubberband installed.
        if audio.ndim == 2:
            stretched_channels = [
                librosa.effects.time_stretch(audio[:, channel], rate=ratio)
                for channel in range(audio.shape[1])
            ]
            min_length = min(channel.shape[0] for channel in stretched_channels)
            stretched = np.stack([channel[:min_length] for channel in stretched_channels], axis=1)
        else:
            stretched = librosa.effects.time_stretch(audio, rate=ratio)
    return np.asarray(stretched, dtype=np.float32)
