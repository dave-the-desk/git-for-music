import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

const MAX_NAME_LENGTH = 100;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackId } = await params;
  const body = (await req.json()) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';

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
      id: trackId,
      demo: {
        project: {
          group: {
            members: { some: { userId: user.id } },
          },
        },
      },
    },
    select: { id: true },
  });

  if (!track) {
    return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
  }

  const updated = await prisma.track.update({
    where: { id: track.id },
    data: { name },
    select: { id: true, name: true },
  });

  return NextResponse.json(updated);
}
