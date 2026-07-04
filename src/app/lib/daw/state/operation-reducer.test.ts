import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawProjectBootstrapResponse, DawProjectOperationRecord } from '@git-for-music/server/app/lib/daw/protocol';
import {
  applyAcceptedProjectOperation,
  applyAcceptedProjectOperationWithoutHistory,
  applyAcceptedProjectOperations,
  createLocalProjectStateFromBootstrap,
} from '@/app/lib/daw/state/operation-reducer';
import type {
  DawTrack,
  DawVersion,
  TrackTimelineSegment,
} from '@/app/lib/daw/state/local-project-state';

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

function makeBootstrap(versions: DawVersion[], currentVersionId: string | null): DawProjectBootstrapResponse {
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
      },
      createdById: 'user-a',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    activeVersionId: currentVersionId,
    isFollowingHead: true,
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

test('VERSION_CREATED from the active head advances the active checkout when following head is enabled', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  assert.equal(initial.activeVersionId, root.id);
  assert.equal(initial.isFollowingHead, true);

  const childVersion = makeVersion('version-child', {
    label: 'Child label',
    name: 'Child label',
    branchName: 'Child label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });

  const created = applyAcceptedProjectOperation(
    initial,
    makeOperation('VERSION_CREATED', 2, {
      versionId: childVersion.id,
      parentVersionId: root.id,
      branchMode: 'continue',
      branchName: childVersion.branchName,
      label: childVersion.label,
      createdAt: childVersion.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Added audio track',
      version: childVersion,
      sourceVersionId: root.id,
    }),
  );

  assert.equal(created.versions.length, 2);
  assert.equal(created.currentVersionId, childVersion.id);
  assert.equal(created.activeVersionId, childVersion.id);
  assert.equal(created.versions[1]?.id, childVersion.id);
  assert.equal(created.versions[1]?.parentId, root.id);
  assert.equal(created.versions.find((version) => version.id === root.id)?.isCurrent, false);
  assert.equal(created.versions.find((version) => version.id === childVersion.id)?.isCurrent, true);
});

test('createLocalProjectStateFromBootstrap defaults to the newest version when the shared current version is missing', () => {
  const oldestVersion = makeVersion('version-oldest', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
    isCurrent: false,
  });
  const newestVersion = makeVersion('version-newest', {
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
    isCurrent: false,
  });

  const state = createLocalProjectStateFromBootstrap({
    ...makeBootstrap([oldestVersion, newestVersion], null),
    latestSnapshot: {
      id: 'snapshot-1',
      projectId: 'project-1',
      demoId: 'demo-1',
      operationSeq: 2,
      snapshot: {
        versions: [oldestVersion, newestVersion],
        currentVersionId: null,
        comments: [],
        annotations: [],
        tempoMetadataByTrackVersionId: {},
      },
      createdById: 'user-a',
      createdAt: '2025-01-02T00:00:00.000Z',
    },
  });

  assert.equal(state.currentVersionId, newestVersion.id);
  assert.equal(state.versions.find((version) => version.id === oldestVersion.id)?.isCurrent, false);
  assert.equal(state.versions.find((version) => version.id === newestVersion.id)?.isCurrent, true);
});

test('VERSION_BRANCH_CREATED from the active head adds the branch without moving the active checkout', () => {
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
      branchMode: 'fork',
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
  assert.equal(created.activeVersionId, root.id);
  assert.equal(created.versions[1]?.id, branchVersion.id);
  assert.equal(created.versions[1]?.parentId, root.id);
  assert.equal(created.versions.find((version) => version.id === root.id)?.isCurrent, false);
  assert.equal(created.versions.find((version) => version.id === branchVersion.id)?.isCurrent, true);
});

