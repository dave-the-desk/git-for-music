import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { revokePluginFromDemo } from '@git-for-music/server/app/lib/plugins';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; demoId: string; pluginId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, demoId, pluginId } = await params;
  void projectId;

  try {
    await revokePluginFromDemo(prisma, {
      userId: user.id,
      projectId,
      pluginId,
      demoId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to revoke plugin';
    const status = message === 'Plugin not found' ? 404 : message === 'Demo not found' ? 404 : 400;
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
