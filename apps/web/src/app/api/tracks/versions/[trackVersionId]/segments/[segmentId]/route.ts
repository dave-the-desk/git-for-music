import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string; segmentId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId, segmentId } = await params;

  const segment = await prisma.segment.findFirst({
    where: {
      id: segmentId,
      trackVersionId,
      trackVersion: {
        track: {
          demo: {
            project: {
              group: {
                members: { some: { userId: user.id } },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      position: true,
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
        trackVersionId,
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
  });

  return new NextResponse(null, { status: 204 });
}