test('VERSION_BRANCH_CREATED from the active head advances the active checkout when branchMode is continue', () => {
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
      branchMode: 'continue',
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
  assert.equal(created.activeVersionId, branchVersion.id);
  assert.equal(created.versions[1]?.id, branchVersion.id);
  assert.equal(created.versions[1]?.parentId, root.id);
  assert.equal(created.versions.find((version) => version.id === root.id)?.isCurrent, false);
  assert.equal(created.versions.find((version) => version.id === branchVersion.id)?.isCurrent, true);
});

test('CURRENT_VERSION_CHANGED updates shared head metadata without moving the active checkout', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: false,
    operationSeq: 2,
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root, branchVersion], root.id));

  const currentChanged = applyAcceptedProjectOperation(
    initial,
    makeOperation('CURRENT_VERSION_CHANGED', 3, {
      previousVersionId: root.id,
      currentVersionId: branchVersion.id,
    }),
  );

  assert.equal(currentChanged.currentVersionId, branchVersion.id);
  assert.equal(currentChanged.activeVersionId, root.id);
  assert.equal(currentChanged.versions.find((version) => version.id === root.id)?.isCurrent, false);
  assert.equal(currentChanged.versions.find((version) => version.id === branchVersion.id)?.isCurrent, true);
});

test('VERSION_BRANCH_CREATED from the active head does not advance the active checkout when following head is disabled', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = {
    ...createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id)),
    isFollowingHead: false,
  };

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
      branchMode: 'fork',
      branchName: branchVersion.branchName,
      label: branchVersion.label,
      createdAt: branchVersion.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Added audio track',
      version: branchVersion,
      sourceVersionId: root.id,
    }),
  );

  assert.equal(created.currentVersionId, branchVersion.id);
  assert.equal(created.activeVersionId, root.id);
  assert.equal(created.versions[1]?.id, branchVersion.id);
  assert.equal(created.versions[1]?.parentId, root.id);
});

test('VERSION_NODE_ADDED on another branch updates the tree without moving the active checkout', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const activeBranch = makeVersion('version-active', {
    label: 'Active branch',
    name: 'Active branch',
    branchName: 'Active branch',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root, activeBranch], activeBranch.id));

  const branchNode = makeVersion('version-other-branch', {
    label: 'Other branch',
    name: 'Other branch',
    branchName: 'Other branch',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    isCurrent: false,
    operationSeq: 3,
  });

  const updated = applyAcceptedProjectOperation(
    initial,
    makeOperation('VERSION_NODE_ADDED', 3, {
      version: branchNode,
    }),
  );

  assert.equal(updated.versions.length, 3);
  assert.equal(updated.currentVersionId, activeBranch.id);
  assert.equal(updated.activeVersionId, activeBranch.id);
  assert.equal(updated.versions.find((version) => version.id === branchNode.id)?.parentId, root.id);
});

test('VERSION_BRANCH_CREATED on another branch updates the tree without moving the active checkout', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const activeBranch = makeVersion('version-active', {
    label: 'Active branch',
    name: 'Active branch',
    branchName: 'Active branch',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root, activeBranch], activeBranch.id));

  const branchVersion = makeVersion('version-other-branch', {
    label: 'Other branch',
    name: 'Other branch',
    branchName: 'Other branch',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 3,
  });

  const created = applyAcceptedProjectOperation(
    initial,
    makeOperation('VERSION_BRANCH_CREATED', 3, {
      versionId: branchVersion.id,
      parentVersionId: root.id,
      branchMode: 'fork',
      branchName: branchVersion.branchName,
      label: branchVersion.label,
      createdAt: branchVersion.createdAt,
      createdBy: 'user-c',
      operationSummary: 'Created a branch elsewhere',
      version: branchVersion,
      sourceVersionId: root.id,
    }),
  );

  assert.equal(created.versions.length, 3);
  assert.equal(created.currentVersionId, branchVersion.id);
  assert.equal(created.activeVersionId, activeBranch.id);
  assert.equal(created.versions.find((version) => version.id === branchVersion.id)?.parentId, root.id);
});

