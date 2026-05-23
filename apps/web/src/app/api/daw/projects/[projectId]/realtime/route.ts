import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { loadDawProjectOperations } from '@/features/daw/server/command-api';
import { listProjectPresence } from '@/features/daw/server/presence-service';
import {
  encodeDawRealtimeEvent,
  subscribeToDawProjectRealtime,
} from '@/features/daw/server/realtime-gateway';

function parseAfterSeq(value: string | null) {
  if (value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const demoId = req.nextUrl.searchParams.get('demoId');
  if (!demoId) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  const headerAfterSeq = parseAfterSeq(req.headers.get('last-event-id'));
  const queryAfterSeq = parseAfterSeq(req.nextUrl.searchParams.get('afterSeq'));
  const afterSeq =
    queryAfterSeq !== null ? queryAfterSeq : headerAfterSeq !== null ? headerAfterSeq : 0;

  if (afterSeq === null) {
    return NextResponse.json<ApiError>({ error: 'afterSeq must be a non-negative number' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const heartbeat = ': ping\n\n';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let readyForLiveEvents = false;
      const bufferedLiveEvents: ReturnType<typeof encodeDawRealtimeEvent>[] = [];

      const enqueue = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      const flushBufferedLiveEvents = () => {
        if (bufferedLiveEvents.length === 0) return;
        for (const chunk of bufferedLiveEvents.splice(0, bufferedLiveEvents.length)) {
          enqueue(chunk);
        }
      };

      const unsubscribe = subscribeToDawProjectRealtime({ projectId, demoId }, (event) => {
        if (closed) return;
        if (event.type === 'accepted_operation' && event.operation.operationSeq <= afterSeq) {
          return;
        }

        const chunk = encodeDawRealtimeEvent(event);
        if (!readyForLiveEvents) {
          bufferedLiveEvents.push(chunk);
          return;
        }

        enqueue(chunk);
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

      req.signal.addEventListener('abort', cleanup, { once: true });

      enqueue('retry: 3000\n\n');

      try {
        const operations = await loadDawProjectOperations(prisma, {
          projectId,
          demoId,
          userId: user.id,
          afterSeq,
        });

        if (operations === null) {
          cleanup();
          return;
        }

        const presences = listProjectPresence({ projectId, demoId });
        for (const presence of presences) {
          enqueue(
            encodeDawRealtimeEvent({
              ...presence,
              type: 'presence',
              createdAt: presence.updatedAt,
            }),
          );
        }

        for (const operation of operations) {
          enqueue(
            encodeDawRealtimeEvent({
              type: 'accepted_operation',
              projectId,
              demoId,
              createdAt: operation.createdAt,
              operation,
            }),
          );
        }

        readyForLiveEvents = true;
        flushBufferedLiveEvents();
      } catch (error) {
        cleanup();
        throw error;
      }
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
