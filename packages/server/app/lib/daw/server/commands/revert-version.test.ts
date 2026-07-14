import test from 'node:test';
import assert from 'node:assert/strict';
import { revertToVersionCommand } from './revert-version';

type VersionArgs = {
  parentId?: string | null;
  sourceVersionId?: string | null;
  kind?: string;
};

type RecordedOperationArgs = {
  operationType?: string;
  payload?: any;
};

test('revertToVersionCommand creates a revert version from the current branch head', async () => {
  const sourceTracks = [
    {
      id: 'track-version-ancestor',
      trackVersionId: 'track-version-ancestor',
    },
  ];
  let createVersionArgs: VersionArgs | null = null;
  let setActiveVersionArgs: { versionId?: string } | null = null;
  let recordedOperationArgs: RecordedOperationArgs | null = null;
  let emittedOperationArgs: { operationType?: string } | null = null;
  let revertedArgs:
    | {
        demoId?: string;
        versionId?: string;
        parentVersionId?: string | null;
        revertedFromVersionId?: string;
        revertedToOperationId?: string | null;
        operationSeq?: number | null;
      }
    | null = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        project: {
          id: 'project-1',
        },
      }),
    },
    demoVersion: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'version-ancestor') {
          return {
            id: 'version-ancestor',
            label: 'Ancestor version',
            tracks: sourceTracks,
          };
        }

        return null;
      },
      findMany: async () => [
        {
          id: 'version-head',
          parentId: 'version-ancestor',
        },
        {
          id: 'version-ancestor',
          parentId: 'version-root',
        },
        {
          id: 'version-root',
          parentId: null,
        },
      ],
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  };

  const response = await revertToVersionCommand(
    {
      userId: 'user-1',
      demoId: 'demo-1',
      sourceVersionId: 'version-ancestor',
    },
    {
      client: client as never,
      loadOrCreateDemoUserActiveVersionState: async () => ({
        activeVersionId: 'version-head',
        isFollowingHead: true,
        activeBranchName: 'Head',
      }),
      setDemoUserActiveVersion: async (_tx, args) => {
        setActiveVersionArgs = args;
        return {
          activeVersionId: 'version-revert',
          isFollowingHead: true,
          activeBranchName: 'Revert to Ancestor version',
        };
      },
      createDemoVersionWithCopiedTracks: async (_tx, args): Promise<any> => {
        createVersionArgs = {
          parentId: args.parentId ?? null,
          sourceVersionId: args.sourceVersionId ?? null,
          kind: args.kind ?? 'EXPLICIT',
        };
        return {
          id: 'version-revert',
          label: args.label,
          description: args.description ?? null,
          createdByName: null,
          kind: args.kind ?? 'EXPLICIT',
          operationSeq: null,
          tempoBpm: 120,
          timeSignatureNum: 4,
          timeSignatureDen: 4,
          musicalKey: null,
          tempoSource: 'MANUAL',
          keySource: 'MANUAL',
          isMerge: false,
          createdAt: new Date('2026-07-04T00:00:00.000Z'),
          parentId: args.parentId ?? null,
          tracks: structuredClone(sourceTracks),
          cloneMap: {
            trackVersionIdMap: new Map<string, string>(),
            segmentIdMap: new Map<string, string>(),
            tracks: [],
          },
        };
      },
      recordDemoDawOperation: async (_tx, args) => {
        recordedOperationArgs = {
          operationType: args.operationType,
          payload: args.payload,
        };
        return {
          created: true,
          id: 'operation-1',
          operationSeq: 99,
          operationType: 'VERSION_REVERTED_FROM',
          payload: args.payload,
          createdAt: '2026-07-04T00:00:00.000Z',
          baseSnapshotId: null,
          baseOperationSeq: 0,
          idempotencyKey: undefined,
          clientOperationId: undefined,
          actorUserId: 'user-1',
        };
      },
      checkpointDemoDawSnapshot: async () => ({
        id: 'snapshot-1',
        operationSeq: 100,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
      emitAcceptedDawOperation: (args) => {
        emittedOperationArgs = {
          operationType: 'operationType' in args ? args.operationType : args.operation.type,
        };
      },
      emitDawReverted: (args) => {
        revertedArgs = {
          demoId: args.demoId,
          versionId: args.versionId,
          parentVersionId: args.parentVersionId,
          revertedFromVersionId: args.revertedFromVersionId,
          revertedToOperationId: args.revertedToOperationId,
          operationSeq: args.operationSeq,
        };
      },
    },
  );

  assert.equal(response.status, 201);
  const responseJson = (await response.json()) as {
    id: string;
    label: string;
    demoId: string;
    activeVersionId: string;
    isFollowingHead: boolean;
    activeBranchName: string | null;
  };
  assert.deepEqual(responseJson, {
    id: 'version-revert',
    label: 'Revert to Ancestor version',
    demoId: 'demo-1',
    activeVersionId: 'version-revert',
    isFollowingHead: true,
    activeBranchName: 'Revert to Ancestor version',
  });
  assert.ok(createVersionArgs);
  assert.ok(setActiveVersionArgs);
  assert.ok(recordedOperationArgs);
  assert.ok(emittedOperationArgs);
  assert.ok(revertedArgs);

  const createdArgs = createVersionArgs as VersionArgs;
  const activeVersionArgs = setActiveVersionArgs as { versionId?: string };
  const operationArgs = recordedOperationArgs as RecordedOperationArgs;
  const emittedArgs = emittedOperationArgs as { operationType?: string };
  const revertedEventArgs = revertedArgs as {
    demoId?: string;
    versionId?: string;
    parentVersionId?: string | null;
    revertedFromVersionId?: string;
    revertedToOperationId?: string | null;
    operationSeq?: number | null;
  };

  assert.equal(createdArgs.parentId, 'version-head');
  assert.equal(createdArgs.sourceVersionId, 'version-ancestor');
  assert.equal(createdArgs.kind, 'REVERT');
  assert.equal(activeVersionArgs.versionId, 'version-revert');
  assert.equal(operationArgs.operationType, 'VERSION_REVERTED_FROM');
  assert.equal(operationArgs.payload?.revertedFromVersionId, 'version-ancestor');
  assert.equal(operationArgs.payload?.currentVersionId, 'version-revert');
  assert.deepEqual(operationArgs.payload?.version?.tracks, sourceTracks);
  assert.equal(emittedArgs.operationType, 'VERSION_REVERTED_FROM');
  assert.equal(revertedEventArgs.demoId, 'demo-1');
  assert.equal(revertedEventArgs.versionId, 'version-revert');
  assert.equal(revertedEventArgs.parentVersionId, 'version-head');
  assert.equal(revertedEventArgs.revertedFromVersionId, 'version-ancestor');
  assert.equal(revertedEventArgs.revertedToOperationId, 'operation-1');
  assert.equal(revertedEventArgs.operationSeq, 99);
});

