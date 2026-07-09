import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, PluginVisibility } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createPluginUploadTarget } from '@git-for-music/server/app/lib/plugins';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<{
    fileName: string;
    contentType: string;
    sizeBytes: number;
    bundleKind: 'SINGLE_MODULE' | 'ZIP_BUNDLE';
    displayName: string | null;
    description: string | null;
    visibility: PluginVisibility;
    projectId: string | null;
    demoId: string | null;
    pluginId: string;
  }>;

  if (!body.fileName || !body.contentType || typeof body.sizeBytes !== 'number') {
    return NextResponse.json<ApiError>({ error: 'fileName, contentType, and sizeBytes are required' }, { status: 400 });
  }

  try {
    const target = await createPluginUploadTarget({
      userId: user.id,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      bundleKind: body.bundleKind,
      displayName: body.displayName ?? null,
      description: body.description ?? null,
      visibility: body.visibility,
      projectId: body.projectId ?? null,
      demoId: body.demoId ?? null,
      pluginId: body.pluginId,
    });

    return NextResponse.json(target);
  } catch (error) {
    return NextResponse.json<ApiError>(
      { error: error instanceof Error ? error.message : 'Unable to create plugin upload target' },
      { status: 400 },
    );
  }
}
