import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawProjectBootstrapResponse, DawProjectOperationRecord } from '@/features/daw/protocol';
import {
  applyAcceptedProjectOperation,
  applyAcceptedProjectOperations,
  createLocalProjectStateFromBootstrap,
} from '@/features/daw/state/operation-reducer';
import type {
  DawTrack,
  DawVersion,
  TrackRecordingTake,
  TrackTimelineSegment,
} from '@/features/daw/state/local-project-state';

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

function makeTrack(trackVersionId: string, overrides: Partial<DawTrack> = {}): DawTrack {
  const segment: TrackTimelineSegment = {
    id: overrides.segments?.[0]?.id ?? `segment-${trackVersionId}`,
    trackVersionId,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };

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
    segments: overrides.segments ?? [segment],
  };
}

function makeTake(
  takeId: string,
  trackId: string,
  overrides: Partial<TrackRecordingTake> = {},
) {
  return {
    id: takeId,
    trackId,
    trackVersionId: overrides.trackVersionId ?? null,
    name: overrides.name ?? takeId,
    startOffsetMs: overrides.startOffsetMs ?? 0,
    durationMs: overrides.durationMs ?? 1000,
    sourceStartMs: overrides.sourceStartMs ?? 0,
    sourceEndMs: overrides.sourceEndMs ?? 1000,
    timelineStartMs: overrides.timelineStartMs ?? 0,
    timelineEndMs: overrides.timelineEndMs ?? 1000,
    gainDb: overrides.gainDb ?? 0,
    fadeInMs: overrides.fadeInMs ?? 0,
    fadeOutMs: overrides.fadeOutMs ?? 0,
    isMuted: overrides.isMuted ?? false,
    position: overrides.position ?? 0,
    storageKey: overrides.storageKey ?? `/assets/${takeId}.wav`,
    assetId: overrides.assetId ?? null,
    previewUrl: overrides.previewUrl ?? null,
    recordedTempoBpm: overrides.recordedTempoBpm ?? null,
    sourceTempoBpm: overrides.sourceTempoBpm ?? null,
    status: overrides.status ?? 'complete',
    syncStatus: overrides.syncStatus ?? 'complete',
    error: overrides.error,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
  };
}

function makeBootstrap(versions: DawVersion[], currentVersionId: string): DawProjectBootstrapResponse {
  return {
    project: {
      id: 'project-1',
      slug: 'project-1',
      name: 'Project',
      description: null,
      group: {
        id: 'group-1',
        slug: 'group',
      },
      demoId: 'demo-1',
      currentVersionId,
    },
    latestSnapshot: {
      id: 'snapshot-1',
      projectId: 'project-1',
      demoId: 'demo-1',
      operationSeq: 1,
      snapshot: {
        versions,
        currentVersionId,
        comments: [],
        annotations: [],
        tempoMetadataByTrackVersionId: {},
        recordingTakesByTrackId: {},
      },
      createdById: 'user-a',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    projectState: undefined,
    operationTail: [],
    assets: [],
    pluginDefinitions: [],
    comments: [],
    annotations: [],
    presenceSeed: 'seed',
    permissions: {
      role: 'OWNER',
      canRead: true,
      canWrite: true,
      canManageProject: true,
    },
  };
}

function makeOperation(
  type: DawProjectOperationRecord['type'],
  operationSeq: number,
  payload: unknown,
): DawProjectOperationRecord {
  return {
    id: `op-${operationSeq}`,
    projectId: 'project-1',
    demoId: 'demo-1',
    type,
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-b',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    operationSeq,
    payload: payload as DawProjectOperationRecord['payload'],
    idempotencyKey: `idempotency-${operationSeq}`,
    clientOperationId: `client-${operationSeq}`,
  };
}

test('version operations update the live reducer state', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });

  const created = applyAcceptedProjectOperation(
    initial,
    makeOperation('VERSION_BRANCH_CREATED', 2, {
      versionId: branchVersion.id,
      parentVersionId: root.id,
      branchName: branchVersion.branchName,
      label: branchVersion.label,
      createdAt: branchVersion.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Added audio track',
      version: branchVersion,
      sourceVersionId: root.id,
    }),
  );

  assert.equal(created.versions.length, 2);
  assert.equal(created.currentVersionId, branchVersion.id);
  assert.equal(created.versions[1]?.id, branchVersion.id);
  assert.equal(created.versions[1]?.parentId, root.id);

  const renamed = applyAcceptedProjectOperation(
    created,
    makeOperation('VERSION_RENAMED', 3, {
      versionId: branchVersion.id,
      label: 'Renamed branch',
    }),
  );

  assert.equal(renamed.versions.find((version) => version.id === branchVersion.id)?.label, 'Renamed branch');
  assert.equal(renamed.versions.find((version) => version.id === branchVersion.id)?.name, 'Renamed branch');
  assert.equal(renamed.versions.find((version) => version.id === branchVersion.id)?.branchName, 'Renamed branch');

  const currentChanged = applyAcceptedProjectOperation(
    renamed,
    makeOperation('CURRENT_VERSION_CHANGED', 4, {
      previousVersionId: branchVersion.id,
      currentVersionId: root.id,
    }),
  );

  assert.equal(currentChanged.currentVersionId, root.id);
  assert.equal(currentChanged.versions.find((version) => version.id === root.id)?.isCurrent, true);
  assert.equal(currentChanged.versions.find((version) => version.id === branchVersion.id)?.isCurrent, false);
});

