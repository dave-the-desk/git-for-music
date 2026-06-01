import { createHash } from 'node:crypto';
import type {
  DawProjectOperationRecord,
  DawRealtimeAcceptedOperationPayload,
} from '@/features/daw/protocol';

type DawRealtimeRoomKey = string;

type DawRealtimeBaseEvent = {
  projectId: string;
  demoId: string;
  createdAt: string;
};

export type DawRealtimeAcceptedOperationEvent = DawRealtimeBaseEvent &
  DawRealtimeAcceptedOperationPayload & {
  type: 'accepted_operation';
  operation: DawProjectOperationRecord;
};

export type DawRealtimePresenceEvent = DawRealtimeBaseEvent & {
  type: 'presence';
  presenceId: string;
  actorUserId: string;
  presenceSeed: string;
  status: 'online' | 'idle' | 'away' | 'offline';
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: 'select' | 'split' | 'merge' | 'fade';
  recordingState: 'idle' | 'recording' | 'preview' | 'uploading' | 'error';
  playbackFollowState: boolean;
};

export type DawRealtimeTransportStateEvent = DawRealtimeBaseEvent & {
  type: 'transport_state';
  actorUserId: string;
  status: 'playing' | 'paused' | 'stopped';
  positionMs: number;
  isLooping: boolean;
};

export type DawRealtimeAssetProcessingStatusEvent = DawRealtimeBaseEvent & {
  type: 'asset_processing_status';
  assetId: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  trackId: string | null;
  trackVersionId: string | null;
  message: string | null;
};

export type DawRealtimeCommentActivityEvent = DawRealtimeBaseEvent & {
  type: 'comment_activity';
  commentId: string;
  trackId: string | null;
  actorUserId: string;
  activity: 'created' | 'updated' | 'deleted' | 'resolved' | 'unresolved';
};

export type DawRealtimeVersionTreeEvent = DawRealtimeBaseEvent & {
  type: 'version_tree_changed';
  actorUserId: string;
};

export type DawRealtimeProjectRebootstrapRequiredEvent = DawRealtimeBaseEvent & {
  type: 'project_rebootstrap_required';
  actorUserId: string;
  reason: string;
};

export type DawRealtimeEvent =
  | DawRealtimeAcceptedOperationEvent
  | DawRealtimePresenceEvent
  | DawRealtimeTransportStateEvent
  | DawRealtimeAssetProcessingStatusEvent
  | DawRealtimeCommentActivityEvent
  | DawRealtimeVersionTreeEvent
  | DawRealtimeProjectRebootstrapRequiredEvent;

export type DawRealtimeEventType = DawRealtimeEvent['type'];

type DawRealtimeSubscriber = (event: DawRealtimeEvent) => void;

type DawRealtimeRoom = {
  subscribers: Set<DawRealtimeSubscriber>;
};

const rooms = new Map<DawRealtimeRoomKey, DawRealtimeRoom>();

function roomKey(projectId: string, demoId: string) {
  return `${projectId}:${demoId}`;
}

function ensureRoom(projectId: string, demoId: string) {
  const key = roomKey(projectId, demoId);
  const existing = rooms.get(key);
  if (existing) return existing;

  const room: DawRealtimeRoom = {
    subscribers: new Set(),
  };
  rooms.set(key, room);
  return room;
}

function dispatchEvent(event: DawRealtimeEvent) {
  const room = rooms.get(roomKey(event.projectId, event.demoId));
  if (!room) return;

  for (const subscriber of room.subscribers) {
    subscriber(event);
  }
}

function createEventBase(input: { projectId: string; demoId: string }) {
  return {
    projectId: input.projectId,
    demoId: input.demoId,
    createdAt: new Date().toISOString(),
  };
}

export function createProjectPresenceSeed(input: {
  projectId: string;
  demoId: string;
  userId: string;
}) {
  return createHash('sha256')
    .update(`${input.projectId}:${input.demoId}:${input.userId}`)
    .digest('hex');
}

export function subscribeToDawProjectRealtime(
  input: { projectId: string; demoId: string },
  subscriber: DawRealtimeSubscriber,
) {
  const room = ensureRoom(input.projectId, input.demoId);
  room.subscribers.add(subscriber);

  return () => {
    room.subscribers.delete(subscriber);
    if (room.subscribers.size === 0) {
      rooms.delete(roomKey(input.projectId, input.demoId));
    }
  };
}

