import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';

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

    await recordDemoDawOperation(
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

    return trackUpdate;
  });

  return NextResponse.json(updated);
}