test('VERSION_REVERTED_FROM on the active head inserts the revert node and advances the checkout', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const ancestor = makeVersion('version-ancestor', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });
  const head = makeVersion('version-head', {
    parentId: ancestor.id,
    parentVersionId: ancestor.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    operationSeq: 3,
    isCurrent: true,
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root, ancestor, head], head.id));

  const revertVersion = makeVersion('version-revert', {
    label: 'Revert to root',
    name: 'Revert to root',
    branchName: 'Revert to root',
    parentId: head.id,
    parentVersionId: head.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 3,
  });

  const created = applyAcceptedProjectOperation(
    initial,
    makeOperation('VERSION_REVERTED_FROM', 3, {
      versionId: revertVersion.id,
      revertedFromVersionId: root.id,
      currentVersionId: revertVersion.id,
      branchMode: 'continue',
      version: revertVersion,
    }),
  );

  assert.equal(created.versions.length, 4);
  assert.equal(created.currentVersionId, revertVersion.id);
  assert.equal(created.activeVersionId, revertVersion.id);
  assert.equal(created.versions.find((version) => version.id === revertVersion.id)?.parentId, head.id);
  assert.equal(created.versions.find((version) => version.id === root.id)?.isCurrent, false);
  assert.equal(created.versions.find((version) => version.id === ancestor.id)?.parentId, root.id);
  assert.equal(created.versions.find((version) => version.id === head.id)?.parentId, ancestor.id);
});

test('bootstrap keeps shared current version separate from active checkout', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  const bootstrap = makeBootstrap([root, branch], root.id);
  bootstrap.activeVersionId = branch.id;
  bootstrap.isFollowingHead = false;

  const initial = createLocalProjectStateFromBootstrap(bootstrap);

  assert.equal(initial.currentVersionId, root.id);
  assert.equal(initial.activeVersionId, branch.id);
  assert.equal(initial.isFollowingHead, false);
  assert.equal(initial.versions.find((version) => version.id === root.id)?.isCurrent, true);
  assert.equal(initial.versions.find((version) => version.id === branch.id)?.isCurrent, false);
});

test('active version stays pinned when following head is disabled', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branchVersion = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: false,
    operationSeq: 2,
  });
  const initial = {
    ...createLocalProjectStateFromBootstrap(makeBootstrap([root, branchVersion], root.id)),
    isFollowingHead: false,
    activeVersionId: root.id,
  };

  const updated = applyAcceptedProjectOperation(
    initial,
    makeOperation('CURRENT_VERSION_CHANGED', 2, {
      previousVersionId: root.id,
      currentVersionId: branchVersion.id,
    }),
  );

  assert.equal(updated.currentVersionId, branchVersion.id);
  assert.equal(updated.activeVersionId, root.id);
  assert.equal(updated.versions.find((version) => version.id === branchVersion.id)?.isCurrent, true);
  assert.equal(updated.versions.find((version) => version.id === root.id)?.isCurrent, false);
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
    branchMode: 'fork',
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
    branchMode: 'continue',
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

