import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';

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

  await prisma.$transaction(async (tx) => {
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

    await recordDemoDawOperation(
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

  return new NextResponse(null, { status: 204 });
}
