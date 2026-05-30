import type { TrackTimelineSegment } from '@/features/daw/utils/segments';

export type TrackDragState = {
  kind: 'track';
  trackVersionId: string;
  originalStartOffsetMs: number;
  currentStartOffsetMs: number;
  startX: number;
};

export type SegmentDragState = {
  kind: 'segment';
  trackVersionId: string;
  segmentId: string;
  originalTimelineStartMs: number;
  originalTimelineEndMs: number;
  currentTimelineStartMs: number;
  originalSegments: TrackTimelineSegment[];
  startX: number;
};

export type TimelineDragState = TrackDragState | SegmentDragState;

export function updateTrackDragState(drag: TrackDragState, nextStartOffsetMs: number): TrackDragState {
  return {
    ...drag,
    currentStartOffsetMs: nextStartOffsetMs,
  };
}

export function updateSegmentDragState(
  drag: SegmentDragState,
  nextTimelineStartMs: number,
): SegmentDragState {
  return {
    ...drag,
    currentTimelineStartMs: nextTimelineStartMs,
  };
}

export function getTrackDragCommitOffset(drag: TrackDragState) {
  return drag.currentStartOffsetMs;
}

export function getSegmentDragCommitTimelineStartMs(drag: SegmentDragState) {
  return drag.currentTimelineStartMs;
}
