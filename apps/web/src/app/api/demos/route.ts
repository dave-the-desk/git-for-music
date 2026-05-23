import { NextRequest, NextResponse } from 'next/server';
import type { CreateDemoRequest, ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { createDemoCommand } from '@/features/daw/server/commands';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<CreateDemoRequest>;
  return createDemoCommand({
    userId: user.id,
    projectId: body.projectId ?? '',
    name: body.name ?? '',
    description: body.description,
    sharedDemoTempoBpm: body.sharedDemoTempoBpm,
  });
}
