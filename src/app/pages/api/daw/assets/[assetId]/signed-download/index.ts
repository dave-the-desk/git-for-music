import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, DawAssetSignedDownloadResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createAssetDownloadUrl } from '@git-for-music/server/app/lib/daw/server/assets';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(_req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await prisma.audioAssetMetadata.findFirst({
    where: {
      id: assetId,
      demo: {
        project: {
          group: {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
    },
  });

  if (!asset) {
    return NextResponse.json<ApiError>({ error: 'Asset not found' }, { status: 404 });
  }

  const url = await createAssetDownloadUrl({
    assetId: asset.id,
    objectKey: asset.storageKey,
    contentType: asset.mimeType,
  });

  const response: DawAssetSignedDownloadResponse = {
    assetId: asset.id,
    url: url.url,
    expiresAt: url.expiresAt,
    localFallback: url.localFallback,
  };

  return NextResponse.json(response);
}
