import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDawVisualProjection } from './visual-renderer';

test('buildDawVisualProjection rounds live transport geometry to stable pixels', () => {
  const projection = buildDawVisualProjection({
    tracks: [
      {
        trackId: 'track-1',
        trackName: 'Track 1',
        trackVersionId: 'track-version-1',
        storageKey: '/audio/track-1.wav',
        mimeType: 'audio/wav',
        startOffsetMs: 0,
        durationMs: 1000,
        isMuted: false,
        segments: [],
      },
    ],
    currentTimeMs: 1234,
    splitHover: null,
    durationByTrackVersionId: {},
    offsetOverrides: {},
    segmentLayoutOverrides: {},
    temporaryRecordingTrack: {
      id: 'recording-1',
      name: 'Take 1',
      targetTrackId: 'track-1',
      targetTrackVersionId: 'track-version-1',
      targetTrackName: 'Track 1',
      startOffsetMs: 125,
      startedAtPlayheadMs: 125,
      durationMs: 987,
      recordedTempoBpm: 120,
      sourceTempoBpm: 120,
      status: 'recording',
      syncStatus: 'idle',
      peaks: [],
    },
  });

  assert.equal(projection.currentTimeLeftPx, 99);
  assert.equal(projection.recordingTrackEndPx, 89);

  const recording = projection.trackLanesByTrackVersionId['track-version-1'].recording;
  assert.ok(recording);
  assert.equal(recording.leftPx, 10);
  assert.equal(recording.widthPx, 79);
  assert.equal(recording.hitAreaWidthPx, 120);
  assert.equal(recording.waveformWidthPx, 79);
});
