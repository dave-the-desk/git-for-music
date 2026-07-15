import test from 'node:test';
import assert from 'node:assert/strict';
import { getDuplicateBlankTrackVersionIds } from './track-duplicate-cleanup';

test('server duplicate cleanup preserves distinct track identities when a mutable name is reused', () => {
  assert.deepEqual(
    getDuplicateBlankTrackVersionIds([
      {
        trackVersionId: 'track-version-blank',
        trackId: 'track-1',
        trackName: 'Track 1',
        mimeType: 'application/x-git-for-music-empty-track',
      },
      {
        trackVersionId: 'track-version-audio',
        trackId: 'track-2',
        trackName: 'Track 1',
        mimeType: 'audio/webm',
      },
    ]),
    [],
  );
});

test('server duplicate cleanup removes a blank copy when the stable track identity matches', () => {
  assert.deepEqual(
    getDuplicateBlankTrackVersionIds([
      {
        trackVersionId: 'track-version-blank',
        trackId: 'track-1',
        trackName: 'Renamed track',
        mimeType: 'application/x-git-for-music-empty-track',
      },
      {
        trackVersionId: 'track-version-audio',
        trackId: 'track-1',
        trackName: 'Renamed track',
        mimeType: 'audio/webm',
      },
    ]),
    ['track-version-blank'],
  );
});

test('server duplicate cleanup keeps same-name audio tracks when both tracks contain audio', () => {
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
