import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';

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

    await recordDemoDawOperation(
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

    return trackVersionUpdate;
  });

  return NextResponse.json(updated);
}
