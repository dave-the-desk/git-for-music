import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createAssetDownloadUrl } from '@git-for-music/server/app/lib/daw/server/assets';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId } = await params;
  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: trackVersionId,
      track: {
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
    },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
    },
  });

  if (!trackVersion) {
    return NextResponse.json<ApiError>({ error: 'Track version not found' }, { status: 404 });
  }

  const download = await createAssetDownloadUrl({
    assetId: trackVersion.id,
    objectKey: trackVersion.storageKey,
    contentType: trackVersion.mimeType ?? undefined,
  });

  const upstream = await fetch(download.url);
  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => '');
    return NextResponse.json<ApiError>(
      {
        error:
          errorBody.trim().length > 0
            ? errorBody
            : 'Unable to load track audio from storage',
      },
      { status: upstream.status || 502 },
    );
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') ?? trackVersion.mimeType ?? 'audio/mpeg';
  headers.set('content-type', contentType);
  headers.set('cache-control', 'private, max-age=3600, immutable');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) {
    headers.set('content-length', contentLength);
  }

  const etag = upstream.headers.get('etag');
  if (etag) {
    headers.set('etag', etag);
  }

  const lastModified = upstream.headers.get('last-modified');
  if (lastModified) {
    headers.set('last-modified', lastModified);
  }

  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) {
    headers.set('accept-ranges', acceptRanges);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