test('duplicate accepted version operations do not duplicate version nodes', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const createOp = makeOperation('VERSION_BRANCH_CREATED', 2, {
    versionId: branchVersion.id,
    parentVersionId: root.id,
    branchName: branchVersion.branchName,
    label: branchVersion.label,
    createdAt: branchVersion.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branchVersion,
    sourceVersionId: root.id,
  });

  const appliedTwice = applyAcceptedProjectOperations(initial, [createOp, createOp]);
  const versionIds = appliedTwice.versions.map((version) => version.id);

  assert.equal(versionIds.filter((id) => id === branchVersion.id).length, 1);
  assert.equal(appliedTwice.versions.length, 2);
});

test('track versions remain attached when the version is created before the track', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
    tracks: [],
  });

  const track = makeTrack('track-version-1', {
    trackId: 'track-1',
    trackName: 'Uploaded track',
  });

  const versionCreated = makeOperation('VERSION_BRANCH_CREATED', 2, {
    versionId: branchVersion.id,
    parentVersionId: root.id,
    branchName: branchVersion.branchName,
    label: branchVersion.label,
    createdAt: branchVersion.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branchVersion,
    sourceVersionId: root.id,
  });

  const trackCreated = makeOperation('TRACK_VERSION_CREATED', 3, {
    versionId: branchVersion.id,
    trackId: track.trackId,
    trackVersionId: track.trackVersionId,
    operationSummary: 'Added audio track',
    track,
  });

  const currentChanged = makeOperation('CURRENT_VERSION_CHANGED', 4, {
    previousVersionId: root.id,
    currentVersionId: branchVersion.id,
  });

  const applied = applyAcceptedProjectOperations(initial, [versionCreated, trackCreated, currentChanged]);
  const version = applied.versions.find((candidate) => candidate.id === branchVersion.id);

  assert.ok(version);
  assert.equal(version?.tracks.length, 1);
  assert.equal(version?.tracks[0]?.trackVersionId, track.trackVersionId);
  assert.equal(applied.currentVersionId, branchVersion.id);
});

test('later VERSION_BRANCH_CREATED replay preserves an already attached track', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
    tracks: [],
  });

  const track = makeTrack('track-version-1', {
    trackId: 'track-1',
    trackName: 'Uploaded track',
  });

  const trackCreated = makeOperation('TRACK_VERSION_CREATED', 2, {
    versionId: branchVersion.id,
    trackId: track.trackId,
    trackVersionId: track.trackVersionId,
    operationSummary: 'Added audio track',
    track,
  });

  const versionCreated = makeOperation('VERSION_BRANCH_CREATED', 3, {
    versionId: branchVersion.id,
    parentVersionId: root.id,
    branchName: branchVersion.branchName,
    label: branchVersion.label,
    createdAt: branchVersion.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branchVersion,
    sourceVersionId: root.id,
  });

  const applied = applyAcceptedProjectOperations(initial, [trackCreated, versionCreated]);
  const version = applied.versions.find((candidate) => candidate.id === branchVersion.id);

  assert.ok(version);
  assert.equal(version?.tracks.length, 1);
  assert.equal(version?.tracks[0]?.trackVersionId, track.trackVersionId);
});

