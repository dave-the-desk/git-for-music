import { NextRequest, NextResponse } from 'next/server';
import type { CreateVersionRequest, ApiError } from '@git-for-music/shared';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CreateVersionRequest>;

  if (!body.demoId || !body.label) {
    return NextResponse.json<ApiError>(
      { error: 'demoId and label are required' },
      { status: 400 },
    );
  }

  // TODO: snapshot current TrackVersions, create DemoVersion node
  return NextResponse.json(
    { id: 'placeholder-version-id', label: body.label, demoId: body.demoId },
    { status: 201 },
  );
}