test('revertToVersionCommand rejects versions that are not ancestors of the current head', async () => {
  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        project: {
          id: 'project-1',
        },
      }),
    },
    demoVersion: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'version-unrelated') {
          return {
            id: 'version-unrelated',
            label: 'Unrelated version',
          };
        }

        return null;
      },
      findMany: async () => [
        {
          id: 'version-head',
          parentId: 'version-ancestor',
        },
        {
          id: 'version-ancestor',
          parentId: 'version-root',
        },
        {
          id: 'version-root',
          parentId: null,
        },
      ],
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  };

  const response = await revertToVersionCommand(
    {
      userId: 'user-1',
      demoId: 'demo-1',
      sourceVersionId: 'version-unrelated',
    },
    {
      client: client as never,
      loadOrCreateDemoUserActiveVersionState: async () => ({
        activeVersionId: 'version-head',
        isFollowingHead: true,
        activeBranchName: 'Head',
      }),
      setDemoUserActiveVersion: async () => {
        throw new Error('should not update active version when revert is invalid');
      },
      createDemoVersionWithCopiedTracks: async () => {
        throw new Error('should not create a version when revert is invalid');
      },
      recordDemoDawOperation: async () => {
        throw new Error('should not record an operation when revert is invalid');
      },
      checkpointDemoDawSnapshot: async () => ({
        id: 'snapshot-2',
        operationSeq: 101,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
      emitAcceptedDawOperation: () => undefined,
      emitDawReverted: () => undefined,
    },
  );

  assert.equal(response.status, 400);
  const responseJson = (await response.json()) as { error: string };
  assert.deepEqual(responseJson, {
    error: 'Selected version must be an ancestor of the current branch head',
  });
});

