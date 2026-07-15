import test from 'node:test';
import assert from 'node:assert/strict';
import { getDuplicateBlankTrackVersionIds, pruneDuplicateBlankTracks } from './track-duplicate-cleanup';
import { EMPTY_TRACK_MIME_TYPE } from './segments';

test('pruneDuplicateBlankTracks preserves distinct track identities when a mutable name is reused', () => {
  const tracks = pruneDuplicateBlankTracks([
    {
      trackVersionId: 'track-version-blank',
      trackId: 'track-1',
      trackName: 'Track 1',
      mimeType: EMPTY_TRACK_MIME_TYPE,
    },
    {
      trackVersionId: 'track-version-audio',
      trackId: 'track-2',
      trackName: 'Track 1',
      mimeType: 'audio/webm',
    },
  ]);

  assert.deepEqual(
    tracks.map((track) => track.trackVersionId),
    ['track-version-blank', 'track-version-audio'],
  );
});

test('pruneDuplicateBlankTracks removes a blank duplicate when the stable track identity matches', () => {
  const tracks = pruneDuplicateBlankTracks([
    {
      trackVersionId: 'track-version-blank',
      trackId: 'track-1',
      trackName: 'Renamed track',
      mimeType: EMPTY_TRACK_MIME_TYPE,
    },
    {
      trackVersionId: 'track-version-audio',
      trackId: 'track-1',
      trackName: 'Renamed track',
      mimeType: 'audio/webm',
    },
  ]);

  assert.deepEqual(
    tracks.map((track) => track.trackVersionId),
    ['track-version-audio'],
  );
});

test('getDuplicateBlankTrackVersionIds keeps same-name audio tracks intact', () => {
  assert.deepEqual(
    getDuplicateBlankTrackVersionIds([
      {
        trackVersionId: 'track-version-1',
        trackId: 'track-1',
        trackName: 'Track 1',
        mimeType: 'audio/webm',
      },
      {
        trackVersionId: 'track-version-2',
        trackId: 'track-2',
        trackName: 'Track 1',
        mimeType: 'audio/webm',
      },
    ]),
    [],
  );
});
