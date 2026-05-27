import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawProjectBootstrapResponse, DawProjectOperationRecord } from '@/features/daw/protocol';
import { dawLocalCache } from '@/features/daw/engine/daw-local-cache';
import { ProjectSyncEngine } from '@/features/daw/engine/project-sync-engine';
import { createLocalProjectStateFromBootstrap } from '@/features/daw/state/operation-reducer';
import type { DawVersion } from '@/features/daw/state/local-project-state';

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

test('ProjectSyncEngine applies remote accepted_operation updates once', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
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

    const operation = makeOperation('VERSION_BRANCH_CREATED', 2, {
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

    await engine.receiveAcceptedRemoteOperations([operation]);

    const appliedState = engine.getState().projectState;
    assert.ok(appliedState);
    assert.equal(appliedState?.versions.length, 2);
    assert.equal(appliedState?.currentVersionId, branchVersion.id);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);

    await engine.receiveAcceptedRemoteOperations([operation]);
    const duplicateState = engine.getState().projectState;
    assert.equal(duplicateState?.versions.length, 2);
    assert.equal(duplicateState?.lastSeenOperationSeq, 2);
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test('ProjectSyncEngine applies remote TAKE_DELETED updates once', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: {
        ...initial,
        recordingTakesByTrackId: {
          'track-1': [
            {
              id: 'take-delete',
              trackId: 'track-1',
              trackVersionId: null,
              name: 'Delete me',
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
              storageKey: '/assets/take-delete.wav',
              assetId: 'asset-delete',
              previewUrl: null,
              recordedTempoBpm: null,
              sourceTempoBpm: null,
              status: 'complete',
              syncStatus: 'complete',
              createdAt: '2025-01-01T00:00:00.000Z',
            },
          ],
        },
      },
      lastSyncedOperationSeq: 1,
    };

    const operation = makeOperation('TAKE_DELETED', 2, {
      trackId: 'track-1',
      takeId: 'take-delete',
      deletedAt: '2025-01-02T00:00:00.000Z',
      deletedBy: 'user-b',
      operationSummary: 'Removed recording from Track 1',
    });

    await engine.receiveAcceptedRemoteOperations([operation]);

    const appliedState = engine.getState().projectState;
    assert.ok(appliedState);
    assert.equal(appliedState?.recordingTakesByTrackId['track-1']?.length, 0);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(appliedState?.operationHistory.length, 1);
    assert.equal(appliedState?.operationHistory[0]?.summary, 'Deleted recording');

    await engine.receiveAcceptedRemoteOperations([operation]);
    const duplicateState = engine.getState().projectState;
    assert.equal(duplicateState?.recordingTakesByTrackId['track-1']?.length, 0);
    assert.equal(duplicateState?.lastSeenOperationSeq, 2);
    assert.equal(duplicateState?.operationHistory.length, 1);
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test('ProjectSyncEngine applies remote TAKE_RESTORED updates once', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: {
        ...initial,
        recordingTakesByTrackId: {
          'track-1': [],
        },
      },
      lastSyncedOperationSeq: 1,
    };

    const operation = makeOperation('TAKE_RESTORED', 2, {
      trackId: 'track-1',
      takeId: 'take-restore',
      assetId: 'asset-restore',
      storageKey: '/assets/take-restore.wav',
      name: 'Restored take',
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

    await engine.receiveAcceptedRemoteOperations([operation]);

    const appliedState = engine.getState().projectState;
    assert.ok(appliedState);
    assert.equal(appliedState?.recordingTakesByTrackId['track-1']?.length, 1);
    assert.equal(appliedState?.recordingTakesByTrackId['track-1']?.[0]?.id, 'take-restore');
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(appliedState?.operationHistory.length, 1);
    assert.equal(appliedState?.operationHistory[0]?.summary, 'Restored recording');

    await engine.receiveAcceptedRemoteOperations([operation]);
    const duplicateState = engine.getState().projectState;
    assert.equal(duplicateState?.recordingTakesByTrackId['track-1']?.length, 1);
    assert.equal(duplicateState?.lastSeenOperationSeq, 2);
    assert.equal(duplicateState?.operationHistory.length, 1);
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});
