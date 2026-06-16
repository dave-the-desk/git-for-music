import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createWorkspaceRealtimeResponse } from '@git-for-music/server/app/lib/workspace-realtime';

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ groupSlug: string; projectSlug: string }>;
  },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { groupSlug, projectSlug } = await context.params;
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      group: {
        slug: groupSlug,
        members: {
          some: {
            userId: user.id,
          },
        },
      },
    },
    select: {
      slug: true,
      group: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
  }

  return createWorkspaceRealtimeResponse(req, `project:${project.group.slug}:${project.slug}`);
}
