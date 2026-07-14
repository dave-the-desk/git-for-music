import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, PluginVisibility } from '@git-for-music/shared';
import { getConfig, isFeatureEnabled } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { deletePlugin, updatePlugin } from '@git-for-music/server/app/lib/plugins';
import '@/app/product/register-features';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  if (!isFeatureEnabled('plugins', getConfig())) {
    return NextResponse.json<ApiError>({ error: 'Not found' }, { status: 404 });
  }

  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<{
    displayName: string | null;
    description: string | null;
    visibility: PluginVisibility;
  }>;
  const { pluginId } = await params;

  try {
    const plugin = await updatePlugin(prisma, {
      userId: user.id,
      pluginId,
      updates: {
        displayName: body.displayName ?? null,
        description: body.description ?? null,
        visibility: body.visibility,
      },
    });
    return NextResponse.json({ plugin });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update plugin';
    const status = message === 'Plugin not found' ? 404 : 400;
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  if (!isFeatureEnabled('plugins', getConfig())) {
    return NextResponse.json<ApiError>({ error: 'Not found' }, { status: 404 });
  }

  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { pluginId } = await params;

  try {
    await deletePlugin(prisma, {
      userId: user.id,
      pluginId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete plugin';
    const status = message === 'Plugin not found' ? 404 : 400;
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
