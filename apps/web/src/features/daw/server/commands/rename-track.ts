import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import { emitAcceptedDawOperation } from '@/features/daw/server/realtime-gateway';

const MAX_NAME_LENGTH = 100;

export async function renameTrackCommand(input: {
  userId: string;
  trackId: string;
  name: unknown;
}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';

  if (!name) {
    return NextResponse.json<ApiError>({ error: 'Track name cannot be empty' }, { status: 400 });
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Track name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const track = await prisma.track.findFirst({
    where: {
      id: input.trackId,
      demo: {
        project: {
          group: {
            members: { some: { userId: input.userId } },
          },
        },
      },
    },
    select: {
      id: true,
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
  });

  if (!track) {
    return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const trackUpdate = await tx.track.update({
      where: { id: track.id },
      data: { name },
      select: { id: true, name: true },
    });

    const operation = await recordDemoDawOperation(
      tx,
      {
        projectId: track.demo.project.id,
        demoId: track.demoId,
        actorUserId: input.userId,
        operationType: 'TRACK_RENAMED',
        payload: {
          trackId: track.id,
          trackName: name,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    return { trackUpdate, operation };
  });

  if (updated.operation.created) {
    emitAcceptedDawOperation({
      projectId: track.demo.project.id,
      demoId: track.demoId,
      operationId: updated.operation.id,
      operationSeq: updated.operation.operationSeq,
      actorUserId: input.userId,
      operationType: updated.operation.operationType ?? 'TRACK_RENAMED',
      payload: updated.operation.payload as DawProjectOperationRecord['payload'],
      createdAt: updated.operation.createdAt ?? new Date().toISOString(),
      idempotencyKey: updated.operation.idempotencyKey ?? null,
      clientOperationId: updated.operation.clientOperationId ?? null,
      baseSnapshotId: updated.operation.baseSnapshotId ?? null,
      baseOperationSeq: updated.operation.baseOperationSeq ?? 0,
    });
  }

  return NextResponse.json(updated.trackUpdate);
}
