export type RecordingTakeBounds = {
  startOffsetMs: number;
  durationMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
};

export function buildRecordedTakeBounds(input: {
  timelineStartMs: number;
  measuredDurationMs: number | null;
  fallbackDurationMs: number;
}): RecordingTakeBounds {
  const durationMs = Math.max(0, Math.round(input.measuredDurationMs ?? input.fallbackDurationMs));
  const timelineStartMs = Math.max(0, input.timelineStartMs);
  return {
    startOffsetMs: timelineStartMs,
    durationMs,
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    timelineStartMs,
    timelineEndMs: timelineStartMs + durationMs,
  };
}
