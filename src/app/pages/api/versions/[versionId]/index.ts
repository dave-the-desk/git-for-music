import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, UpdateDemoVersionTimingRequest } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { updateDemoVersionTimingCommand } from '@git-for-music/server/app/lib/daw/server/commands';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId } = await params;
  const body = (await req.json()) as Partial<UpdateDemoVersionTimingRequest>;
  return updateDemoVersionTimingCommand({
    userId: user.id,
    versionId,
    body,
  });
}
