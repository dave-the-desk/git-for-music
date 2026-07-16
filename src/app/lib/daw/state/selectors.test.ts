import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectLatestVersionOrNull,
  getRenderableTrackSegments,
  selectSegmentAudioSource,
  selectVersionById,
} from './selectors';
import type { DawTrack, DawVersion } from './local-project-state';

function makeVersion(id: string, overrides: Partial<DawVersion> = {}): DawVersion {
  return {
    id,
    label: overrides.label ?? id,
    name: overrides.name ?? overrides.label ?? id,
    branchName: overrides.branchName ?? overrides.label ?? id,
    operationSummary: overrides.operationSummary ?? null,
    createdBy: overrides.createdBy ?? 'user-a',
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    parentVersionId: overrides.parentVersionId ?? overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    operationSeq: overrides.operationSeq ?? 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks: overrides.tracks ?? [],
  };
}

test('selectLatestVersionOrNull returns the newest version in a timeline', () => {
  const oldest = makeVersion('version-oldest', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const newest = makeVersion('version-newest', {
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  assert.equal(selectLatestVersionOrNull([oldest, newest])?.id, newest.id);
});

test('selectVersionById falls back to the newest version instead of the first version', () => {
  const oldest = makeVersion('version-oldest', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const newest = makeVersion('version-newest', {
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  assert.equal(selectVersionById([oldest, newest], null)?.id, newest.id);
});

test('an initialized track with no segments remains an empty lane after reload', () => {
  const track: DawTrack = {
    trackId: 'track-a',
    trackName: 'Track A',
    trackPosition: 0,
    trackVersionId: 'track-version-a',
    storageKey: '/api/daw/track-versions/track-version-a/audio',
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 2400,
    startOffsetMs: 0,
    isDerived: false,
    operationType: 'ORIGINAL',
    parentTrackVersionId: null,
    segmentsInitialized: true,
    segments: [],
    plugins: [],
  };

  assert.deepEqual(
    getRenderableTrackSegments({
      track,
      offsetOverrides: {},
      segmentLayoutOverrides: {},
      durationByTrackVersionId: {},
    }),
    [],
  );
});

test('a moved segment renders audio from its source track instead of the destination lane', () => {
  const sourceTrack = {
    trackId: 'track-a',
    trackName: 'Source',
    trackPosition: 0,
    trackVersionId: 'track-version-a',
    storageKey: '/api/daw/track-versions/track-version-a/audio',
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 2400,
    startOffsetMs: 0,
    isDerived: false,
    operationType: 'ORIGINAL' as const,
    parentTrackVersionId: null,
    segments: [],
    plugins: [],
  };
  const destinationTrack: DawTrack = {
    ...sourceTrack,
    trackId: 'track-b',
    trackName: 'Destination',
    trackVersionId: 'track-version-b',
    storageKey: '/api/daw/track-versions/track-version-b/audio',
    mimeType: 'application/x-git-for-music-empty-track',
  };
  const segment = {
    id: 'segment-1',
    trackVersionId: 'track-version-b',
    sourceTrackVersionId: 'track-version-a',
    sourceStorageKey: '/api/daw/track-versions/track-version-a/audio',
    sourceStartMs: 0,
    sourceEndMs: 2400,
    timelineStartMs: 0,
    timelineEndMs: 2400,
    durationMs: 2400,
    startMs: 0,
    endMs: 2400,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };

  assert.deepEqual(selectSegmentAudioSource(destinationTrack, segment, [sourceTrack, destinationTrack]), {
    storageKey: '/api/daw/track-versions/track-version-a/audio',
    mimeType: 'audio/webm;codecs=opus',
  });
});
