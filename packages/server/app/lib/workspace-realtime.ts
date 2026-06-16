import type { NextRequest } from 'next/server';

type WorkspaceRealtimeEvent = {
  type: 'workspace_changed';
  scopeKey: string;
  actorUserId: string;
  createdAt: string;
  reason?: string;
};

type WorkspaceRealtimeSubscriber = (event: WorkspaceRealtimeEvent) => void;

const rooms = new Map<string, Set<WorkspaceRealtimeSubscriber>>();

function roomKey(scopeKey: string) {
  return scopeKey;
}

function ensureRoom(scopeKey: string) {
  const key = roomKey(scopeKey);
  const existing = rooms.get(key);
  if (existing) return existing;

  const room = new Set<WorkspaceRealtimeSubscriber>();
  rooms.set(key, room);
  return room;
}

function dispatchEvent(event: WorkspaceRealtimeEvent) {
  const room = rooms.get(roomKey(event.scopeKey));
  if (!room) return;

  for (const subscriber of room) {
    subscriber(event);
  }
}

function createEvent(scopeKey: string, input: { actorUserId: string; reason?: string }) {
  return {
    type: 'workspace_changed' as const,
    scopeKey,
    actorUserId: input.actorUserId,
    createdAt: new Date().toISOString(),
    reason: input.reason,
  };
}

export function subscribeToWorkspaceRealtime(scopeKey: string, subscriber: WorkspaceRealtimeSubscriber) {
  const room = ensureRoom(scopeKey);
  room.add(subscriber);

  return () => {
    room.delete(subscriber);
    if (room.size === 0) {
      rooms.delete(roomKey(scopeKey));
    }
  };
}

export function emitWorkspaceRealtimeChanged(
  scopeKey: string,
  input: { actorUserId: string; reason?: string },
) {
  dispatchEvent(createEvent(scopeKey, input));
}

export function createWorkspaceRealtimeResponse(request: NextRequest, scopeKey: string) {
  const encoder = new TextEncoder();
  const heartbeat = ': ping\n\n';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const enqueue = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      const unsubscribe = subscribeToWorkspaceRealtime(scopeKey, (event) => {
        enqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeatTimer = setInterval(() => {
        enqueue(heartbeat);
      }, 25000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener('abort', cleanup, { once: true });
      enqueue('retry: 3000\n\n');
    },
    cancel() {
      // Cleanup is handled through the abort signal.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
