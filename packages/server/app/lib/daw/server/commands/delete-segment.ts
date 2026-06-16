import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/app/lib/daw/server/snapshot-builder';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';
import { emitAcceptedDawOperation } from '@/app/lib/daw/server/realtime-gateway';

export async function deleteSegmentCommand(input: {
  userId: string;
  trackVersionId: string;
  segmentId: string;
}) {
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
      position: true,
      trackVersion: {
        select: {
          demoVersionId: true,
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

  const operation = await prisma.$transaction(async (tx) => {
    await tx.segment.delete({
      where: { id: segment.id },
    });

    await tx.segment.updateMany({
      where: {
        trackVersionId: input.trackVersionId,
        position: {
          gt: segment.position,
        },
      },
      data: {
        position: {
          decrement: 1,
        },
      },
    });

    return recordDemoDawOperation(
      tx,
      {
        projectId: segment.trackVersion.track.demo.project.id,
        demoId: segment.trackVersion.track.demoId,
        actorUserId: input.userId,
        operationType: 'SEGMENT_DELETED',
        payload: {
          trackVersionId: input.trackVersionId,
          segmentId: segment.id,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );
  });

  if (operation.created) {
    emitAcceptedDawOperation({
      projectId: segment.trackVersion.track.demo.project.id,
      demoId: segment.trackVersion.track.demoId,
      operationId: operation.id,
      operationSeq: operation.operationSeq,
      actorUserId: input.userId,
      operationType: operation.operationType ?? 'SEGMENT_DELETED',
      payload: operation.payload as DawProjectOperationRecord['payload'],
      createdAt: operation.createdAt ?? new Date().toISOString(),
      idempotencyKey: operation.idempotencyKey ?? null,
      clientOperationId: operation.clientOperationId ?? null,
      baseSnapshotId: operation.baseSnapshotId ?? null,
      baseOperationSeq: operation.baseOperationSeq ?? 0,
    });
  }

  return new NextResponse(null, { status: 204 });
}
