import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, MoveSegmentResponse } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import { emitAcceptedDawOperation } from '@/features/daw/server/realtime-gateway';

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

    const operation = await recordDemoDawOperation(
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

    return { next, operation };
  });

  if (updated.operation.created) {
    emitAcceptedDawOperation({
      projectId: segment.trackVersion.track.demo.project.id,
      demoId: segment.trackVersion.track.demoId,
      operationId: updated.operation.id,
      operationSeq: updated.operation.operationSeq,
      actorUserId: input.userId,
      operationType: updated.operation.operationType ?? 'SEGMENT_MOVED',
      payload: updated.operation.payload as DawProjectOperationRecord['payload'],
      createdAt: updated.operation.createdAt ?? new Date().toISOString(),
      idempotencyKey: updated.operation.idempotencyKey ?? null,
      clientOperationId: updated.operation.clientOperationId ?? null,
      baseSnapshotId: updated.operation.baseSnapshotId ?? null,
      baseOperationSeq: updated.operation.baseOperationSeq ?? 0,
    });
  }

  const response: MoveSegmentResponse = {
    trackVersionId: updated.next.trackVersionId,
    segment: {
      id: updated.next.id,
      trackVersionId: updated.next.trackVersionId,
      startMs: updated.next.startMs,
      endMs: updated.next.endMs,
      sourceStartMs: updated.next.startMs,
      sourceEndMs: updated.next.endMs,
      timelineStartMs: updated.next.timelineStartMs ?? updated.next.startMs,
      timelineEndMs: (updated.next.timelineStartMs ?? updated.next.startMs) + (updated.next.endMs - updated.next.startMs),
      durationMs: updated.next.endMs - updated.next.startMs,
      gainDb: updated.next.gainDb,
      fadeInMs: updated.next.fadeInMs,
      fadeOutMs: updated.next.fadeOutMs,
      isMuted: updated.next.isMuted,
      position: updated.next.position,
    },
  };

  return NextResponse.json(response);
}
