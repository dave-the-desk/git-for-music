import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowTemporaryRecordingTrack } from './recording-preview';

test('shouldShowTemporaryRecordingTrack hides a saved recording preview', () => {
  assert.equal(
    shouldShowTemporaryRecordingTrack({
      syncStatus: 'complete',
      serverTrackVersionId: 'track-version-1',
      serverDemoVersionId: 'demo-version-1',
    }),
    false,
  );
});

test('shouldShowTemporaryRecordingTrack keeps an in-flight recording visible', () => {
  assert.equal(
    shouldShowTemporaryRecordingTrack({
      syncStatus: 'uploading',
      serverTrackVersionId: null,
      serverDemoVersionId: null,
    }),
    true,
  );
});

