import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrossfadePayload,
  CROSSFADE_DURATION_ERROR,
  CROSSFADE_DIFFERENT_TRACK_ERROR,
  CROSSFADE_NOT_CONTIGUOUS_ERROR,
  CROSSFADE_NOT_SELECTABLE_ERROR,
  isCrossfadeSelectableSegment,
  isFadeSelectableSegment,
  sortSegmentsForCrossfade,
  getCrossfadeCandidateError,
} from '@/features/daw/utils/segments';
import type { MergeableSegment } from '@/features/daw/utils/segments';

function makeSegment(overrides: Partial<MergeableSegment> = {}): MergeableSegment {
  const startMs = overrides.startMs ?? 0;
  const endMs = overrides.endMs ?? 1000;
  const timelineStartMs = overrides.timelineStartMs ?? 0;
  const timelineEndMs = overrides.timelineEndMs ?? timelineStartMs + Math.max(0, endMs - startMs);

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
    crossfadeInMs: overrides.crossfadeInMs ?? null,
    crossfadeOutMs: overrides.crossfadeOutMs ?? null,
    crossfadeCurve: overrides.crossfadeCurve ?? null,
  };
}

test('fade and crossfade selectable helpers reject implicit or zero-length clips', () => {
  assert.equal(
    isFadeSelectableSegment(
      makeSegment({
        isImplicit: true,
      }),
    ),
    false,
  );

  assert.equal(
    isCrossfadeSelectableSegment(
      makeSegment({
        isImplicit: true,
      }),
    ),
    false,
  );

  assert.equal(
    isCrossfadeSelectableSegment(
      makeSegment({
        startMs: 10,
        endMs: 10,
      }),
    ),
    false,
  );
});

test('sortSegmentsForCrossfade orders clips by timeline position and falls back to position', () => {
  const later = makeSegment({
    id: 'segment-b',
    position: 1,
    timelineStartMs: 1000,
  });
  const earlier = makeSegment({
    id: 'segment-a',
    position: 0,
    timelineStartMs: 0,
  });

  assert.deepEqual(sortSegmentsForCrossfade(later, earlier).map((segment) => segment.id), ['segment-a', 'segment-b']);

  const sameStartLowerPosition = makeSegment({
    id: 'segment-c',
    position: 0,
    timelineStartMs: 500,
  });
  const sameStartHigherPosition = makeSegment({
    id: 'segment-d',
    position: 1,
    timelineStartMs: 500,
  });
  assert.deepEqual(
    sortSegmentsForCrossfade(sameStartHigherPosition, sameStartLowerPosition).map((segment) => segment.id),
    ['segment-c', 'segment-d'],
  );
});

test('getCrossfadeCandidateError allows adjacent and overlapping clips but rejects gaps and invalid candidates', () => {
  const adjacentLeft = makeSegment({
    id: 'segment-a',
    timelineStartMs: 0,
    timelineEndMs: 1000,
    position: 0,
  });
  const adjacentRight = makeSegment({
    id: 'segment-b',
    timelineStartMs: 1000,
    timelineEndMs: 2000,
    position: 1,
  });

  assert.equal(getCrossfadeCandidateError(adjacentLeft, adjacentRight), null);

  const overlappingRight = makeSegment({
    id: 'segment-b',
    timelineStartMs: 900,
    timelineEndMs: 1900,
    position: 1,
  });
  assert.equal(getCrossfadeCandidateError(adjacentLeft, overlappingRight), null);

  const gapRight = makeSegment({
    id: 'segment-b',
    timelineStartMs: 1004,
    timelineEndMs: 2004,
    position: 1,
  });
  assert.equal(getCrossfadeCandidateError(adjacentLeft, gapRight), CROSSFADE_NOT_CONTIGUOUS_ERROR);

  assert.equal(
    getCrossfadeCandidateError(
      makeSegment({ id: 'segment-a', trackVersionId: 'track-version-1' }),
      makeSegment({ id: 'segment-b', trackVersionId: 'track-version-2' }),
    ),
    CROSSFADE_DIFFERENT_TRACK_ERROR,
  );

  assert.equal(
    getCrossfadeCandidateError(
      makeSegment({ id: 'segment-a', isImplicit: true }),
      makeSegment({ id: 'segment-b' }),
    ),
    CROSSFADE_NOT_SELECTABLE_ERROR,
  );
});

test('buildCrossfadePayload orders the selected clips and validates duration', () => {
  const payload = buildCrossfadePayload(
    makeSegment({
      id: 'segment-b',
      trackVersionId: 'track-version-1',
      timelineStartMs: 1000,
      timelineEndMs: 2000,
      position: 1,
    }),
    makeSegment({
      id: 'segment-a',
      trackVersionId: 'track-version-1',
      timelineStartMs: 0,
      timelineEndMs: 1000,
      position: 0,
    }),
    250,
  );

  assert.deepEqual(payload, {
    trackVersionId: 'track-version-1',
    leftSegmentId: 'segment-a',
    rightSegmentId: 'segment-b',
    crossfadeInMs: 250,
    crossfadeOutMs: 250,
    curve: 'linear',
  });

  assert.throws(
    () =>
      buildCrossfadePayload(
        makeSegment({
          id: 'segment-a',
          timelineStartMs: 0,
          timelineEndMs: 200,
          position: 0,
        }),
        makeSegment({
          id: 'segment-b',
          timelineStartMs: 200,
          timelineEndMs: 350,
          position: 1,
        }),
        250,
      ),
    new RegExp(CROSSFADE_DURATION_ERROR),
  );
});