test('TAKE_ADDED upserts a durable take without changing version state', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const existingTake = makeTake('take-existing', 'track-1', {
    name: 'Existing take',
    position: 0,
  });
  const stateWithTakes = {
    ...initial,
    recordingTakesByTrackId: {
      'track-1': [existingTake],
    },
  };

  const takeAdded = makeOperation('TAKE_ADDED', 2, {
    trackId: 'track-1',
    takeId: 'take-new',
    assetId: 'asset-1',
    storageKey: '/assets/new.wav',
    name: 'New take',
    trackVersionId: null,
    startOffsetMs: 250,
    durationMs: 1750,
    sourceStartMs: 0,
    sourceEndMs: 1750,
    timelineStartMs: 250,
    timelineEndMs: 2000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 1,
    recordedTempoBpm: 120,
    sourceTempoBpm: 120,
    createdAt: '2025-01-02T00:00:00.000Z',
  });

  const applied = applyAcceptedProjectOperation(stateWithTakes, takeAdded);
  const takes = applied.recordingTakesByTrackId['track-1'] ?? [];

  assert.equal(applied.currentVersionId, root.id);
  assert.equal(takes.length, 2);
  assert.equal(takes[0]?.id, existingTake.id);
  assert.equal(takes[1]?.id, 'take-new');
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Added recording to Track 1');

  const appliedTwice = applyAcceptedProjectOperation(applied, takeAdded);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.length, 2);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.find((take) => take.id === 'take-new')?.storageKey, '/assets/new.wav');
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('TAKE_ADDED merges same-id optimistic take state instead of duplicating it', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const optimisticTake = makeTake('take-shared', 'track-1', {
    status: 'uploading',
    syncStatus: 'uploading',
    previewUrl: 'blob:preview',
    position: 0,
  });
  const stateWithOptimistic = {
    ...initial,
    recordingTakesByTrackId: {
      'track-1': [optimisticTake],
    },
  };

  const takeAdded = makeOperation('TAKE_ADDED', 2, {
    trackId: 'track-1',
    takeId: 'take-shared',
    assetId: 'asset-2',
    storageKey: '/assets/shared.wav',
    name: 'Shared take',
    trackVersionId: null,
    startOffsetMs: 0,
    durationMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    recordedTempoBpm: 120,
    sourceTempoBpm: 120,
    createdAt: '2025-01-02T00:00:00.000Z',
  });

  const applied = applyAcceptedProjectOperation(stateWithOptimistic, takeAdded);
  const take = applied.recordingTakesByTrackId['track-1']?.find((entry) => entry.id === 'take-shared');

  assert.equal(applied.recordingTakesByTrackId['track-1']?.length, 1);
  assert.ok(take);
  assert.equal(take?.storageKey, '/assets/shared.wav');
  assert.equal(take?.status, 'complete');
  assert.equal(take?.syncStatus, 'complete');
  assert.equal(take?.previewUrl, null);
});

