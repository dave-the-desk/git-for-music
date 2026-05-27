import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordedTakeBounds } from '@/features/daw/utils/recording-bounds';

test('buildRecordedTakeBounds uses the measured blob duration when available', () => {
  assert.deepEqual(
    buildRecordedTakeBounds({
      timelineStartMs: 250,
      measuredDurationMs: 1499.6,
      fallbackDurationMs: 1000,
    }),
    {
      startOffsetMs: 250,
      durationMs: 1500,
      sourceStartMs: 0,
      sourceEndMs: 1500,
      timelineStartMs: 250,
      timelineEndMs: 1750,
    },
  );
});

test('buildRecordedTakeBounds falls back to wall-clock duration when measured duration is unavailable', () => {
  assert.deepEqual(
    buildRecordedTakeBounds({
      timelineStartMs: 0,
      measuredDurationMs: null,
      fallbackDurationMs: 987.2,
    }),
    {
      startOffsetMs: 0,
      durationMs: 987,
      sourceStartMs: 0,
      sourceEndMs: 987,
      timelineStartMs: 0,
      timelineEndMs: 987,
    },
  );
});
