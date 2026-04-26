import { NextRequest, NextResponse } from 'next/server';
import type { CreateDemoRequest, ApiError } from '@git-for-music/shared';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CreateDemoRequest>;

  if (!body.projectId || !body.name) {
    return NextResponse.json<ApiError>(
      { error: 'projectId and name are required' },
      { status: 400 },
    );
  }

  // TODO: persist via prisma, verify project membership
  return NextResponse.json(
    { id: 'placeholder-demo-id', name: body.name, projectId: body.projectId },
    { status: 201 },
  );
}