test('TAKE_DELETED removes only the targeted take and is idempotent', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const keepTake = makeTake('take-keep', 'track-1', { position: 0 });
  const deleteTake = makeTake('take-delete', 'track-1', { position: 1 });
  const otherTrackTake = makeTake('take-other', 'track-2', { position: 0 });
  const stateWithTakes = {
    ...initial,
    recordingTakesByTrackId: {
      'track-1': [keepTake, deleteTake],
      'track-2': [otherTrackTake],
    },
  };

  const deleted = makeOperation('TAKE_DELETED', 2, {
    trackId: 'track-1',
    takeId: 'take-delete',
    deletedAt: '2025-01-02T00:00:00.000Z',
    deletedBy: 'user-b',
    operationSummary: 'Removed recording from Track 1',
  });

  const applied = applyAcceptedProjectOperation(stateWithTakes, deleted);
  assert.equal(applied.currentVersionId, root.id);
  assert.equal(applied.recordingTakesByTrackId['track-1']?.length, 1);
  assert.equal(applied.recordingTakesByTrackId['track-1']?.[0]?.id, keepTake.id);
  assert.equal(applied.recordingTakesByTrackId['track-2']?.length, 1);
  assert.equal(applied.recordingTakesByTrackId['track-2']?.[0]?.id, otherTrackTake.id);
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Deleted recording from Track 1');

  const appliedTwice = applyAcceptedProjectOperation(applied, deleted);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.length, 1);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.[0]?.id, keepTake.id);
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('TAKE_RESTORED restores a deleted take without duplicating it', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const deletedTake = makeTake('take-restore', 'track-1', { position: 0 });
  const stateWithoutTake = {
    ...initial,
    recordingTakesByTrackId: {
      'track-1': [],
    },
  };

  const restored = makeOperation('TAKE_RESTORED', 3, {
    trackId: 'track-1',
    takeId: deletedTake.id,
    assetId: 'asset-restore',
    storageKey: deletedTake.storageKey,
    name: deletedTake.name,
    trackVersionId: deletedTake.trackVersionId,
    startOffsetMs: deletedTake.startOffsetMs,
    durationMs: deletedTake.durationMs,
    sourceStartMs: deletedTake.sourceStartMs,
    sourceEndMs: deletedTake.sourceEndMs,
    timelineStartMs: deletedTake.timelineStartMs,
    timelineEndMs: deletedTake.timelineEndMs,
    gainDb: deletedTake.gainDb,
    fadeInMs: deletedTake.fadeInMs,
    fadeOutMs: deletedTake.fadeOutMs,
    isMuted: deletedTake.isMuted,
    position: deletedTake.position,
    recordedTempoBpm: deletedTake.recordedTempoBpm,
    sourceTempoBpm: deletedTake.sourceTempoBpm,
    createdAt: deletedTake.createdAt,
    restoredAt: '2025-01-03T00:00:00.000Z',
    restoredBy: 'user-c',
    operationSummary: 'Restored recording',
  });

  const applied = applyAcceptedProjectOperation(stateWithoutTake, restored);
  const takes = applied.recordingTakesByTrackId['track-1'] ?? [];

  assert.equal(applied.currentVersionId, root.id);
  assert.equal(takes.length, 1);
  assert.equal(takes[0]?.id, deletedTake.id);
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Restored recording on Track 1');

  const appliedTwice = applyAcceptedProjectOperation(applied, restored);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.length, 1);
  assert.equal(appliedTwice.recordingTakesByTrackId['track-1']?.[0]?.id, deletedTake.id);
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('TAKE_ADDED then TAKE_DELETED then TAKE_RESTORED leaves the take present', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const takeAdded = makeOperation('TAKE_ADDED', 2, {
    trackId: 'track-1',
    takeId: 'take-flow',
    assetId: 'asset-flow',
    storageKey: '/assets/flow.wav',
    name: 'Flow take',
    trackVersionId: null,
    startOffsetMs: 0,
    durationMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    recordedTempoBpm: 120,
    sourceTempoBpm: 120,
    createdAt: '2025-01-02T00:00:00.000Z',
  });
  const takeDeleted = makeOperation('TAKE_DELETED', 3, {
    trackId: 'track-1',
    takeId: 'take-flow',
    deletedAt: '2025-01-03T00:00:00.000Z',
    deletedBy: 'user-b',
    operationSummary: 'Removed recording from Track 1',
  });
  const takeRestored = makeOperation('TAKE_RESTORED', 4, {
    trackId: 'track-1',
    takeId: 'take-flow',
    assetId: 'asset-flow',
    storageKey: '/assets/flow.wav',
    name: 'Flow take',
    trackVersionId: null,
    startOffsetMs: 0,
    durationMs: 1000,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    recordedTempoBpm: 120,
    sourceTempoBpm: 120,
    createdAt: '2025-01-02T00:00:00.000Z',
    restoredAt: '2025-01-03T00:00:00.000Z',
    restoredBy: 'user-b',
    operationSummary: 'Restored recording',
  });

  const applied = applyAcceptedProjectOperations(initial, [takeAdded, takeDeleted, takeRestored]);
  const takes = applied.recordingTakesByTrackId['track-1'] ?? [];

  assert.equal(takes.length, 1);
  assert.equal(takes[0]?.id, 'take-flow');
});

test('createLocalProjectStateFromBootstrap reconstructs durable takes into local state', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const bootstrap = makeBootstrap([root], root.id);
  bootstrap.projectState = {
    versions: [root],
    currentVersionId: root.id,
    comments: [],
    annotations: [],
    tempoMetadataByTrackVersionId: {},
    recordingTakesByTrackId: {
      'track-1': [
        {
          id: 'take-1',
          trackId: 'track-1',
          trackVersionId: null,
          name: 'Recovered take',
          startOffsetMs: 120,
          durationMs: 980,
          sourceStartMs: 0,
          sourceEndMs: 980,
          timelineStartMs: 120,
          timelineEndMs: 1100,
          gainDb: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          isMuted: false,
          position: 0,
          storageKey: '/assets/take-1.wav',
          assetId: 'asset-1',
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          createdAt: '2025-01-02T00:00:00.000Z',
        },
      ],
    },
  };

  const state = createLocalProjectStateFromBootstrap(bootstrap);
  const take = state.recordingTakesByTrackId['track-1']?.[0];

  assert.ok(take);
  assert.equal(take?.id, 'take-1');
  assert.equal(take?.status, 'complete');
  assert.equal(take?.syncStatus, 'complete');
  assert.equal(take?.previewUrl, null);
});
