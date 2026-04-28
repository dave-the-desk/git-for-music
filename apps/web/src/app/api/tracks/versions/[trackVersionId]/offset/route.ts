import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

// startOffsetMs is timeline position metadata only — it does not touch the audio file
// (storageKey). Mutating it directly does not violate the "audio is never mutated" rule.
// We update in-place rather than creating a new DemoVersion because offset is UI layout
// data, not audio content, and creating a snapshot per drag would flood version history.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId } = await params;
  const body = (await req.json()) as { startOffsetMs?: unknown };

  if (
    typeof body.startOffsetMs !== 'number' ||
    !Number.isFinite(body.startOffsetMs) ||
    body.startOffsetMs < 0
  ) {
    return NextResponse.json<ApiError>(
      { error: 'startOffsetMs must be a non-negative number' },
      { status: 400 },
    );
  }

  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: trackVersionId,
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
    select: { id: true },
  });

  if (!trackVersion) {
    return NextResponse.json<ApiError>({ error: 'Track version not found' }, { status: 404 });
  }

  const updated = await prisma.trackVersion.update({
    where: { id: trackVersion.id },
    data: { startOffsetMs: body.startOffsetMs },
    select: { id: true, startOffsetMs: true },
  });

  return NextResponse.json(updated);
}
