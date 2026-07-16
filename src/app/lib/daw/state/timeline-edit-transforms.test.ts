import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawTrack, TrackTimelineSegment } from './local-project-state';
import {
  applyCrossfadeSet,
  applySegmentFadeSet,
  applySegmentMerge,
  applySegmentMove,
  applySegmentSplit,
  applySegmentTrim,
  applyTimelineEditOperation,
  applyTrackRename,
} from './timeline-edit-transforms';

function makeSegment(id: string, overrides: Partial<TrackTimelineSegment> = {}): TrackTimelineSegment {
  return {
    id,
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    sourceStartMs: overrides.sourceStartMs ?? 0,
    sourceEndMs: overrides.sourceEndMs ?? 1000,
    timelineStartMs: overrides.timelineStartMs ?? 0,
    timelineEndMs: overrides.timelineEndMs ?? 1000,
    durationMs: overrides.durationMs ?? 1000,
    startMs: overrides.startMs ?? 0,
    endMs: overrides.endMs ?? 1000,
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

function makeTrack(trackVersionId: string, overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    trackId: overrides.trackId ?? `track-${trackVersionId}`,
    trackName: overrides.trackName ?? `Track ${trackVersionId}`,
    trackPosition: overrides.trackPosition ?? 0,
    trackVersionId,
    storageKey: overrides.storageKey ?? `/tracks/${trackVersionId}.wav`,
    mimeType: overrides.mimeType ?? 'audio/wav',
    durationMs: overrides.durationMs ?? 1000,
    startOffsetMs: overrides.startOffsetMs ?? 0,
    recordedTempoBpm: overrides.recordedTempoBpm ?? null,
    sourceTempoBpm: overrides.sourceTempoBpm ?? null,
    isDerived: overrides.isDerived ?? false,
    operationType: overrides.operationType ?? 'ORIGINAL',
    parentTrackVersionId: overrides.parentTrackVersionId ?? null,
    segments: overrides.segments ?? [makeSegment(`segment-${trackVersionId}`, { trackVersionId })],
    plugins: overrides.plugins ?? [],
  };
}

test('applyTrackRename renames only the matching track', () => {
  const tracks = [
    makeTrack('track-version-1', { trackId: 'track-a', trackName: 'Track A' }),
    makeTrack('track-version-2', { trackId: 'track-b', trackName: 'Track B' }),
  ];

  const renamed = applyTrackRename(tracks, 'track-a', 'New name');

  assert.equal(renamed[0]?.trackName, 'New name');
  assert.equal(renamed[0]?.trackId, 'track-a');
  assert.equal(renamed[0]?.trackVersionId, 'track-version-1');
  assert.equal(renamed[1]?.trackName, 'Track B');
  assert.equal(tracks[0]?.trackName, 'Track A');
});

test('applySegmentMove rehomes a clip and stays idempotent on replay', () => {
  const tracks = [
    makeTrack('track-version-a', {
      trackId: 'track-a',
      trackName: 'Track A',
      segments: [makeSegment('segment-1', { trackVersionId: 'track-version-a', position: 0 })],
    }),
    makeTrack('track-version-b', {
      trackId: 'track-b',
      trackName: 'Track B',
      segments: [],
    }),
  ];

  const moved = applySegmentMove(tracks, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });
  const movedAgain = applySegmentMove(moved, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });

  const sourceTrack = movedAgain.find((track) => track.trackVersionId === 'track-version-a');
  const targetTrack = movedAgain.find((track) => track.trackVersionId === 'track-version-b');
  const movedSegment = targetTrack?.segments.find((segment) => segment.id === 'segment-1');

  assert.ok(sourceTrack);
  assert.ok(targetTrack);
  assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), false);
  assert.equal(targetTrack?.segments.length, 1);
  assert.equal(movedSegment?.timelineStartMs, 3500);
  assert.equal(movedSegment?.timelineEndMs, 4300);
});

test('applySegmentMove replaces an implicit clip with its accepted stable ID and leaves the source empty', () => {
  const tracks = [
    makeTrack('track-version-a', {
      segments: [],
      segmentsInitialized: false,
      storageKey: '/api/daw/track-versions/track-version-a/audio',
    }),
    makeTrack('track-version-b', {
      segments: [],
      segmentsInitialized: false,
    }),
  ];

  const moved = applySegmentMove(tracks, {
    segmentId: 'segment-materialized',
    previousSegmentId: 'implicit:track-version-a',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 0,
    fromTimelineEndMs: 2400,
    toTimelineStartMs: 800,
    toTimelineEndMs: 3200,
    segment: {
      id: 'segment-materialized',
      trackVersionId: 'track-version-b',
      sourceTrackVersionId: 'track-version-a',
      sourceStorageKey: '/api/daw/track-versions/track-version-a/audio',
      startMs: 0,
      endMs: 2400,
      timelineStartMs: 800,
      timelineEndMs: 3200,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
    },
  });

  assert.equal(moved[0]?.segmentsInitialized, true);
  assert.deepEqual(moved[0]?.segments, []);
  assert.equal(moved[1]?.segmentsInitialized, true);
  assert.equal(moved[1]?.segments[0]?.id, 'segment-materialized');
  assert.equal(moved[1]?.segments[0]?.sourceTrackVersionId, 'track-version-a');
  assert.equal(
    moved[1]?.segments[0]?.sourceStorageKey,
    '/api/daw/track-versions/track-version-a/audio',
  );
});