test('TRACK_VERSION_CREATED replaces the copied track entry when it targets an existing trackId', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-root', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });
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
    tracks: [
      makeTrack('track-version-root-clone', {
        trackId: 'track-1',
        trackName: 'Track 1',
      }),
    ],
  });

  const versionCreated = makeOperation('VERSION_BRANCH_CREATED', 2, {
    versionId: branchVersion.id,
    parentVersionId: root.id,
    branchMode: 'continue',
    branchName: branchVersion.branchName,
    label: branchVersion.label,
    createdAt: branchVersion.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branchVersion,
    sourceVersionId: root.id,
  });

  const track = makeTrack('track-version-new', {
    trackId: 'track-1',
    trackName: 'Track 1',
  });

  const trackCreated = makeOperation('TRACK_VERSION_CREATED', 3, {
    versionId: branchVersion.id,
    trackId: track.trackId,
    trackVersionId: track.trackVersionId,
    operationSummary: 'Added audio track',
    track,
  });

  const applied = applyAcceptedProjectOperations(initial, [versionCreated, trackCreated]);
  const version = applied.versions.find((candidate) => candidate.id === branchVersion.id);

  assert.ok(version);
  assert.equal(version?.tracks.length, 1);
  assert.equal(version?.tracks[0]?.trackId, 'track-1');
  assert.equal(version?.tracks[0]?.trackVersionId, track.trackVersionId);
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
    branchMode: 'continue',
    branchName: branchVersion.branchName,
    label: branchVersion.label,
    createdAt: branchVersion.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branchVersion,
    sourceVersionId: root.id,
  });

  const applied = applyAcceptedProjectOperations(initial, [versionCreated, trackCreated]);
  const version = applied.versions.find((candidate) => candidate.id === branchVersion.id);

  assert.ok(version);
  assert.equal(version?.tracks.length, 1);
  assert.equal(version?.tracks[0]?.trackVersionId, track.trackVersionId);
});

test('TRACK_VERSION_CREATED preserves the recorded segment on the track version', () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const recordedSegment: TrackTimelineSegment = {
    id: 'segment-recorded',
    trackVersionId: 'track-version-recorded',
    sourceStartMs: 0,
    sourceEndMs: 1750,
    timelineStartMs: 250,
    timelineEndMs: 2000,
    durationMs: 1750,
    startMs: 0,
    endMs: 1750,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const recordedTrack = makeTrack('track-version-recorded', {
    trackId: 'track-recorded',
    trackName: 'Recorded track',
    segments: [recordedSegment],
  });

  const trackCreated = makeOperation('TRACK_VERSION_CREATED', 2, {
    versionId: root.id,
    trackId: recordedTrack.trackId,
    trackVersionId: recordedTrack.trackVersionId,
    operationSummary: 'Added recording',
    track: recordedTrack,
  });

  const applied = applyAcceptedProjectOperation(initial, trackCreated);
  const version = applied.versions.find((candidate) => candidate.id === root.id);
  const createdTrack = version?.tracks.find((candidate) => candidate.trackVersionId === recordedTrack.trackVersionId);

  assert.ok(createdTrack);
  assert.equal(createdTrack?.segments.length, 1);
  assert.equal(createdTrack?.segments[0]?.id, recordedSegment.id);
  assert.equal(createdTrack?.segments[0]?.timelineStartMs, recordedSegment.timelineStartMs);
  assert.equal(createdTrack?.segments[0]?.sourceEndMs, recordedSegment.sourceEndMs);
});

test('TRACK_OFFSET_UPDATED updates the track placement in place', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        startOffsetMs: 0,
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const update = makeOperation('TRACK_OFFSET_UPDATED', 2, {
    trackVersionId: 'track-version-1',
    startOffsetMs: 2450,
  });

  const applied = applyAcceptedProjectOperation(initial, update);
  const updatedTrack = applied.versions[0]?.tracks[0];

  assert.ok(updatedTrack);
  assert.equal(updatedTrack?.trackVersionId, 'track-version-1');
  assert.equal(updatedTrack?.startOffsetMs, 2450);
  assert.equal(applied.versions.length, 1);
  assert.equal(applied.operationHistory.length, 0);

  const appliedTwice = applyAcceptedProjectOperation(applied, update);
  assert.equal(appliedTwice.versions[0]?.tracks[0]?.startOffsetMs, 2450);
  assert.equal(appliedTwice.operationHistory.length, 0);
});

