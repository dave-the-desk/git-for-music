import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDawOperationConflict } from './conflict-rules';

test('analyzeDawOperationConflict reports overlapping timeline edits on the same track deterministically', async () => {
  const workspace = {
    project: {
      id: 'project-1',
    },
    demo: {
      id: 'demo-1',
      currentVersionId: 'version-root',
    },
  };

  const client = {
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          operationSeq: 2,
          operationType: 'TRACK_RENAMED',
          payload: {
            trackId: 'track-a',
            trackName: 'Remote name',
          },
        },
      ],
    },
  } as const;

  const conflict = await analyzeDawOperationConflict(client as never, workspace, {
    id: 'op-3',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationType: 'TRACK_RENAMED',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    operationSeq: 3,
    payload: {
      trackId: 'track-a',
      trackName: 'Local name',
    },
    idempotencyKey: 'idempotency-3',
    clientOperationId: 'client-3',
  });

  assert.ok(conflict);
  assert.equal(conflict?.reason, 'Track metadata conflict');
  assert.deepEqual(conflict?.conflictingOperationIds, ['op-2']);
  assert.deepEqual(conflict?.conflictingOperationSeqs, [2]);
});
