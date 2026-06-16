import { NextRequest, NextResponse } from 'next/server';
import type { CreateCommentRequest, ApiError } from '@git-for-music/shared';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CreateCommentRequest>;

  if (!body.demoId || !body.body) {
    return NextResponse.json<ApiError>(
      { error: 'demoId and body are required' },
      { status: 400 },
    );
  }

  // TODO: persist, broadcast via Supabase Realtime
  return NextResponse.json(
    { id: 'placeholder-comment-id', demoId: body.demoId, body: body.body },
    { status: 201 },
  );
}
