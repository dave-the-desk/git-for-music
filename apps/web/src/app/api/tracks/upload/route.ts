import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json<ApiError>(
      { error: 'multipart/form-data required' },
      { status: 415 },
    );
  }

  // TODO: stream to R2, create TrackVersion, enqueue WAVEFORM job
  return NextResponse.json(
    { trackVersionId: 'placeholder-tv-id', status: 'queued' },
    { status: 202 },
  );
}
