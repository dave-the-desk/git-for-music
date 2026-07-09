import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import {
  assertPluginModuleAccess,
  getPluginModuleObjectKey,
} from '@git-for-music/server/app/lib/plugins';
import { createAssetDownloadUrl } from '@git-for-music/server/app/lib/daw/server/assets';
import { createPluginModuleResponseHeaders } from '../response-headers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  const { pluginId, path } = await params;
  const plugin = await assertPluginModuleAccess(prisma, { userId: user.id, pluginId });
  if (!plugin) {
    return NextResponse.json<ApiError>({ error: 'Plugin not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const objectKey = getPluginModuleObjectKey(plugin, path);
  if (!objectKey) {
    return NextResponse.json<ApiError>({ error: 'Plugin module not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const download = await createAssetDownloadUrl({
    assetId: plugin.id,
    objectKey,
    contentType: 'text/javascript',
  });

  const upstream = await fetch(download.url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json<ApiError>({ error: 'Unable to load plugin module from storage' }, { status: upstream.status || 502, headers: { 'cache-control': 'no-store' } });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: createPluginModuleResponseHeaders(upstream.headers.get('content-length')),
  });
}
