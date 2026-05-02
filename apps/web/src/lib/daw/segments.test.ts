import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderableTrackSegments, splitSegment } from './segments';

test('splitSegment preserves audio metadata while dividing the timeline bounds', () => {
  const result = splitSegment({
    startMs: 100,
    endMs: 900,
    gainDb: -3,
    fadeInMs: 10,
    fadeOutMs: 25,
    isMuted: false,
    position: 2,
  }, 400);

  assert.deepEqual(result.leftSegment, {
    startMs: 100,
    endMs: 400,
    gainDb: -3,
    fadeInMs: 10,
    fadeOutMs: 25,
    isMuted: false,
    position: 2,
  });
  assert.deepEqual(result.rightSegment, {
    startMs: 400,
    endMs: 900,
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
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      25,
    ),
  );
  assert.throws(() =>
    splitSegment(
      {
        startMs: 0,
        endMs: 500,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      480,
    ),
  );
});

test('buildRenderableTrackSegments creates an implicit full-length segment when none are persisted', () => {
  const segments = buildRenderableTrackSegments({
    trackVersionId: 'track-version-1',
    segments: [],
    fallbackDurationMs: 1250,
  });

  assert.deepEqual(segments, [
    {
      id: 'implicit:track-version-1',
      trackVersionId: 'track-version-1',
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

