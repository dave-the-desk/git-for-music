import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, MoveSegmentResponse } from '@git-for-music/shared';
import { commitDawProjectOperation } from '@/app/lib/daw/server/command-api';

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function moveSegmentCommand(input: {
  userId: string;
  trackVersionId: string;
  toTrackVersionId?: string;
  segmentId: string;
  timelineStartMs: unknown;
}) {
  const timelineStartMs = parseFiniteNumber(input.timelineStartMs);
  if (timelineStartMs === null || timelineStartMs < 0) {
    return NextResponse.json<ApiError>(
      { error: 'timelineStartMs must be a non-negative number' },
      { status: 400 },
    );
  }

  const segment = await prisma.segment.findFirst({
    where: {
      id: input.segmentId,
      trackVersionId: input.trackVersionId,
      trackVersion: {
        track: {
          demo: {
            project: {
              group: {
                members: { some: { userId: input.userId } },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      startMs: true,
      endMs: true,
      timelineStartMs: true,
      position: true,
      trackVersion: {
        select: {
          id: true,
          startOffsetMs: true,
          track: {
            select: {
              demoId: true,
              demo: {
                select: {
                  project: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!segment) {
    return NextResponse.json<ApiError>({ error: 'Segment not found' }, { status: 404 });
  }

  const durationMs = segment.endMs - segment.startMs;
  const toTrackVersionId = input.toTrackVersionId ?? input.trackVersionId;
  const fromTimelineStartMs = segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs;
  const fromTimelineEndMs = fromTimelineStartMs + durationMs;

  const result = await commitDawProjectOperation(prisma, {
    projectId: segment.trackVersion.track.demo.project.id,
    userId: input.userId,
    request: {
      demoId: segment.trackVersion.track.demoId,
      operationType: 'SEGMENT_MOVED',
      payload: {
        segmentId: segment.id,
        fromTrackVersionId: input.trackVersionId,
        toTrackVersionId,
        fromTimelineStartMs,
        fromTimelineEndMs,
        toTimelineStartMs: timelineStartMs,
        toTimelineEndMs: timelineStartMs + durationMs,
      },
    },
  });

  if ('conflict' in result && result.conflict) {
    return NextResponse.json(
      {
        error: result.conflict.reason,
        conflict: result.conflict,
      },
      { status: 409 },
    );
  }

  const movePayload = result.operation.payload as {
    segmentId: string;
    fromTrackVersionId: string;
    toTrackVersionId: string;
    fromTimelineStartMs: number;
    fromTimelineEndMs: number;
    toTimelineStartMs: number;
    toTimelineEndMs: number;
  };

  const updatedSegment = await prisma.segment.findFirst({
    where: {
      id: movePayload.segmentId,
      trackVersionId: movePayload.toTrackVersionId,
      trackVersion: {
        track: {
          demo: {
            project: {
              group: {
                members: { some: { userId: input.userId } },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      trackVersionId: true,
      sourceTrackVersionId: true,
      startMs: true,
      endMs: true,
      timelineStartMs: true,
      gainDb: true,
      fadeInMs: true,
      fadeOutMs: true,
      isMuted: true,
      position: true,
    },
  });

  if (!updatedSegment) {
    return NextResponse.json<ApiError>({ error: 'Segment not found after move' }, { status: 404 });
  }

  const updatedDurationMs = updatedSegment.endMs - updatedSegment.startMs;
  const updatedTimelineStartMs = updatedSegment.timelineStartMs ?? updatedSegment.startMs;

  const response: MoveSegmentResponse = {
    trackVersionId: updatedSegment.trackVersionId,
    segment: {
      id: updatedSegment.id,
      trackVersionId: updatedSegment.trackVersionId,
      sourceTrackVersionId: updatedSegment.sourceTrackVersionId ?? updatedSegment.trackVersionId,
      startMs: updatedSegment.startMs,
      endMs: updatedSegment.endMs,
      sourceStartMs: updatedSegment.startMs,
      sourceEndMs: updatedSegment.endMs,
      timelineStartMs: updatedTimelineStartMs,
      timelineEndMs: updatedTimelineStartMs + updatedDurationMs,
      durationMs: updatedDurationMs,
      gainDb: updatedSegment.gainDb,
      fadeInMs: updatedSegment.fadeInMs,
      fadeOutMs: updatedSegment.fadeOutMs,
      isMuted: updatedSegment.isMuted,
      position: updatedSegment.position,
    },
  };

  return NextResponse.json(response);
}