test('SEGMENT_MOVED within the same track persists the exact timeline placement', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [
          {
            id: 'segment-1',
            trackVersionId: 'track-version-1',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
        ],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const move = makeOperation('SEGMENT_MOVED', 2, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-1',
    toTrackVersionId: 'track-version-1',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 2450,
    toTimelineEndMs: 3250,
  });

  const applied = applyAcceptedProjectOperation(initial, move);
  const segment = applied.versions[0]?.tracks[0]?.segments[0];

  assert.ok(segment);
  assert.equal(segment?.trackVersionId, 'track-version-1');
  assert.equal(segment?.timelineStartMs, 2450);
  assert.equal(segment?.timelineEndMs, 3250);
  assert.equal(segment?.startMs, 100);
  assert.equal(segment?.endMs, 900);
  assert.equal(applied.operationHistory.length, 1);

  const appliedTwice = applyAcceptedProjectOperation(applied, move);
  const movedAgain = appliedTwice.versions[0]?.tracks[0]?.segments[0];
  assert.ok(movedAgain);
  assert.equal(movedAgain?.timelineStartMs, 2450);
  assert.equal(movedAgain?.timelineEndMs, 3250);
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('SEGMENT_MOVED across tracks rehomes the segment without changing its source audio region', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [
          {
            id: 'segment-1',
            trackVersionId: 'track-version-a',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
          {
            id: 'segment-2',
            trackVersionId: 'track-version-a',
            sourceStartMs: 900,
            sourceEndMs: 1600,
            timelineStartMs: 2050,
            timelineEndMs: 2750,
            durationMs: 700,
            startMs: 900,
            endMs: 1600,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 1,
            isImplicit: false,
          },
        ],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const move = makeOperation('SEGMENT_MOVED', 2, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });

  const applied = applyAcceptedProjectOperation(initial, move);
  const sourceTrack = applied.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
  const targetTrack = applied.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');
  const movedSegment = targetTrack?.segments.find((segment) => segment.id === 'segment-1');

  assert.ok(sourceTrack);
  assert.ok(targetTrack);
  assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), false);
  assert.equal(sourceTrack?.segments[0]?.id, 'segment-2');
  assert.equal(sourceTrack?.segments[0]?.position, 0);
  assert.ok(movedSegment);
  assert.equal(movedSegment?.trackVersionId, 'track-version-b');
  assert.equal(movedSegment?.timelineStartMs, 3500);
  assert.equal(movedSegment?.timelineEndMs, 4300);
  assert.equal(movedSegment?.startMs, 100);
  assert.equal(movedSegment?.endMs, 900);
  assert.equal(movedSegment?.position, 0);
  assert.equal(applied.operationHistory.length, 1);

  const appliedTwice = applyAcceptedProjectOperation(applied, move);
  const movedAgain = appliedTwice.versions[0]?.tracks
    .find((track) => track.trackVersionId === 'track-version-b')
    ?.segments.find((segment) => segment.id === 'segment-1');
  assert.ok(movedAgain);
  assert.equal(movedAgain?.trackVersionId, 'track-version-b');
  assert.equal(movedAgain?.timelineStartMs, 3500);
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('independent concurrent timeline edits converge to the same reducer state in either order', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [
          {
            id: 'segment-a',
            trackVersionId: 'track-version-a',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
          {
            id: 'segment-b',
            trackVersionId: 'track-version-a',
            sourceStartMs: 900,
            sourceEndMs: 1500,
            timelineStartMs: 2100,
            timelineEndMs: 2700,
            durationMs: 600,
            startMs: 900,
            endMs: 1500,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 1,
            isImplicit: false,
          },
        ],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const move = makeOperation('SEGMENT_MOVED', 2, {
    segmentId: 'segment-a',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });
  const trim = makeOperation('SEGMENT_TRIMMED', 3, {
    trackVersionId: 'track-version-a',
    segmentId: 'segment-b',
    from: { startMs: 900, endMs: 1500 },
    to: { startMs: 1000, endMs: 1400 },
  });

  const moveThenTrim = applyAcceptedProjectOperation(applyAcceptedProjectOperation(initial, move), trim);
  const trimThenMove = applyAcceptedProjectOperation(applyAcceptedProjectOperation(initial, trim), move);

  assert.deepEqual(
    {
      versions: moveThenTrim.versions,
      currentVersionId: moveThenTrim.currentVersionId,
      activeVersionId: moveThenTrim.activeVersionId,
      isFollowingHead: moveThenTrim.isFollowingHead,
    },
    {
      versions: trimThenMove.versions,
      currentVersionId: trimThenMove.currentVersionId,
      activeVersionId: trimThenMove.activeVersionId,
      isFollowingHead: trimThenMove.isFollowingHead,
    },
  );
});

