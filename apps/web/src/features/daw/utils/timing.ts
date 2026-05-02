import type { DemoTimingMetadata, SnapResolution, TimeSignature } from '@git-for-music/shared';

export function isValidTempoBpm(tempoBpm: number | null | undefined) {
  return typeof tempoBpm === 'number' && Number.isFinite(tempoBpm) && tempoBpm >= 40 && tempoBpm <= 240;
}

export function normalizeTimeSignature(timeSignature: Partial<TimeSignature> | null | undefined): TimeSignature {
  const num = typeof timeSignature?.num === 'number' && Number.isFinite(timeSignature.num) && timeSignature.num > 0
    ? Math.floor(timeSignature.num)
    : 4;
  const den = typeof timeSignature?.den === 'number' && Number.isFinite(timeSignature.den) && timeSignature.den > 0
    ? Math.floor(timeSignature.den)
    : 4;
  return { num, den };
}

export function getSecondsPerBeat(tempoBpm: number) {
  return 60 / tempoBpm;
}

export function getSecondsPerBar(tempoBpm: number, timeSignature: TimeSignature) {
  return getSecondsPerBeat(tempoBpm) * timeSignature.num;
}

export function getBeatSubdivisionSeconds(
  tempoBpm: number,
  timeSignature: TimeSignature,
  resolution: SnapResolution,
) {
  const secondsPerBeat = getSecondsPerBeat(tempoBpm);
  switch (resolution) {
    case 'bar':
      return getSecondsPerBar(tempoBpm, timeSignature);
    case 'beat':
      return secondsPerBeat;
    case 'halfBeat':
      return secondsPerBeat / 2;
    case 'quarterBeat':
      return secondsPerBeat / 4;
    case 'off':
    default:
      return null;
  }
}

export function snapMsToGrid(rawMs: number, timing: DemoTimingMetadata | null, resolution: SnapResolution) {
  if (!timing || resolution === 'off' || !isValidTempoBpm(timing.tempoBpm)) {
    return Math.max(0, rawMs);
  }

  const gridSeconds = getBeatSubdivisionSeconds(timing.tempoBpm!, timing.timeSignature, resolution);
  if (!gridSeconds || gridSeconds <= 0) return Math.max(0, rawMs);

  const snapped = Math.round((rawMs / 1000) / gridSeconds) * gridSeconds * 1000;
  return Math.max(0, snapped);
}

export function timeToBarBeatLabel(timeSeconds: number, timing: DemoTimingMetadata | null) {
  if (!timing || !isValidTempoBpm(timing.tempoBpm)) return null;
  const secondsPerBeat = getSecondsPerBeat(timing.tempoBpm!);
  const beatIndex = Math.floor(timeSeconds / secondsPerBeat);
  const bar = Math.floor(beatIndex / timing.timeSignature.num) + 1;
  const beat = (beatIndex % timing.timeSignature.num) + 1;
  return { bar, beat };
}

export function formatBarBeatLabel(timeSeconds: number, timing: DemoTimingMetadata | null) {
  const beatLabel = timeToBarBeatLabel(timeSeconds, timing);
  if (!beatLabel) return null;
  return `${beatLabel.bar}.${beatLabel.beat}`;
}

export function getBeatTimes(totalDurationSeconds: number, timing: DemoTimingMetadata | null) {
  if (!timing || !isValidTempoBpm(timing.tempoBpm)) return [];
  const secondsPerBeat = getSecondsPerBeat(timing.tempoBpm!);
  const totalBeats = Math.ceil(totalDurationSeconds / secondsPerBeat);
  return Array.from({ length: Math.max(0, totalBeats + 1) }, (_, index) => index * secondsPerBeat);
}
