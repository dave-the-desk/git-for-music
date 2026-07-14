import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawTrack, DawVersion, LocalProjectState, TrackTimelineSegment } from './local-project-state';
import { rebaseTimelineEditRequest } from './timeline-edit-rebase';

function makeSegment(id: string, overrides: Partial<TrackTimelineSegment> = {}): TrackTimelineSegment {
  return {
    id,
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    sourceStartMs: overrides.sourceStartMs ?? overrides.startMs ?? 0,
    sourceEndMs: overrides.sourceEndMs ?? overrides.endMs ?? 1000,
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

function makeState(versions: DawVersion[], currentVersionId: string): Pick<LocalProjectState, 'versions' | 'currentVersionId'> {
  return {
    versions,
    currentVersionId,
  };
}

test('rebases a move onto the current clip placement', () => {
  const currentVersion = makeVersion('version-head', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        segments: [makeSegment('segment-1', { trackVersionId: 'track-version-a', timelineStartMs: 3500, timelineEndMs: 4300, position: 0 })],
      }),
    ],
  });
  const state = makeState([currentVersion], currentVersion.id);

  const rebased = rebaseTimelineEditRequest(state, {
    id: 'op-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'SEGMENT_MOVED',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 5,
    operationSeq: 6,
    payload: {
      segmentId: 'segment-1',
      fromTrackVersionId: 'track-version-a',
      toTrackVersionId: 'track-version-c',
      fromTimelineStartMs: 1200,
      fromTimelineEndMs: 2000,
      toTimelineStartMs: 4500,
      toTimelineEndMs: 5300,
    },
    idempotencyKey: 'idempotency-1',
    clientOperationId: 'client-1',
  });

  assert.ok(rebased);
  const rebasedPayload = rebased.payload as {
    fromTrackVersionId: string;
    fromTimelineStartMs: number;
    fromTimelineEndMs: number;
    toTrackVersionId: string;
    toTimelineStartMs: number;
  };
  assert.equal(rebasedPayload.fromTrackVersionId, 'track-version-a');
  assert.equal(rebasedPayload.fromTimelineStartMs, 3500);
  assert.equal(rebasedPayload.fromTimelineEndMs, 4300);
  assert.equal(rebasedPayload.toTrackVersionId, 'track-version-c');
  assert.equal(rebasedPayload.toTimelineStartMs, 4500);
});

test('rebases a trim by composing the delta onto the current source bounds', () => {
  const currentVersion = makeVersion('version-head', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        segments: [makeSegment('segment-1', { startMs: 100, endMs: 900, sourceStartMs: 100, sourceEndMs: 900 })],
      }),
    ],
  });
  const state = makeState([currentVersion], currentVersion.id);

  const rebased = rebaseTimelineEditRequest(state, {
    id: 'op-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'SEGMENT_TRIMMED',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 5,
    operationSeq: 6,
    payload: {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-1',
      from: { startMs: 0, endMs: 1000 },
      to: { startMs: 150, endMs: 850 },
    },
    idempotencyKey: 'idempotency-2',
    clientOperationId: 'client-2',
  });

  assert.ok(rebased);
  const rebasedPayload = rebased.payload as {
    from: { startMs: number; endMs: number };
    to: { startMs: number; endMs: number };
  };
  assert.deepEqual(rebasedPayload.from, { startMs: 100, endMs: 900 });
  assert.deepEqual(rebasedPayload.to, { startMs: 250, endMs: 750 });
});

test('rebases a split against the current clip bounds and split offset', () => {
  const currentVersion = makeVersion('version-head', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        segments: [makeSegment('segment-1', { startMs: 100, endMs: 900, sourceStartMs: 100, sourceEndMs: 900 })],
      }),
    ],
  });
  const state = makeState([currentVersion], currentVersion.id);

  const rebased = rebaseTimelineEditRequest(state, {
    id: 'op-3',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'SEGMENT_SPLIT',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 5,
    operationSeq: 6,
    payload: {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-1',
      segmentStartMs: 0,
      segmentEndMs: 1000,
      splitTimeMs: 500,
    },
    idempotencyKey: 'idempotency-3',
    clientOperationId: 'client-3',
  });

  assert.ok(rebased);
  const rebasedPayload = rebased.payload as {
    segmentStartMs: number;
    segmentEndMs: number;
    splitTimeMs: number;
  };
  assert.equal(rebasedPayload.segmentStartMs, 100);
  assert.equal(rebasedPayload.segmentEndMs, 900);
  assert.equal(rebasedPayload.splitTimeMs, 600);
});

test('rebases a merge using the current neighboring clips', () => {
  const currentVersion = makeVersion('version-head', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        segments: [
          makeSegment('segment-a', { timelineStartMs: 0, timelineEndMs: 1000, startMs: 0, endMs: 1000, position: 0 }),
          makeSegment('segment-b', { timelineStartMs: 1000, timelineEndMs: 2000, startMs: 1000, endMs: 2000, position: 1 }),
        ],
      }),
    ],
  });
  const state = makeState([currentVersion], currentVersion.id);

  const rebased = rebaseTimelineEditRequest(state, {
    id: 'op-4',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'SEGMENT_MERGED',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 5,
    operationSeq: 6,
    payload: {
      trackVersionId: 'track-version-a',
      segmentIds: ['segment-a', 'segment-b'],
      mergedSegment: {
        id: 'segment-merged',
        trackVersionId: 'track-version-a',
        startMs: 0,
        endMs: 2000,
        timelineStartMs: 0,
        timelineEndMs: 2000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    },
    idempotencyKey: 'idempotency-4',
    clientOperationId: 'client-4',
  });

  assert.ok(rebased);
  const rebasedPayload = rebased.payload as {
    trackVersionId: string;
    mergedSegment: { timelineStartMs: number; timelineEndMs: number };
  };
  assert.equal(rebasedPayload.trackVersionId, 'track-version-a');
  assert.equal(rebasedPayload.mergedSegment.timelineStartMs, 0);
  assert.equal(rebasedPayload.mergedSegment.timelineEndMs, 2000);
});

test('rebases a crossfade only when both clips still share the same track', () => {
  const currentVersion = makeVersion('version-head', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        segments: [
          makeSegment('segment-a', { timelineStartMs: 0, timelineEndMs: 1000, startMs: 0, endMs: 1000, position: 0 }),
          makeSegment('segment-b', { timelineStartMs: 1000, timelineEndMs: 2000, startMs: 1000, endMs: 2000, position: 1 }),
        ],
      }),
    ],
  });
  const state = makeState([currentVersion], currentVersion.id);

  const rebased = rebaseTimelineEditRequest(state, {
    id: 'op-5',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'CROSSFADE_SET',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 5,
    operationSeq: 6,
    payload: {
      trackVersionId: 'track-version-a',
      leftSegmentId: 'segment-a',
      rightSegmentId: 'segment-b',
      crossfadeInMs: 250,
      crossfadeOutMs: 250,
      curve: 'linear',
    },
    idempotencyKey: 'idempotency-5',
    clientOperationId: 'client-5',
  });

  assert.ok(rebased);
  const rebasedPayload = rebased.payload as {
    trackVersionId: string;
    leftSegmentId: string;
  };
  assert.equal(rebasedPayload.trackVersionId, 'track-version-a');
  assert.equal(rebasedPayload.leftSegmentId, 'segment-a');
});
