import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { grantPluginToDemo } from '@git-for-music/server/app/lib/plugins';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; demoId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<{ pluginId: string }>;
  if (!body.pluginId) {
    return NextResponse.json<ApiError>({ error: 'pluginId is required' }, { status: 400 });
  }

  const { projectId, demoId } = await params;
  void projectId;

  try {
    const grant = await grantPluginToDemo(prisma, {
      userId: user.id,
      projectId,
      pluginId: body.pluginId,
      demoId,
    });
    return NextResponse.json({ grant });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to grant plugin';
    const status = message === 'Plugin not found' ? 404 : message === 'Demo not found' ? 404 : 400;
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
