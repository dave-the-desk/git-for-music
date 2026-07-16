import test from 'node:test';
import assert from 'node:assert/strict';
import type { TrackTimelineSegment } from '@/app/lib/daw/state/local-project-state';
import {
  buildSameTrackSegmentMoveUndoInput,
  getSegmentDragCommitTimelineStartMs,
  getSegmentDragOriginalSegments,
  getTrackDragCommitOffset,
  updateSegmentDragState,
  updateTrackDragState,
} from '@/app/lib/daw/state/timeline-drag';

test('track drag commits the latest snapped offset', () => {
  const drag = updateTrackDragState(
    {
      kind: 'track',
      trackVersionId: 'track-version-a',
      originalStartOffsetMs: 1200,
      currentStartOffsetMs: 1200,
      startX: 100,
    },
    2500,
  );

  assert.equal(getTrackDragCommitOffset(drag), 2500);
  assert.equal(drag.originalStartOffsetMs, 1200);
});

test('implicit clip drag captures the rendered clip even when no segments are persisted', () => {
  const implicitSegment = {
    id: 'implicit:track-version-a',
    isImplicit: true,
  } as TrackTimelineSegment;
  const renderableSegments = [implicitSegment];

  assert.equal(
    getSegmentDragOriginalSegments(implicitSegment, [], renderableSegments),
    renderableSegments,
  );
});

test('same-track move undo validates against the current placement and restores the previous placement', () => {
  assert.deepEqual(
    buildSameTrackSegmentMoveUndoInput({
      trackVersionId: 'track-version-a',
      segmentId: 'segment-1',
      previousTimelineStartMs: 1200,
      currentSegment: {
        timelineStartMs: 3650,
        timelineEndMs: 4450,
        durationMs: 800,
      },
    }),
    {
      segmentId: 'segment-1',
      fromTrackVersionId: 'track-version-a',
      toTrackVersionId: 'track-version-a',
      fromTimelineStartMs: 3650,
      fromTimelineEndMs: 4450,
      toTimelineStartMs: 1200,
      toTimelineEndMs: 2000,
    },
  );
});

test('segment drag commits the latest snapped timeline position', () => {
  const drag = updateSegmentDragState(
    {
      kind: 'segment',
      trackVersionId: 'track-version-a',
      segmentId: 'segment-1',
      originalTimelineStartMs: 1200,
      originalTimelineEndMs: 2000,
      currentTimelineStartMs: 1200,
      originalSegments: [],
      startX: 100,
    },
    3650,
  );

  assert.equal(getSegmentDragCommitTimelineStartMs(drag), 3650);
  assert.equal(drag.originalTimelineStartMs, 1200);
  assert.equal(drag.originalTimelineEndMs, 2000);
});
