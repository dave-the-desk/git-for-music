import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextEmptyTrackName, getNextUploadTrackName } from './track-names';

test('getNextEmptyTrackName increments the highest numbered track label', () => {
  assert.equal(getNextEmptyTrackName([{ trackName: 'Track 1' }, { trackName: 'Track 3' }]), 'Track 4');
});

test('getNextEmptyTrackName does not reuse a generated label after a track is renamed', () => {
  assert.equal(
    getNextEmptyTrackName([{ trackName: 'Lead vocal', trackPosition: 0 }]),
    'Track 2',
  );
});

test('getNextUploadTrackName uses the selected checkout when available', () => {
  assert.equal(
    getNextUploadTrackName({
      liveActiveVersionId: 'version-live',
      selectedVersionId: 'version-history',
      liveActiveTracks: [{ trackName: 'Track 1' }],
      selectedTracks: [{ trackName: 'Track 1' }, { trackName: 'Track 2' }],
    }),
    'Track 3',
  );
});
