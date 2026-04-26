import { NextRequest, NextResponse } from 'next/server';
import type { JobStatusResponse, ApiError } from '@git-for-music/shared';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // TODO: query ProcessingJob from database
  const placeholder: JobStatusResponse = {
    id,
    type: 'WAVEFORM',
    status: 'PENDING',
    progress: 0,
  };

  if (!id) {
    return NextResponse.json<ApiError>({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(placeholder);
}