export function emitAcceptedDawOperation(
  input: {
    projectId: string;
    demoId: string;
  } & (
    | {
        operation: DawProjectOperationRecord;
      }
    | {
        operationId: string;
        operationSeq: number;
        actorUserId: string;
        operationType: DawProjectOperationRecord['type'];
        payload: DawProjectOperationRecord['payload'];
        createdAt: string;
        clientOperationId?: string | null;
        idempotencyKey?: string | null;
        baseSnapshotId?: string | null;
        baseOperationSeq?: number;
      }
  ),
) {
  const operation: DawProjectOperationRecord =
    'operation' in input
      ? input.operation
      : {
          id: input.operationId,
          projectId: input.projectId,
          demoId: input.demoId,
          type: input.operationType,
          createdAt: input.createdAt,
          actorUserId: input.actorUserId,
          baseSnapshotId: input.baseSnapshotId ?? null,
          baseOperationSeq: input.baseOperationSeq ?? 0,
          operationSeq: input.operationSeq,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey ?? '',
          clientOperationId: input.clientOperationId ?? '',
        };
  dispatchEvent({
    ...createEventBase(input),
    type: 'accepted_operation',
    operationId: operation.id,
    operationSeq: operation.operationSeq,
    actorUserId: operation.actorUserId,
    operationType: operation.type,
    payload: operation.payload,
    clientOperationId: operation.clientOperationId,
    idempotencyKey: operation.idempotencyKey,
    operation,
  });
}

export function emitDawProjectPresence(input: {
  projectId: string;
  demoId: string;
  presenceId: string;
  actorUserId: string;
  presenceSeed: string;
  status: DawRealtimePresenceEvent['status'];
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: DawRealtimePresenceEvent['currentTool'];
  recordingState: DawRealtimePresenceEvent['recordingState'];
  playbackFollowState: boolean;
}) {
  dispatchEvent({
    ...createEventBase(input),
    type: 'presence',
    presenceId: input.presenceId,
    actorUserId: input.actorUserId,
    presenceSeed: input.presenceSeed,
    status: input.status,
    cursorTimeMs: input.cursorTimeMs,
    selectedTrackId: input.selectedTrackId,
    currentTool: input.currentTool,
    recordingState: input.recordingState,
    playbackFollowState: input.playbackFollowState,
  });
}

export function emitDawProjectTransportState(input: {
  projectId: string;
  demoId: string;
  actorUserId: string;
  status: DawRealtimeTransportStateEvent['status'];
  positionMs: number;
  isLooping: boolean;
}) {
  dispatchEvent({
    ...createEventBase(input),
    type: 'transport_state',
    actorUserId: input.actorUserId,
    status: input.status,
    positionMs: input.positionMs,
    isLooping: input.isLooping,
  });
}

export function emitDawAssetProcessingStatus(input: {
  projectId: string;
  demoId: string;
  assetId: string;
  status: DawRealtimeAssetProcessingStatusEvent['status'];
  trackId: string | null;
  trackVersionId: string | null;
  message: string | null;
}) {
  dispatchEvent({
    ...createEventBase(input),
    type: 'asset_processing_status',
    assetId: input.assetId,
    status: input.status,
    trackId: input.trackId,
    trackVersionId: input.trackVersionId,
    message: input.message,
  });
}

export function emitDawCommentActivity(input: {
  projectId: string;
  demoId: string;
  commentId: string;
  trackId: string | null;
  actorUserId: string;
  activity: DawRealtimeCommentActivityEvent['activity'];
}) {
  dispatchEvent({
    ...createEventBase(input),
    type: 'comment_activity',
    commentId: input.commentId,
    trackId: input.trackId,
    actorUserId: input.actorUserId,
    activity: input.activity,
  });
}

export function emitDawVersionTreeChanged(input: {
  projectId: string;
  demoId: string;
  actorUserId: string;
}) {
  dispatchEvent({
    ...createEventBase(input),
    type: 'version_tree_changed',
    actorUserId: input.actorUserId,
  });
}

export function emitDawProjectRebootstrapRequired(input: {
  projectId: string;
  demoId: string;
  actorUserId: string;
  reason: string;
}) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[daw] project_rebootstrap_required for ${input.projectId}/${input.demoId}: ${input.reason}`,
    );
  }
  dispatchEvent({
    ...createEventBase(input),
    type: 'project_rebootstrap_required',
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
}

export function encodeDawRealtimeEvent(event: DawRealtimeEvent) {
  const payload = JSON.stringify(event);
  const eventId =
    'operation' in event
      ? String(event.operation.operationSeq)
      : 'presenceId' in event
        ? event.presenceId
        : String(Date.now());
  return `event: ${event.type}\nid: ${eventId}\ndata: ${payload}\n\n`;
}
