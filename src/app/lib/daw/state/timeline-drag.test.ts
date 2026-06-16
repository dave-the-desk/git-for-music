import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSegmentDragCommitTimelineStartMs,
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
