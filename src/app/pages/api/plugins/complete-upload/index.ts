import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { completePluginUpload } from '@git-for-music/server/app/lib/plugins';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<{ uploadToken: string }>;
  if (!body.uploadToken) {
    return NextResponse.json<ApiError>({ error: 'uploadToken is required' }, { status: 400 });
  }

  try {
    const result = await completePluginUpload(prisma, {
      userId: user.id,
      uploadToken: body.uploadToken,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete plugin upload';
    const status = message === 'Unauthorized' ? 401 : message === 'Demo not found' || message === 'Uploaded plugin bundle not found' ? 404 : 400;
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
