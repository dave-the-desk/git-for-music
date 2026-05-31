import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMergedSegmentFromPair,
  buildRenderableTrackSegments,
  getMergeCandidateError,
  isMergeSelectableSegment,
  isSameMergeSelection,
  splitSegment,
} from '@/features/daw/utils/segments';

function makeMergeSegment(overrides: Partial<{
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  isImplicit: boolean;
}> = {}) {
  const startMs = overrides.startMs ?? 0;
  const endMs = overrides.endMs ?? 1000;
  const timelineStartMs = overrides.timelineStartMs ?? 0;
  const timelineEndMs = overrides.timelineEndMs ?? timelineStartMs + (endMs - startMs);

  return {
    id: overrides.id ?? 'segment-a',
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    startMs,
    endMs,
    timelineStartMs,
    timelineEndMs,
    gainDb: overrides.gainDb ?? 0,
    fadeInMs: overrides.fadeInMs ?? 0,
    fadeOutMs: overrides.fadeOutMs ?? 0,
    isMuted: overrides.isMuted ?? false,
    position: overrides.position ?? 0,
    isImplicit: overrides.isImplicit ?? false,
  };
}

test('splitSegment preserves audio metadata while dividing the timeline bounds', () => {
  const result = splitSegment({
    startMs: 100,
    endMs: 900,
    timelineStartMs: 1000,
    gainDb: -3,
    fadeInMs: 10,
    fadeOutMs: 25,
    isMuted: false,
    position: 2,
  }, 400);

  assert.deepEqual(result.leftSegment, {
    startMs: 100,
    endMs: 400,
    timelineStartMs: 1000,
    gainDb: -3,
    fadeInMs: 10,
    fadeOutMs: 25,
    isMuted: false,
    position: 2,
  });
  assert.deepEqual(result.rightSegment, {
    startMs: 400,
    endMs: 900,
    timelineStartMs: 1300,
    gainDb: -3,
    fadeInMs: 10,
    fadeOutMs: 25,
    isMuted: false,
    position: 3,
  });
});

test('splitSegment rejects split points near either boundary', () => {
  assert.throws(() =>
    splitSegment(
      {
        startMs: 0,
        endMs: 500,
        timelineStartMs: 0,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      1,
    ),
  );
  assert.throws(() =>
    splitSegment(
      {
        startMs: 0,
        endMs: 500,
        timelineStartMs: 0,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      499,
    ),
  );
});

test('buildRenderableTrackSegments creates an implicit full-length segment when none are persisted', () => {
  const segments = buildRenderableTrackSegments({
    trackVersionId: 'track-version-1',
    trackStartOffsetMs: 250,
    segments: [],
    fallbackDurationMs: 1250,
  });

  assert.deepEqual(segments, [
    {
      id: 'implicit:track-version-1',
      trackVersionId: 'track-version-1',
      sourceStartMs: 0,
      sourceEndMs: 1250,
      timelineStartMs: 250,
      timelineEndMs: 1500,
      durationMs: 1250,
      startMs: 0,
      endMs: 1250,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
      isImplicit: true,
    },
  ]);
});

test('buildMergedSegmentFromPair preserves a continuous merge candidate', () => {
  const left = makeMergeSegment({
    id: 'segment-a',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 200,
    timelineEndMs: 1200,
    position: 0,
  });
  const right = makeMergeSegment({
    id: 'segment-b',
    startMs: 1000,
    endMs: 2000,
    timelineStartMs: 1200,
    timelineEndMs: 2200,
    position: 1,
  });

  assert.equal(getMergeCandidateError(left, right), null);
  assert.deepEqual(buildMergedSegmentFromPair(left, right, { id: 'merged-segment' }), {
    id: 'merged-segment',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 2000,
    timelineStartMs: 200,
    timelineEndMs: 2200,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  });
});

test('getMergeCandidateError rejects timeline gaps', () => {
  const left = makeMergeSegment({
    id: 'segment-a',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
  });
  const right = makeMergeSegment({
    id: 'segment-b',
    startMs: 1000,
    endMs: 2000,
    timelineStartMs: 1004,
    timelineEndMs: 2004,
    position: 1,
  });

  assert.equal(
    getMergeCandidateError(left, right),
    'These clips cannot be merged because they are not continuous. Use a future bounce/render command to combine non-contiguous audio.',
  );
});

test('getMergeCandidateError rejects source gaps', () => {
  const left = makeMergeSegment({
    id: 'segment-a',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
  });
  const right = makeMergeSegment({
    id: 'segment-b',
    startMs: 1050,
    endMs: 2050,
    timelineStartMs: 1000,
    timelineEndMs: 2000,
    position: 1,
  });

  assert.equal(
    getMergeCandidateError(left, right),
    'These clips cannot be merged because they are not continuous. Use a future bounce/render command to combine non-contiguous audio.',
  );
});

test('getMergeCandidateError rejects different track versions', () => {
  const left = makeMergeSegment({
    id: 'segment-a',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
  });
  const right = makeMergeSegment({
    id: 'segment-b',
    trackVersionId: 'track-version-2',
    startMs: 1000,
    endMs: 2000,
    timelineStartMs: 1000,
    timelineEndMs: 2000,
    position: 1,
  });

  assert.equal(getMergeCandidateError(left, right), 'These clips must be on the same track to merge.');
});

test('isMergeSelectableSegment rejects implicit clips', () => {
  assert.equal(isMergeSelectableSegment(makeMergeSegment({ isImplicit: true })), false);
  assert.equal(
    getMergeCandidateError(
      makeMergeSegment({ isImplicit: true }),
      makeMergeSegment({
        id: 'segment-b',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
    ),
    'Only saved audio clips can be merged.',
  );
});

test('isSameMergeSelection treats a repeated click on the same clip as a toggle off', () => {
  assert.equal(
    isSameMergeSelection(
      { trackVersionId: 'track-version-1', segmentId: 'segment-a' },
      { trackVersionId: 'track-version-1', id: 'segment-a' },
    ),
    true,
  );
  assert.equal(
    isSameMergeSelection(
      { trackVersionId: 'track-version-1', segmentId: 'segment-a' },
      { trackVersionId: 'track-version-1', id: 'segment-b' },
    ),
    false,
  );
});