test('SEGMENT_MOVED optimistic replay and accepted operation do not duplicate the clip', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [
          {
            id: 'segment-1',
            trackVersionId: 'track-version-a',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
        ],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const optimisticMove = makeOperation('SEGMENT_MOVED', 0, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });
  const optimistic = applyAcceptedProjectOperationWithoutHistory(initial, optimisticMove);
  const acceptedMove = makeOperation('SEGMENT_MOVED', 2, {
    segmentId: 'segment-1',
    fromTrackVersionId: 'track-version-a',
    toTrackVersionId: 'track-version-b',
    fromTimelineStartMs: 1200,
    fromTimelineEndMs: 2000,
    toTimelineStartMs: 3500,
    toTimelineEndMs: 4300,
  });

  const applied = applyAcceptedProjectOperation(optimistic, acceptedMove);
  const sourceTrack = applied.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
  const targetTrack = applied.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');
  const movedSegment = targetTrack?.segments.find((segment) => segment.id === 'segment-1');

  assert.ok(sourceTrack);
  assert.ok(targetTrack);
  assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), false);
  assert.equal(targetTrack?.segments.filter((segment) => segment.id === 'segment-1').length, 1);
  assert.ok(movedSegment);
  assert.equal(movedSegment?.sourceStartMs, 100);
  assert.equal(movedSegment?.sourceEndMs, 900);
  assert.equal(movedSegment?.startMs, 100);
  assert.equal(movedSegment?.endMs, 900);
  assert.equal(applied.operationHistory.length, 1);
});

test('SEGMENT_SPLIT accepted payload replaces the source clip with deterministic left and right clips', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [
          {
            id: 'segment-source',
            trackVersionId: 'track-version-1',
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
          },
        ],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const splitOperation = makeOperation('SEGMENT_SPLIT', 2, {
    trackVersionId: 'track-version-1',
    sourceSegmentId: 'segment-source',
    leftSegment: {
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
    rightSegment: {
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
  });

  const applied = applyAcceptedProjectOperation(initial, splitOperation);
  const updatedTrack = applied.versions[0]?.tracks[0];

  assert.ok(updatedTrack);
  assert.equal(updatedTrack?.segments.length, 2);
  assert.deepEqual(
    updatedTrack?.segments.map((segment) => segment.id),
    ['segment-left', 'segment-right'],
  );
  assert.equal(updatedTrack?.segments[0]?.timelineStartMs, 0);
  assert.equal(updatedTrack?.segments[1]?.timelineStartMs, 500);
  assert.equal(applied.operationHistory.length, 1);
});

test('SEGMENT_SPLIT request-shaped payload is ignored instead of crashing the accepted reducer', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [
          {
            id: 'segment-source',
            trackVersionId: 'track-version-1',
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
          },
        ],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const requestShapedSplit = makeOperation('SEGMENT_SPLIT', 2, {
    trackVersionId: 'track-version-1',
    segmentId: 'segment-source',
    segmentStartMs: 0,
    segmentEndMs: 1000,
    splitTimeMs: 500,
  }) as unknown as DawProjectOperationRecord;

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = ((...args: unknown[]) => {
    warnings.push(args);
  }) as typeof console.warn;

  try {
    const applied = applyAcceptedProjectOperation(initial, requestShapedSplit);
    const updatedTrack = applied.versions[0]?.tracks[0];

    assert.ok(updatedTrack);
    assert.equal(updatedTrack?.segments.length, 1);
    assert.equal(updatedTrack?.segments[0]?.id, 'segment-source');
    assert.equal(warnings.length > 0, true);
  } finally {
    console.warn = originalWarn;
  }
});

