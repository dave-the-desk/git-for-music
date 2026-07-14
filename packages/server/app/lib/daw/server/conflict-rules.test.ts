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
    demoId: 'demo-1',
    operationType: 'TRACK_RENAMED',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
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

test('analyzeDawOperationConflict rejects different edits to the same segment from the same base', async () => {
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
          operationType: 'SEGMENT_TRIMMED',
          payload: {
            trackVersionId: 'track-version-a',
            segmentId: 'segment-a',
            from: { startMs: 0, endMs: 1000 },
            to: { startMs: 100, endMs: 900 },
          },
        },
      ],
    },
    trackVersion: {
      findFirst: async () => ({ id: 'track-version-a', trackId: 'track-a' }),
    },
    segment: {
      findFirst: async () => ({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        trackVersion: {
          startOffsetMs: 0,
        },
      }),
    },
  };

  const conflict = await analyzeDawOperationConflict(client as never, workspace, {
    demoId: 'demo-1',
    operationType: 'SEGMENT_TRIMMED',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    payload: {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-a',
      from: { startMs: 0, endMs: 1000 },
      to: { startMs: 150, endMs: 850 },
    },
    idempotencyKey: 'idempotency-3',
    clientOperationId: 'client-3',
  });

  assert.ok(conflict);
  assert.equal(conflict?.reason, 'Same segment edited differently from the same base');
  assert.deepEqual(conflict?.conflictingOperationIds, ['op-2']);
  assert.deepEqual(conflict?.conflictingOperationSeqs, [2]);
});

test('analyzeDawOperationConflict allows adjacent edits on the same track and flags overlapping edits', async () => {
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
          operationType: 'SEGMENT_TRIMMED',
          payload: {
            trackVersionId: 'track-version-a',
            segmentId: 'segment-a',
            from: { startMs: 0, endMs: 1000 },
            to: { startMs: 0, endMs: 1000 },
          },
        },
      ],
    },
    trackVersion: {
      findFirst: async () => ({ id: 'track-version-a', trackId: 'track-a' }),
    },
    segment: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'segment-a') {
          return {
            id: 'segment-a',
            startMs: 0,
            endMs: 1000,
            timelineStartMs: 0,
            trackVersion: {
              startOffsetMs: 0,
            },
          };
        }

        return {
          id: 'segment-b',
          startMs: 1000,
          endMs: 1500,
          timelineStartMs: 1000,
          trackVersion: {
            startOffsetMs: 0,
          },
        };
      },
    },
  };

  const noConflict = await analyzeDawOperationConflict(client as never, workspace, {
    demoId: 'demo-1',
    operationType: 'SEGMENT_TRIMMED',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    payload: {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-b',
      from: { startMs: 1000, endMs: 1500 },
      to: { startMs: 1100, endMs: 1400 },
    },
    idempotencyKey: 'idempotency-4',
    clientOperationId: 'client-4',
  });

  assert.equal(noConflict, null);

  const overlapClient = {
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          operationSeq: 2,
          operationType: 'SEGMENT_TRIMMED',
          payload: {
            trackVersionId: 'track-version-a',
            segmentId: 'segment-a',
            from: { startMs: 0, endMs: 1000 },
            to: { startMs: 0, endMs: 1000 },
          },
        },
      ],
    },
    trackVersion: {
      findFirst: async () => ({ id: 'track-version-a', trackId: 'track-a' }),
    },
    segment: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'segment-a') {
          return {
            id: 'segment-a',
            startMs: 0,
            endMs: 1000,
            timelineStartMs: 0,
            trackVersion: {
              startOffsetMs: 0,
            },
          };
        }

        return {
          id: 'segment-b',
          startMs: 500,
          endMs: 1500,
          timelineStartMs: 500,
          trackVersion: {
            startOffsetMs: 0,
          },
        };
      },
    },
  };

  const overlapConflict = await analyzeDawOperationConflict(overlapClient as never, workspace, {
    demoId: 'demo-1',
    operationType: 'SEGMENT_TRIMMED',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    payload: {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-b',
      from: { startMs: 500, endMs: 1500 },
      to: { startMs: 600, endMs: 1400 },
    },
    idempotencyKey: 'idempotency-5',
    clientOperationId: 'client-5',
  });

  assert.ok(overlapConflict);
  assert.equal(overlapConflict?.reason, 'Overlapping timeline edits on the same track');
  assert.deepEqual(overlapConflict?.conflictingOperationIds, ['op-2']);
  assert.deepEqual(overlapConflict?.conflictingOperationSeqs, [2]);
});
