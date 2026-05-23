import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, DawAssetCompleteUploadRequest } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { completeUploadedOriginalAsset } from '@/features/daw/server/assets';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<DawAssetCompleteUploadRequest> & { uploadToken?: string };
  if (
    !body.uploadToken ||
    typeof body.checksum !== 'string' ||
    typeof body.durationMs !== 'number' ||
    typeof body.sampleRate !== 'number' ||
    typeof body.bitDepth !== 'number' ||
    typeof body.channelCount !== 'number' ||
    typeof body.sizeBytes !== 'number'
  ) {
    return NextResponse.json<ApiError>(
      {
        error:
          'uploadToken, checksum, durationMs, sampleRate, bitDepth, channelCount, and sizeBytes are required',
      },
      { status: 400 },
    );
  }

  return completeUploadedOriginalAsset({
    userId: user.id,
    uploadToken: body.uploadToken,
    metadata: {
      uploadToken: body.uploadToken,
      checksum: body.checksum,
      durationMs: body.durationMs,
      sampleRate: body.sampleRate,
      bitDepth: body.bitDepth,
      channelCount: body.channelCount,
      sizeBytes: body.sizeBytes,
    },
  });
}