test('revertToVersionCommand preserves a pinned checkout while still creating the revert node', async () => {
  let setActiveVersionCalled = false;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        project: {
          id: 'project-1',
        },
      }),
    },
    demoVersion: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'version-ancestor') {
          return {
            id: 'version-ancestor',
            label: 'Ancestor version',
          };
        }

        return null;
      },
      findMany: async () => [
        {
          id: 'version-head',
          parentId: 'version-ancestor',
        },
        {
          id: 'version-ancestor',
          parentId: 'version-root',
        },
        {
          id: 'version-root',
          parentId: null,
        },
      ],
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  };

  const response = await revertToVersionCommand(
    {
      userId: 'user-1',
      demoId: 'demo-1',
      sourceVersionId: 'version-ancestor',
    },
    {
      client: client as never,
      loadOrCreateDemoUserActiveVersionState: async () => ({
        activeVersionId: 'version-pinned',
        isFollowingHead: false,
        activeBranchName: 'Pinned branch',
      }),
      setDemoUserActiveVersion: async () => {
        setActiveVersionCalled = true;
        throw new Error('should not move a pinned checkout');
      },
      createDemoVersionWithCopiedTracks: async (_tx, args): Promise<any> => ({
        id: 'version-revert',
        label: args.label,
        description: args.description ?? null,
        createdByName: null,
        kind: args.kind ?? 'EXPLICIT',
        operationSeq: null,
        tempoBpm: 120,
        timeSignatureNum: 4,
        timeSignatureDen: 4,
        musicalKey: null,
        tempoSource: 'MANUAL',
        keySource: 'MANUAL',
        isMerge: false,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
        parentId: args.parentId ?? null,
        tracks: [],
        cloneMap: {
          trackVersionIdMap: new Map<string, string>(),
          segmentIdMap: new Map<string, string>(),
          tracks: [],
        },
      }),
      recordDemoDawOperation: async (_tx, args) => ({
        created: true,
        id: 'operation-1',
        operationSeq: 99,
        operationType: 'VERSION_REVERTED_FROM',
        payload: args.payload,
        createdAt: '2026-07-04T00:00:00.000Z',
        baseSnapshotId: null,
        baseOperationSeq: 0,
        idempotencyKey: undefined,
        clientOperationId: undefined,
        actorUserId: 'user-1',
      }),
      checkpointDemoDawSnapshot: async () => ({
        id: 'snapshot-3',
        operationSeq: 102,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
      emitAcceptedDawOperation: () => undefined,
      emitDawReverted: () => undefined,
    },
  );

  assert.equal(response.status, 201);
  const responseJson = (await response.json()) as {
    activeVersionId: string;
    isFollowingHead: boolean;
    activeBranchName: string | null;
  };
  assert.equal(setActiveVersionCalled, false);
  assert.equal(responseJson.activeVersionId, 'version-pinned');
  assert.equal(responseJson.isFollowingHead, false);
  assert.equal(responseJson.activeBranchName, 'Pinned branch');
});

test('revertToVersionCommand creates a revert node that copies the ancestor content exactly', async () => {
  const ancestorTracks = [
    {
      id: 'track-version-ancestor-a',
      trackVersionId: 'track-version-ancestor-a',
      trackName: 'Ancestor track A',
    },
    {
      id: 'track-version-ancestor-b',
      trackVersionId: 'track-version-ancestor-b',
      trackName: 'Ancestor track B',
    },
  ];
  let capturedPayload: RecordedOperationArgs['payload'] | null = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        project: {
          id: 'project-1',
        },
      }),
    },
    demoVersion: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'version-ancestor') {
          return {
            id: 'version-ancestor',
            label: 'Ancestor version',
          };
        }

        return null;
      },
      findMany: async () => [
        {
          id: 'version-head',
          parentId: 'version-ancestor',
        },
        {
          id: 'version-ancestor',
          parentId: 'version-root',
        },
        {
          id: 'version-root',
          parentId: null,
        },
      ],
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  };

  const response = await revertToVersionCommand(
    {
      userId: 'user-1',
      demoId: 'demo-1',
      sourceVersionId: 'version-ancestor',
    },
    {
      client: client as never,
      loadOrCreateDemoUserActiveVersionState: async () => ({
        activeVersionId: 'version-head',
        isFollowingHead: true,
        activeBranchName: 'Head',
      }),
      setDemoUserActiveVersion: async () => ({
        activeVersionId: 'version-revert',
        isFollowingHead: true,
        activeBranchName: 'Revert to Ancestor version',
      }),
      createDemoVersionWithCopiedTracks: async (_tx, args): Promise<any> => ({
        id: 'version-revert',
        label: args.label,
        description: args.description ?? null,
        createdByName: null,
        kind: args.kind ?? 'EXPLICIT',
        operationSeq: null,
        tempoBpm: 120,
        timeSignatureNum: 4,
        timeSignatureDen: 4,
        musicalKey: null,
        tempoSource: 'MANUAL',
        keySource: 'MANUAL',
        isMerge: false,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
        parentId: args.parentId ?? null,
        tracks: structuredClone(ancestorTracks),
        cloneMap: {
          trackVersionIdMap: new Map<string, string>(),
          segmentIdMap: new Map<string, string>(),
          tracks: [],
        },
      }),
      recordDemoDawOperation: async (_tx, args) => {
        capturedPayload = args.payload as RecordedOperationArgs['payload'];
        return {
          created: true,
          id: 'operation-1',
          operationSeq: 99,
          operationType: 'VERSION_REVERTED_FROM',
          payload: args.payload,
          createdAt: '2026-07-04T00:00:00.000Z',
          baseSnapshotId: null,
          baseOperationSeq: 0,
          idempotencyKey: undefined,
          clientOperationId: undefined,
          actorUserId: 'user-1',
        };
      },
      checkpointDemoDawSnapshot: async () => ({
        id: 'snapshot-4',
        operationSeq: 103,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
      emitAcceptedDawOperation: () => undefined,
      emitDawReverted: () => undefined,
    },
  );

  assert.equal(response.status, 201);
  assert.ok(capturedPayload);
  assert.deepEqual(capturedPayload?.version?.tracks, ancestorTracks);
  assert.equal(capturedPayload?.version?.parentId, 'version-head');
  assert.equal(capturedPayload?.revertedFromVersionId, 'version-ancestor');
});
