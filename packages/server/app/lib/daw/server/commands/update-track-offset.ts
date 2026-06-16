import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/app/lib/daw/server/snapshot-builder';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';
import { emitAcceptedDawOperation } from '@/app/lib/daw/server/realtime-gateway';

export async function updateTrackOffsetCommand(input: {
  userId: string;
  trackVersionId: string;
  startOffsetMs: unknown;
}) {
  const startOffsetMs = input.startOffsetMs;

  if (
    typeof startOffsetMs !== 'number' ||
    !Number.isFinite(startOffsetMs) ||
    startOffsetMs < 0
  ) {
    return NextResponse.json<ApiError>(
      { error: 'startOffsetMs must be a non-negative number' },
      { status: 400 },
    );
  }

  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: input.trackVersionId,
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
    select: {
      id: true,
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
  });

  if (!trackVersion) {
    return NextResponse.json<ApiError>({ error: 'Track version not found' }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const trackVersionUpdate = await tx.trackVersion.update({
      where: { id: trackVersion.id },
      data: { startOffsetMs },
      select: { id: true, startOffsetMs: true },
    });

    const operation = await recordDemoDawOperation(
      tx,
      {
        projectId: trackVersion.track.demo.project.id,
        demoId: trackVersion.track.demoId,
        actorUserId: input.userId,
        operationType: 'TRACK_OFFSET_UPDATED',
        payload: {
          trackVersionId: trackVersion.id,
          startOffsetMs,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    return { trackVersionUpdate, operation };
  });

  if (updated.operation.created) {
    emitAcceptedDawOperation({
      projectId: trackVersion.track.demo.project.id,
      demoId: trackVersion.track.demoId,
      operationId: updated.operation.id,
      operationSeq: updated.operation.operationSeq,
      actorUserId: input.userId,
      operationType: updated.operation.operationType ?? 'TRACK_OFFSET_UPDATED',
      payload: updated.operation.payload as DawProjectOperationRecord['payload'],
      createdAt: updated.operation.createdAt ?? new Date().toISOString(),
      idempotencyKey: updated.operation.idempotencyKey ?? null,
      clientOperationId: updated.operation.clientOperationId ?? null,
      baseSnapshotId: updated.operation.baseSnapshotId ?? null,
      baseOperationSeq: updated.operation.baseOperationSeq ?? 0,
    });
  }

  return NextResponse.json(updated.trackVersionUpdate);
}
