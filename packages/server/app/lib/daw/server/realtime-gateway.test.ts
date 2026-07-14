import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitAcceptedDawOperation,
  emitDawProjectPresence,
  subscribeToDawProjectRealtime,
} from './realtime-gateway';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';

function makeOperation(): DawProjectOperationRecord {
  return {
    id: 'op-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    type: 'TRACK_RENAMED',
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-a',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    operationSeq: 2,
    payload: {
      trackId: 'track-a',
      trackName: 'Renamed track',
    },
    idempotencyKey: 'idempotency-1',
    clientOperationId: 'client-1',
  };
}

test('realtime gateway fans out room events and stops after unsubscribe', () => {
  const sameRoomEventsA: Array<{ type: string; operationSeq?: number }> = [];
  const sameRoomEventsB: Array<{ type: string; operationSeq?: number }> = [];
  const otherRoomEvents: Array<{ type: string; operationSeq?: number }> = [];

  const unsubscribeA = subscribeToDawProjectRealtime(
    { projectId: 'project-1', demoId: 'demo-1' },
    (event) => {
      sameRoomEventsA.push({
        type: event.type,
        operationSeq: 'operation' in event ? event.operation.operationSeq : undefined,
      });
    },
  );
  const unsubscribeB = subscribeToDawProjectRealtime(
    { projectId: 'project-1', demoId: 'demo-1' },
    (event) => {
      sameRoomEventsB.push({
        type: event.type,
        operationSeq: 'operation' in event ? event.operation.operationSeq : undefined,
      });
    },
  );
  const unsubscribeOther = subscribeToDawProjectRealtime(
    { projectId: 'project-2', demoId: 'demo-2' },
    (event) => {
      otherRoomEvents.push({
        type: event.type,
        operationSeq: 'operation' in event ? event.operation.operationSeq : undefined,
      });
    },
  );

  try {
    emitAcceptedDawOperation({
      projectId: 'project-1',
      demoId: 'demo-1',
      operation: makeOperation(),
    });

    assert.deepEqual(sameRoomEventsA, [{ type: 'accepted_operation', operationSeq: 2 }]);
    assert.deepEqual(sameRoomEventsB, [{ type: 'accepted_operation', operationSeq: 2 }]);
    assert.deepEqual(otherRoomEvents, []);

    unsubscribeB();

    emitDawProjectPresence({
      projectId: 'project-1',
      demoId: 'demo-1',
      presenceId: 'presence-1',
      actorUserId: 'user-a',
      presenceSeed: 'seed',
      status: 'online',
      cursorTimeMs: 1234,
      selectedTrackId: 'track-a',
      currentTool: 'select',
      recordingState: 'idle',
      playbackFollowState: true,
    });

    assert.deepEqual(sameRoomEventsA, [
      { type: 'accepted_operation', operationSeq: 2 },
      { type: 'presence', operationSeq: undefined },
    ]);
    assert.deepEqual(sameRoomEventsB, [{ type: 'accepted_operation', operationSeq: 2 }]);
    assert.deepEqual(otherRoomEvents, []);
  } finally {
    unsubscribeA();
    unsubscribeOther();
  }
});
