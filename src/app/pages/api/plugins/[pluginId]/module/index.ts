import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import {
  assertPluginModuleAccess,
  getPluginModuleObjectKey,
} from '@git-for-music/server/app/lib/plugins';
import { createAssetDownloadUrl } from '@git-for-music/server/app/lib/daw/server/assets';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { pluginId } = await params;
  const plugin = await assertPluginModuleAccess(prisma, { userId: user.id, pluginId });
  if (!plugin) {
    return NextResponse.json<ApiError>({ error: 'Plugin not found' }, { status: 404 });
  }

  const objectKey = getPluginModuleObjectKey(plugin);
  if (!objectKey) {
    return NextResponse.json<ApiError>({ error: 'Plugin module not found' }, { status: 404 });
  }

  const download = await createAssetDownloadUrl({
    assetId: plugin.id,
    objectKey,
    contentType: 'text/javascript',
  });

  const upstream = await fetch(download.url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json<ApiError>({ error: 'Unable to load plugin module from storage' }, { status: upstream.status || 502 });
  }

  const headers = new Headers();
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, max-age=300, immutable');
  headers.set('content-security-policy', "default-src 'none'; script-src 'self'; sandbox");

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) {
    headers.set('content-length', contentLength);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