test('SEGMENT_MERGED replays by removing the source clips and inserting the merged clip', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [
          {
            id: 'segment-a',
            trackVersionId: 'track-version-1',
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
          },
          {
            id: 'segment-b',
            trackVersionId: 'track-version-1',
            sourceStartMs: 1000,
            sourceEndMs: 2000,
            timelineStartMs: 1000,
            timelineEndMs: 2000,
            durationMs: 1000,
            startMs: 1000,
            endMs: 2000,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 1,
            isImplicit: false,
          },
        ],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const mergedSegment = {
    id: 'segment-merged',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 2000,
    timelineStartMs: 0,
    timelineEndMs: 2000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
  };

  const applied = applyAcceptedProjectOperation(
    initial,
    makeOperation('SEGMENT_MERGED', 2, {
      trackVersionId: 'track-version-1',
      segmentIds: ['segment-a', 'segment-b'],
      mergedSegment,
    }),
  );

  const updatedTrack = applied.versions[0]?.tracks[0];
  assert.ok(updatedTrack);
  assert.equal(updatedTrack?.segments.length, 1);
  assert.deepEqual(updatedTrack?.segments[0], {
    ...mergedSegment,
    trackVersionId: 'track-version-1',
    sourceStartMs: 0,
    sourceEndMs: 2000,
    durationMs: 2000,
    isImplicit: false,
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  });
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Merged clips on Track 1');
});

test('SEGMENT_MERGED stays idempotent when the same merge is replayed twice', () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [
          {
            id: 'segment-a',
            trackVersionId: 'track-version-1',
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
          },
          {
            id: 'segment-b',
            trackVersionId: 'track-version-1',
            sourceStartMs: 1000,
            sourceEndMs: 2000,
            timelineStartMs: 1000,
            timelineEndMs: 2000,
            durationMs: 1000,
            startMs: 1000,
            endMs: 2000,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 1,
            isImplicit: false,
          },
        ],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const mergedSegment = {
    id: 'segment-merged',
    trackVersionId: 'track-version-1',
    startMs: 0,
    endMs: 2000,
    timelineStartMs: 0,
    timelineEndMs: 2000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
  };
  const operation = makeOperation('SEGMENT_MERGED', 2, {
    trackVersionId: 'track-version-1',
    segmentIds: ['segment-a', 'segment-b'],
    mergedSegment,
  });

  const optimistic = applyAcceptedProjectOperationWithoutHistory(initial, operation);
  const appliedTwice = applyAcceptedProjectOperation(optimistic, operation);

  const updatedTrack = appliedTwice.versions[0]?.tracks[0];
  assert.ok(updatedTrack);
  assert.equal(updatedTrack?.segments.length, 1);
  assert.deepEqual(updatedTrack?.segments[0], {
    ...mergedSegment,
    trackVersionId: 'track-version-1',
    sourceStartMs: 0,
    sourceEndMs: 2000,
    durationMs: 2000,
    isImplicit: false,
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  });
  assert.equal(appliedTwice.operationHistory.length, 1);
});

