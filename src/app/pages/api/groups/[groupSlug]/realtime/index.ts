import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createWorkspaceRealtimeResponse } from '@git-for-music/server/app/lib/workspace-realtime';

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ groupSlug: string }>;
  },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { groupSlug } = await context.params;
  const group = await prisma.group.findFirst({
    where: {
      slug: groupSlug,
      members: {
        some: {
          userId: user.id,
        },
      },
    },
    select: {
      slug: true,
    },
  });

  if (!group) {
    return NextResponse.json<ApiError>({ error: 'Group not found' }, { status: 404 });
  }

  return createWorkspaceRealtimeResponse(req, `group:${group.slug}`);
}
