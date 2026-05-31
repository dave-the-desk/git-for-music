import { createProjectPresenceSeed, emitDawProjectPresence } from '@/features/daw/server/realtime-gateway';

export type DawProjectPresenceStatus = 'online' | 'idle' | 'away';
export type DawProjectPresenceCurrentTool = 'select' | 'split' | 'merge';
export type DawProjectRecordingState = 'idle' | 'recording' | 'preview' | 'uploading' | 'error';

export type DawProjectPresenceRecord = {
  presenceId: string;
  projectId: string;
  demoId: string;
  actorUserId: string;
  presenceSeed: string;
  status: DawProjectPresenceStatus;
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: DawProjectPresenceCurrentTool;
  recordingState: DawProjectRecordingState;
  playbackFollowState: boolean;
  updatedAt: string;
};

type PresenceRoomKey = string;

const PRESENCE_TTL_MS = 20000;
const PRESENCE_SWEEP_INTERVAL_MS = 10000;

const presenceRooms = new Map<PresenceRoomKey, Map<string, DawProjectPresenceRecord & { updatedAtMs: number }>>();

declare global {
  // eslint-disable-next-line no-var
  var __dawPresenceSweepTimer: ReturnType<typeof setInterval> | undefined;
}

function roomKey(projectId: string, demoId: string) {
  return `${projectId}:${demoId}`;
}

function getPresenceRoom(projectId: string, demoId: string) {
  const key = roomKey(projectId, demoId);
  const existing = presenceRooms.get(key);
  if (existing) return existing;

  const room = new Map<string, DawProjectPresenceRecord & { updatedAtMs: number }>();
  presenceRooms.set(key, room);
  return room;
}

function pruneStalePresence(now = Date.now()) {
  for (const [key, room] of presenceRooms.entries()) {
    for (const [presenceId, record] of room.entries()) {
      if (now - record.updatedAtMs <= PRESENCE_TTL_MS) continue;

      room.delete(presenceId);
      emitDawProjectPresence({
        projectId: record.projectId,
        demoId: record.demoId,
        presenceId: record.presenceId,
        actorUserId: record.actorUserId,
        presenceSeed: record.presenceSeed,
        status: 'offline',
        cursorTimeMs: null,
        selectedTrackId: null,
        currentTool: record.currentTool,
        recordingState: 'idle',
        playbackFollowState: false,
      });
    }

    if (room.size === 0) {
      presenceRooms.delete(key);
    }
  }
}

function ensurePresenceSweepTimer() {
  if (globalThis.__dawPresenceSweepTimer) return;
  globalThis.__dawPresenceSweepTimer = setInterval(() => {
    pruneStalePresence();
  }, PRESENCE_SWEEP_INTERVAL_MS);
  globalThis.__dawPresenceSweepTimer.unref?.();
}

ensurePresenceSweepTimer();

export function listProjectPresence(input: { projectId: string; demoId: string }) {
  pruneStalePresence();
  const room = presenceRooms.get(roomKey(input.projectId, input.demoId));
  if (!room) return [];
  return [...room.values()]
    .map((record) => ({ ...record }))
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .map(({ updatedAtMs: _updatedAtMs, ...record }) => record);
}

export function upsertProjectPresence(input: {
  projectId: string;
  demoId: string;
  actorUserId: string;
  presenceId: string;
  status: DawProjectPresenceStatus;
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: DawProjectPresenceCurrentTool;
  recordingState: DawProjectRecordingState;
  playbackFollowState: boolean;
}) {
  const now = Date.now();
  pruneStalePresence(now);

  const presenceSeed = createProjectPresenceSeed({
    projectId: input.projectId,
    demoId: input.demoId,
    userId: input.actorUserId,
  });

  const record: DawProjectPresenceRecord & { updatedAtMs: number } = {
    presenceId: input.presenceId,
    projectId: input.projectId,
    demoId: input.demoId,
    actorUserId: input.actorUserId,
    presenceSeed,
    status: input.status,
    cursorTimeMs: input.cursorTimeMs,
    selectedTrackId: input.selectedTrackId,
    currentTool: input.currentTool,
    recordingState: input.recordingState,
    playbackFollowState: input.playbackFollowState,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
  };

  getPresenceRoom(input.projectId, input.demoId).set(input.presenceId, record);

  emitDawProjectPresence({
    projectId: input.projectId,
    demoId: input.demoId,
    presenceId: input.presenceId,
    actorUserId: input.actorUserId,
    presenceSeed,
    status: input.status,
    cursorTimeMs: input.cursorTimeMs,
    selectedTrackId: input.selectedTrackId,
    currentTool: input.currentTool,
    recordingState: input.recordingState,
    playbackFollowState: input.playbackFollowState,
  });

  const { updatedAtMs: _updatedAtMs, ...publicRecord } = record;
  return publicRecord;
}

export function removeProjectPresence(input: {
  projectId: string;
  demoId: string;
  presenceId: string;
}) {
  pruneStalePresence();
  const room = presenceRooms.get(roomKey(input.projectId, input.demoId));
  if (!room) return null;

  const record = room.get(input.presenceId);
  if (!record) return null;

  room.delete(input.presenceId);
  if (room.size === 0) {
    presenceRooms.delete(roomKey(input.projectId, input.demoId));
  }

  emitDawProjectPresence({
    projectId: record.projectId,
    demoId: record.demoId,
    presenceId: record.presenceId,
    actorUserId: record.actorUserId,
    presenceSeed: record.presenceSeed,
    status: 'offline',
    cursorTimeMs: null,
    selectedTrackId: null,
    currentTool: record.currentTool,
    recordingState: 'idle',
    playbackFollowState: false,
  });

  const { updatedAtMs: _updatedAtMs, ...publicRecord } = record;
  return publicRecord;
}