test('SEGMENT_FADE_SET updates only the selected segment fade metadata', () => {
  const segmentA: TrackTimelineSegment = {
    id: 'segment-a',
    trackVersionId: 'track-version-1',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 10,
    fadeOutMs: 20,
    isMuted: false,
    position: 0,
    isImplicit: false,
    crossfadeInMs: 5,
    crossfadeOutMs: 6,
    crossfadeCurve: 'linear',
  };
  const segmentB: TrackTimelineSegment = {
    id: 'segment-b',
    trackVersionId: 'track-version-1',
    sourceStartMs: 1000,
    sourceEndMs: 2000,
    timelineStartMs: 1000,
    timelineEndMs: 2000,
    durationMs: 1000,
    startMs: 1000,
    endMs: 2000,
    gainDb: 0,
    fadeInMs: 30,
    fadeOutMs: 40,
    isMuted: false,
    position: 1,
    isImplicit: false,
    crossfadeInMs: 7,
    crossfadeOutMs: 8,
    crossfadeCurve: 'equalPower',
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [segmentA, segmentB],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const applied = applyAcceptedProjectOperation(
    initial,
    makeOperation('SEGMENT_FADE_SET', 2, {
      trackVersionId: 'track-version-1',
      segmentId: 'segment-a',
      fadeInMs: 150,
      fadeOutMs: 250,
      previousFadeInMs: 10,
      previousFadeOutMs: 20,
    }),
  );

  const updatedTrack = applied.versions[0]?.tracks[0];
  assert.ok(updatedTrack);
  assert.deepEqual(updatedTrack?.segments[0], {
    ...segmentA,
    fadeInMs: 150,
    fadeOutMs: 250,
  });
  assert.deepEqual(updatedTrack?.segments[1], segmentB);
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Set fade on Track 1');
});

test('CROSSFADE_SET updates only the left and right clip crossfade metadata', () => {
  const segmentA: TrackTimelineSegment = {
    id: 'segment-a',
    trackVersionId: 'track-version-1',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 10,
    fadeOutMs: 20,
    isMuted: false,
    position: 0,
    isImplicit: false,
    crossfadeInMs: 11,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  };
  const segmentB: TrackTimelineSegment = {
    id: 'segment-b',
    trackVersionId: 'track-version-1',
    sourceStartMs: 1000,
    sourceEndMs: 2000,
    timelineStartMs: 1000,
    timelineEndMs: 2000,
    durationMs: 1000,
    startMs: 1000,
    endMs: 2000,
    gainDb: 0,
    fadeInMs: 30,
    fadeOutMs: 40,
    isMuted: false,
    position: 1,
    isImplicit: false,
    crossfadeInMs: null,
    crossfadeOutMs: 22,
    crossfadeCurve: null,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-1', {
        trackId: 'track-1',
        trackName: 'Track 1',
        segments: [segmentA, segmentB],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));

  const applied = applyAcceptedProjectOperation(
    initial,
    makeOperation('CROSSFADE_SET', 2, {
      trackVersionId: 'track-version-1',
      leftSegmentId: 'segment-a',
      rightSegmentId: 'segment-b',
      crossfadeInMs: 250,
      crossfadeOutMs: 250,
      curve: 'linear',
    }),
  );

  const updatedTrack = applied.versions[0]?.tracks[0];
  assert.ok(updatedTrack);
  assert.equal(updatedTrack?.segments.length, 2);
  assert.equal(updatedTrack?.segments[0]?.crossfadeInMs, 11);
  assert.equal(updatedTrack?.segments[0]?.crossfadeOutMs, 250);
  assert.equal(updatedTrack?.segments[0]?.crossfadeCurve, 'linear');
  assert.equal(updatedTrack?.segments[0]?.fadeInMs, 10);
  assert.equal(updatedTrack?.segments[0]?.fadeOutMs, 20);
  assert.equal(updatedTrack?.segments[1]?.crossfadeInMs, 250);
  assert.equal(updatedTrack?.segments[1]?.crossfadeOutMs, 22);
  assert.equal(updatedTrack?.segments[1]?.crossfadeCurve, 'linear');
  assert.equal(updatedTrack?.segments[1]?.fadeInMs, 30);
  assert.equal(updatedTrack?.segments[1]?.fadeOutMs, 40);
  assert.equal(applied.operationHistory.length, 1);
  assert.equal(applied.operationHistory[0]?.summary, 'Adjusted crossfade on Track 1');
});
