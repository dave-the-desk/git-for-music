import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUploadedTrackBranchTracks } from './upload-track';

test('buildUploadedTrackBranchTracks appends a newly created track to the branch snapshot', () => {
  const tracks = buildUploadedTrackBranchTracks({
    sourceTracks: [
      {
        trackId: 'track-a',
        trackName: 'Track A',
        trackPosition: 0,
        trackVersionId: 'track-version-a',
        storageKey: '/track-version-a',
        mimeType: 'audio/webm',
        durationMs: null,
        startOffsetMs: 0,
        createdAt: '2026-07-09T00:00:00.000Z',
        isDerived: false,
        operationType: 'ORIGINAL',
        parentTrackVersionId: null,
        segments: [],
        plugins: [],
      },
    ],
    trackId: 'track-b',
    trackName: 'Track B',
    trackPosition: 1,
    trackVersionId: 'track-version-b',
    storageKey: '/track-version-b',
    mimeType: 'audio/webm',
    createdAt: new Date('2026-07-09T00:00:01.000Z'),
    existingTrackId: null,
  });

  assert.equal(tracks.length, 2);
  assert.equal(tracks[1]?.trackId, 'track-b');
  assert.equal(tracks[1]?.trackName, 'Track B');
  assert.equal(tracks[1]?.trackVersionId, 'track-version-b');
});

test('buildUploadedTrackBranchTracks keeps a renamed source track and appends a distinct track ID', () => {
  const tracks = buildUploadedTrackBranchTracks({
    sourceTracks: [
      {
        trackId: 'track-existing',
        trackName: 'Lead vocal',
        trackPosition: 0,
        trackVersionId: 'track-version-existing',
        storageKey: '/track-version-existing',
        mimeType: 'application/x-git-for-music-empty-track',
        durationMs: null,
        startOffsetMs: 0,
        createdAt: '2026-07-15T00:00:00.000Z',
        isDerived: false,
        operationType: 'ORIGINAL',
        parentTrackVersionId: null,
        segments: [],
        plugins: [],
      },
    ],
    trackId: 'track-new',
    trackName: 'Track 2',
    trackPosition: 1,
    trackVersionId: 'track-version-new',
    storageKey: '/track-version-new',
    mimeType: 'application/x-git-for-music-empty-track',
    createdAt: new Date('2026-07-15T00:00:01.000Z'),
    existingTrackId: null,
  });

  assert.deepEqual(
    tracks.map((track) => track.trackId),
    ['track-existing', 'track-new'],
  );
  assert.equal(tracks[0]?.trackName, 'Lead vocal');
});

test('buildUploadedTrackBranchTracks replaces a reused blank track in place', () => {
  const tracks = buildUploadedTrackBranchTracks({
    sourceTracks: [
      {
        trackId: 'track-a',
        trackName: 'Track A',
        trackPosition: 0,
        trackVersionId: 'track-version-a-empty',
        storageKey: '/track-version-a-empty',
        mimeType: 'application/x-git-for-music-empty-track',
        durationMs: null,
        startOffsetMs: 0,
        createdAt: '2026-07-09T00:00:00.000Z',
        isDerived: false,
        operationType: 'ORIGINAL',
        parentTrackVersionId: null,
        segments: [],
        plugins: [],
      },
    ],
    trackId: 'track-a',
    trackName: 'Track A',
    trackPosition: 0,
    trackVersionId: 'track-version-a-audio',
    storageKey: '/track-version-a-audio',
    mimeType: 'audio/webm',
    createdAt: new Date('2026-07-09T00:00:01.000Z'),
    existingTrackId: 'track-a',
  });

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.trackVersionId, 'track-version-a-audio');
  assert.equal(tracks[0]?.mimeType, 'audio/webm');
});
