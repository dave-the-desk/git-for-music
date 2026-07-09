import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { listUserPlugins } from '@git-for-music/server/app/lib/plugins';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const plugins = await listUserPlugins(prisma, user.id);
  return NextResponse.json({ plugins });
}

export async function POST() {
  return NextResponse.json<ApiError>({ error: 'Use /api/plugins/sign-upload to create plugin uploads' }, { status: 405 });
}