test('applySegmentTrim and applySegmentFadeSet update only the target clip', () => {
  const segmentA = makeSegment('segment-a', {
    trackVersionId: 'track-version-1',
    timelineStartMs: 1000,
    timelineEndMs: 1800,
    startMs: 200,
    endMs: 1000,
    sourceStartMs: 200,
    sourceEndMs: 1000,
    durationMs: 800,
    position: 0,
    fadeInMs: 10,
    fadeOutMs: 20,
  });
  const segmentB = makeSegment('segment-b', {
    trackVersionId: 'track-version-1',
    timelineStartMs: 2000,
    timelineEndMs: 3000,
    position: 1,
    fadeInMs: 30,
    fadeOutMs: 40,
  });
  const tracks = [makeTrack('track-version-1', { segments: [segmentA, segmentB] })];

  const trimmed = applySegmentTrim(tracks, 'track-version-1', 'segment-a', 250, 900);
  const faded = applySegmentFadeSet(trimmed, 'track-version-1', 'segment-a', 150, 250);

  assert.equal(faded[0]?.segments[0]?.startMs, 250);
  assert.equal(faded[0]?.segments[0]?.endMs, 900);
  assert.equal(faded[0]?.segments[0]?.durationMs, 650);
  assert.equal(faded[0]?.segments[0]?.timelineEndMs, 1650);
  assert.equal(faded[0]?.segments[0]?.fadeInMs, 150);
  assert.equal(faded[0]?.segments[0]?.fadeOutMs, 250);
  assert.deepEqual(faded[0]?.segments[1], segmentB);
});

test('applySegmentSplit and applySegmentMerge produce deterministic replay-safe layouts', () => {
  const sourceSegment = makeSegment('segment-source', {
    trackVersionId: 'track-version-1',
    timelineStartMs: 0,
    timelineEndMs: 1000,
    startMs: 0,
    endMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    durationMs: 1000,
    position: 0,
  });
  const tracks = [makeTrack('track-version-1', { segments: [sourceSegment] })];

  const splitOnce = applySegmentSplit(
    tracks,
    'track-version-1',
    {
      id: 'segment-left',
      trackVersionId: 'track-version-1',
      startMs: 0,
      endMs: 500,
      timelineStartMs: 0,
      timelineEndMs: 500,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
    },
    {
      id: 'segment-right',
      trackVersionId: 'track-version-1',
      startMs: 500,
      endMs: 1000,
      timelineStartMs: 500,
      timelineEndMs: 1000,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 1,
    },
    'segment-source',
  );
  const splitTwice = applySegmentSplit(
    splitOnce,
    'track-version-1',
    {
      id: 'segment-left',
      trackVersionId: 'track-version-1',
      startMs: 0,
      endMs: 500,
      timelineStartMs: 0,
      timelineEndMs: 500,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
    },
    {
      id: 'segment-right',
      trackVersionId: 'track-version-1',
      startMs: 500,
      endMs: 1000,
      timelineStartMs: 500,
      timelineEndMs: 1000,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 1,
    },
    'segment-source',
  );

  const merged = applySegmentMerge(splitTwice, 'track-version-1', ['segment-left', 'segment-right'], {
    id: 'segment-merged',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
  });
  const mergedAgain = applySegmentMerge(merged, 'track-version-1', ['segment-left', 'segment-right'], {
    id: 'segment-merged',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
  });

  assert.deepEqual(
    mergedAgain[0]?.segments.map((segment) => segment.id),
    ['segment-merged'],
  );
  assert.equal(mergedAgain[0]?.segments[0]?.sourceStartMs, 0);
  assert.equal(mergedAgain[0]?.segments[0]?.sourceEndMs, 1000);
});

test('applyCrossfadeSet updates only the selected neighbors and the dispatcher routes timeline edits', () => {
  const segmentA = makeSegment('segment-a', {
    trackVersionId: 'track-version-1',
    position: 0,
    crossfadeInMs: 5,
    crossfadeOutMs: null,
  });
  const segmentB = makeSegment('segment-b', {
    trackVersionId: 'track-version-1',
    position: 1,
    crossfadeInMs: null,
    crossfadeOutMs: 6,
  });
  const tracks = [makeTrack('track-version-1', { segments: [segmentA, segmentB] })];

  const crossfaded = applyCrossfadeSet(
    tracks,
    'track-version-1',
    'segment-a',
    'segment-b',
    250,
    250,
    'linear',
  );
  const dispatched = applyTimelineEditOperation([makeTrack('track-version-rename', { trackId: 'track-a', trackName: 'Track A' })], {
    id: 'op-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    type: 'TRACK_RENAMED',
    createdAt: '2025-01-01T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: null,
    baseOperationSeq: 0,
    operationSeq: 1,
    payload: {
      trackId: 'track-a',
      trackName: 'Renamed via dispatcher',
    },
    idempotencyKey: 'idempotency-1',
    clientOperationId: 'client-1',
  });

  assert.equal(crossfaded[0]?.segments[0]?.crossfadeOutMs, 250);
  assert.equal(crossfaded[0]?.segments[0]?.crossfadeCurve, 'linear');
  assert.equal(crossfaded[0]?.segments[1]?.crossfadeInMs, 250);
  assert.equal(crossfaded[0]?.segments[1]?.crossfadeCurve, 'linear');
  const dispatchedTrack = dispatched[0];
  assert.ok(dispatchedTrack);
  assert.equal(dispatchedTrack.trackName, 'Renamed via dispatcher');
});
