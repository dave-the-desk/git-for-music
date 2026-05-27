import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshotStateForDemo } from '@/features/daw/server/snapshot-builder';

test('loadSnapshotStateForDemo materializes TAKE_ADDED into recordingTakesByTrackId', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [],
      comments: [],
      annotations: [],
      recordingTakesByTrackId: {},
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const client = {
    projectSnapshot: {
      findFirst: async () => latestSnapshot,
    },
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_ADDED',
          createdAt: '2025-01-02T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          operationSeq: 2,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            assetId: 'asset-1',
            storageKey: '/assets/take-1.wav',
            name: 'Recovered take',
            trackVersionId: null,
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            recordedTempoBpm: 120,
            sourceTempoBpm: 120,
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          idempotencyKey: 'idempotency-2',
          clientOperationId: 'client-2',
        },
      ],
    },
  } as const;

  const snapshot = await loadSnapshotStateForDemo(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  const take = snapshot.recordingTakesByTrackId['track-1']?.[0];
  assert.ok(take);
  assert.equal(take?.id, 'take-1');
  assert.equal(take?.trackId, 'track-1');
  assert.equal(take?.storageKey, '/assets/take-1.wav');
  assert.equal((take as { previewUrl?: unknown }).previewUrl, undefined);
  assert.equal((take as { status?: unknown }).status, undefined);
  assert.equal(snapshot.operationHistory.length, 1);
  assert.equal(snapshot.operationHistory[0]?.summary, 'Added take: Recovered take');
});

test('loadSnapshotStateForDemo applies TAKE_DELETED durably', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [],
      comments: [],
      annotations: [],
      recordingTakesByTrackId: {
        'track-1': [
          {
            id: 'take-1',
            trackId: 'track-1',
            trackVersionId: null,
            name: 'Recovered take',
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
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
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const client = {
    projectSnapshot: {
      findFirst: async () => latestSnapshot,
    },
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_DELETED',
          createdAt: '2025-01-02T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          operationSeq: 2,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            deletedAt: '2025-01-02T00:00:00.000Z',
            deletedBy: 'user-b',
            operationSummary: 'Removed recording from Track 1',
          },
          idempotencyKey: 'idempotency-2',
          clientOperationId: 'client-2',
        },
      ],
    },
  } as const;

  const snapshot = await loadSnapshotStateForDemo(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  assert.equal(snapshot.recordingTakesByTrackId['track-1']?.length, 0);
  assert.equal(snapshot.operationHistory.length, 1);
  assert.equal(snapshot.operationHistory[0]?.summary, 'Deleted recording');
});

test('loadSnapshotStateForDemo materializes TAKE_RESTORED into recordingTakesByTrackId', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [],
      comments: [],
      annotations: [],
      recordingTakesByTrackId: {
        'track-1': [],
      },
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const client = {
    projectSnapshot: {
      findFirst: async () => latestSnapshot,
    },
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_RESTORED',
          createdAt: '2025-01-02T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          operationSeq: 2,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            assetId: 'asset-1',
            storageKey: '/assets/take-1.wav',
            name: 'Recovered take',
            trackVersionId: null,
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
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
          },
          idempotencyKey: 'idempotency-2',
          clientOperationId: 'client-2',
        },
      ],
    },
  } as const;

  const snapshot = await loadSnapshotStateForDemo(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  const take = snapshot.recordingTakesByTrackId['track-1']?.[0];
  assert.ok(take);
  assert.equal(take?.id, 'take-1');
  assert.equal(take?.storageKey, '/assets/take-1.wav');
  assert.equal(snapshot.operationHistory.length, 1);
  assert.equal(snapshot.operationHistory[0]?.summary, 'Restored recording');
});

test('TAKE_ADDED then TAKE_DELETED then TAKE_RESTORED keeps the take visible after replay', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [],
      comments: [],
      annotations: [],
      recordingTakesByTrackId: {},
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const client = {
    projectSnapshot: {
      findFirst: async () => latestSnapshot,
    },
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_ADDED',
          createdAt: '2025-01-02T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          operationSeq: 2,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            assetId: 'asset-1',
            storageKey: '/assets/take-1.wav',
            name: 'Recovered take',
            trackVersionId: null,
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            recordedTempoBpm: 120,
            sourceTempoBpm: 120,
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          idempotencyKey: 'idempotency-2',
          clientOperationId: 'client-2',
        },
        {
          id: 'op-3',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_DELETED',
          createdAt: '2025-01-03T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 2,
          operationSeq: 3,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            deletedAt: '2025-01-03T00:00:00.000Z',
            deletedBy: 'user-b',
            operationSummary: 'Removed recording from Track 1',
          },
          idempotencyKey: 'idempotency-3',
          clientOperationId: 'client-3',
        },
        {
          id: 'op-4',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'TAKE_RESTORED',
          createdAt: '2025-01-04T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 3,
          operationSeq: 4,
          payload: {
            trackId: 'track-1',
            takeId: 'take-1',
            assetId: 'asset-1',
            storageKey: '/assets/take-1.wav',
            name: 'Recovered take',
            trackVersionId: null,
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            recordedTempoBpm: 120,
            sourceTempoBpm: 120,
            createdAt: '2025-01-02T00:00:00.000Z',
            restoredAt: '2025-01-04T00:00:00.000Z',
            restoredBy: 'user-b',
            operationSummary: 'Restored recording',
          },
          idempotencyKey: 'idempotency-4',
          clientOperationId: 'client-4',
        },
      ],
    },
  } as const;

  const snapshot = await loadSnapshotStateForDemo(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  assert.equal(snapshot.recordingTakesByTrackId['track-1']?.length, 1);
  assert.equal(snapshot.recordingTakesByTrackId['track-1']?.[0]?.id, 'take-1');
});
