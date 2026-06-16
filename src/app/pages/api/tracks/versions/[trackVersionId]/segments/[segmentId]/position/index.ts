import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { moveSegmentCommand } from '@git-for-music/server/app/lib/daw/server/commands';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string; segmentId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId, segmentId } = await params;
  const body = (await req.json()) as { timelineStartMs?: unknown };
  return moveSegmentCommand({
    userId: user.id,
    trackVersionId,
    segmentId,
    timelineStartMs: body.timelineStartMs,
  });
}
