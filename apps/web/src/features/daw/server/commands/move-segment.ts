import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, MoveSegmentResponse } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function moveSegmentCommand(input: {
  userId: string;
  trackVersionId: string;
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
      trackVersionId: true,
      startMs: true,
      endMs: true,
      timelineStartMs: true,
      gainDb: true,
      fadeInMs: true,
      fadeOutMs: true,
      isMuted: true,
      position: true,
      trackVersion: {
        select: {
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.segment.update({
      where: { id: segment.id },
      data: { timelineStartMs },
      select: {
        id: true,
        trackVersionId: true,
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

    await recordDemoDawOperation(
      tx,
      {
        projectId: segment.trackVersion.track.demo.project.id,
        demoId: segment.trackVersion.track.demoId,
        actorUserId: input.userId,
        operationType: 'SEGMENT_MOVED',
        payload: {
          trackVersionId: input.trackVersionId,
          segmentId: next.id,
          timelineStartMs,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    return next;
  });

  const response: MoveSegmentResponse = {
    trackVersionId: updated.trackVersionId,
    segment: {
      id: updated.id,
      trackVersionId: updated.trackVersionId,
      startMs: updated.startMs,
      endMs: updated.endMs,
      sourceStartMs: updated.startMs,
      sourceEndMs: updated.endMs,
      timelineStartMs: updated.timelineStartMs ?? updated.startMs,
      timelineEndMs: (updated.timelineStartMs ?? updated.startMs) + (updated.endMs - updated.startMs),
      durationMs: updated.endMs - updated.startMs,
      gainDb: updated.gainDb,
      fadeInMs: updated.fadeInMs,
      fadeOutMs: updated.fadeOutMs,
      isMuted: updated.isMuted,
      position: updated.position,
    },
  };

  return NextResponse.json(response);
}
