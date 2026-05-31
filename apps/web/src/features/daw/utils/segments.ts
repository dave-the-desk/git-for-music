// Keep a tiny gap so we never generate an exact zero-length split.
export const MIN_SPLIT_DISTANCE_MS = 1;

export type SegmentLike = {
  startMs: number;
  endMs: number;
  timelineStartMs?: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  crossfadeInMs?: number | null;
  crossfadeOutMs?: number | null;
  crossfadeCurve?: string | null;
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

export type MergeSelection = {
  trackVersionId: string;
  segmentId: string;
};

export type MergeableSegment = SegmentLike & {
  id: string;
  trackVersionId: string;
  timelineEndMs?: number | null;
  isImplicit?: boolean;
};

export const EMPTY_TRACK_MIME_TYPE = 'application/x-git-for-music-empty-track';
export const MERGE_EPSILON_MS = 2;
export const MERGE_DIFFERENT_TRACK_ERROR = 'These clips must be on the same track to merge.';
export const MERGE_NOT_CONTIGUOUS_ERROR =
  'These clips cannot be merged because they are not continuous. Use a future bounce/render command to combine non-contiguous audio.';

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

function resolveSegmentTimelineStartMs(segment: Pick<MergeableSegment, 'startMs' | 'timelineStartMs'>) {
  return segment.timelineStartMs ?? segment.startMs;
}

function resolveSegmentTimelineEndMs(
  segment: Pick<MergeableSegment, 'startMs' | 'endMs' | 'timelineStartMs' | 'timelineEndMs'>,
) {
  const timelineStartMs = resolveSegmentTimelineStartMs(segment);
  return segment.timelineEndMs ?? timelineStartMs + Math.max(0, segment.endMs - segment.startMs);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isMergeSelectableSegment(segment: Pick<MergeableSegment, 'startMs' | 'endMs' | 'isImplicit'>) {
  return (
    segment.isImplicit !== true &&
    isFiniteNumber(segment.startMs) &&
    isFiniteNumber(segment.endMs) &&
    segment.endMs > segment.startMs
  );
}

export function isSameMergeSelection(
  selection: MergeSelection | null,
  segment: Pick<MergeableSegment, 'id' | 'trackVersionId'>,
) {
  return selection?.trackVersionId === segment.trackVersionId && selection.segmentId === segment.id;
}

export function sortSegmentsForMerge<T extends MergeableSegment>(first: T, second: T): [T, T] {
  const leftTimelineStartMs = resolveSegmentTimelineStartMs(first);
  const rightTimelineStartMs = resolveSegmentTimelineStartMs(second);

  if (leftTimelineStartMs < rightTimelineStartMs - MERGE_EPSILON_MS) {
    return [first, second];
  }

  if (rightTimelineStartMs < leftTimelineStartMs - MERGE_EPSILON_MS) {
    return [second, first];
  }

  if (first.position !== second.position) {
    return first.position <= second.position ? [first, second] : [second, first];
  }

  return first.id <= second.id ? [first, second] : [second, first];
}

function hasMergeCrossfadeMetadata(segment: MergeableSegment) {
  return (
    (segment.crossfadeInMs ?? null) !== null ||
    (segment.crossfadeOutMs ?? null) !== null ||
    (segment.crossfadeCurve ?? null) !== null
  );
}

export function getMergeCandidateError(first: MergeableSegment, second: MergeableSegment) {
  if (!isMergeSelectableSegment(first) || !isMergeSelectableSegment(second)) {
    return 'Only saved audio clips can be merged.';
  }

  if (first.trackVersionId !== second.trackVersionId) {
    return MERGE_DIFFERENT_TRACK_ERROR;
  }

  const [left, right] = sortSegmentsForMerge(first, second);

  if (left.id === right.id) {
    return 'Select two different clips to merge.';
  }

  const leftTimelineEndMs = resolveSegmentTimelineEndMs(left);
  const rightTimelineStartMs = resolveSegmentTimelineStartMs(right);
  const sourceGapMs = Math.abs(left.endMs - right.startMs);
  const timelineGapMs = Math.abs(leftTimelineEndMs - rightTimelineStartMs);

  if (timelineGapMs > MERGE_EPSILON_MS || sourceGapMs > MERGE_EPSILON_MS) {
    return MERGE_NOT_CONTIGUOUS_ERROR;
  }

  if (
    left.gainDb !== right.gainDb ||
    left.fadeInMs !== right.fadeInMs ||
    left.fadeOutMs !== right.fadeOutMs ||
    left.isMuted !== right.isMuted ||
    hasMergeCrossfadeMetadata(left) ||
    hasMergeCrossfadeMetadata(right)
  ) {
    return MERGE_NOT_CONTIGUOUS_ERROR;
  }

  return null;
}

export function buildMergedSegmentFromPair(
  first: MergeableSegment,
  second: MergeableSegment,
  options: {
    id: string;
  },
) {
  const [left, right] = sortSegmentsForMerge(first, second);

  return {
    id: options.id,
    trackVersionId: left.trackVersionId,
    startMs: left.startMs,
    endMs: right.endMs,
    timelineStartMs: resolveSegmentTimelineStartMs(left),
    timelineEndMs: resolveSegmentTimelineEndMs(right),
    gainDb: left.gainDb,
    fadeInMs: left.fadeInMs,
    fadeOutMs: left.fadeOutMs,
    isMuted: left.isMuted,
    position: Math.min(left.position, right.position),
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  };
}

export function buildRenderableTrackSegments({
  trackVersionId,
  trackStartOffsetMs,
  segments,
  fallbackDurationMs,
  allowImplicitSegment = true,
}: {
  trackVersionId: string;
  trackStartOffsetMs: number;
  segments: Array<{ id: string } & SegmentLike>;
  fallbackDurationMs: number;
  allowImplicitSegment?: boolean;
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

  if (!allowImplicitSegment) {
    return [];
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
