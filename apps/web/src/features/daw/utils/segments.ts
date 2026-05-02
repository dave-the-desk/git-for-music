export const MIN_SPLIT_DISTANCE_MS = 50;

export type SegmentLike = {
  startMs: number;
  endMs: number;
  timelineStartMs?: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
};

export type TrackTimelineSegment = SegmentLike & {
  id: string;
  trackVersionId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
  startMs: number;
  endMs: number;
  isImplicit: boolean;
};

export type SplitSegmentResult = {
  leftSegment: SegmentLike;
  rightSegment: SegmentLike;
};

function assertFiniteNumber(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

export function isValidSplitTime(
  segment: Pick<SegmentLike, 'startMs' | 'endMs'>,
  splitTimeMs: number,
  minimumBoundaryMs = MIN_SPLIT_DISTANCE_MS,
) {
  assertFiniteNumber('splitTimeMs', splitTimeMs);

  if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) {
    return false;
  }

  if (segment.endMs <= segment.startMs) {
    return false;
  }

  return splitTimeMs > segment.startMs + minimumBoundaryMs && splitTimeMs < segment.endMs - minimumBoundaryMs;
}

export function splitSegment(
  segment: SegmentLike,
  splitTimeMs: number,
  minimumBoundaryMs = MIN_SPLIT_DISTANCE_MS,
): SplitSegmentResult {
  assertFiniteNumber('segment.startMs', segment.startMs);
  assertFiniteNumber('segment.endMs', segment.endMs);
  assertFiniteNumber('segment.gainDb', segment.gainDb);
  assertFiniteNumber('segment.fadeInMs', segment.fadeInMs);
  assertFiniteNumber('segment.fadeOutMs', segment.fadeOutMs);
  assertFiniteNumber('segment.position', segment.position);

  if (!isValidSplitTime(segment, splitTimeMs, minimumBoundaryMs)) {
    throw new Error('Split point must be inside the segment and away from both boundaries');
  }

  return {
    leftSegment: {
      startMs: segment.startMs,
      endMs: splitTimeMs,
      timelineStartMs: segment.timelineStartMs ?? null,
      gainDb: segment.gainDb,
      fadeInMs: segment.fadeInMs,
      fadeOutMs: segment.fadeOutMs,
      isMuted: segment.isMuted,
      position: segment.position,
    },
    rightSegment: {
      startMs: splitTimeMs,
      endMs: segment.endMs,
      timelineStartMs:
        segment.timelineStartMs != null ? segment.timelineStartMs + (splitTimeMs - segment.startMs) : null,
      gainDb: segment.gainDb,
      fadeInMs: segment.fadeInMs,
      fadeOutMs: segment.fadeOutMs,
      isMuted: segment.isMuted,
      position: segment.position + 1,
    },
  };
}

export function buildRenderableTrackSegments({
  trackVersionId,
  trackStartOffsetMs,
  segments,
  fallbackDurationMs,
}: {
  trackVersionId: string;
  trackStartOffsetMs: number;
  segments: Array<{ id: string } & SegmentLike>;
  fallbackDurationMs: number;
}): TrackTimelineSegment[] {
  if (segments.length > 0) {
    return [...segments]
      .sort((a, b) => a.position - b.position)
      .map((segment) => ({
        ...segment,
        sourceStartMs: segment.startMs,
        sourceEndMs: segment.endMs,
        timelineStartMs: segment.timelineStartMs ?? trackStartOffsetMs + segment.startMs,
        timelineEndMs: (segment.timelineStartMs ?? trackStartOffsetMs + segment.startMs) + (segment.endMs - segment.startMs),
        durationMs: segment.endMs - segment.startMs,
        startMs: segment.startMs,
        endMs: segment.endMs,
        trackVersionId,
        isImplicit: false,
      }));
  }

  const durationMs = Math.max(0, fallbackDurationMs);
  return [
    {
      id: `implicit:${trackVersionId}`,
      trackVersionId,
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      timelineStartMs: trackStartOffsetMs,
      timelineEndMs: trackStartOffsetMs + durationMs,
      durationMs,
      startMs: 0,
      endMs: durationMs,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
      isImplicit: true,
    },
  ];
}
