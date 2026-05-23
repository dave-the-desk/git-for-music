import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { updateTrackOffsetCommand } from '@/features/daw/server/commands';

// startOffsetMs is timeline position metadata only — it does not touch the audio file
// (storageKey). Mutating it directly does not violate the "audio is never mutated" rule.
// We update in-place rather than creating a new DemoVersion because offset is UI layout
// data, not audio content, and creating a snapshot per drag would flood version history.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId } = await params;
  const body = (await req.json()) as { startOffsetMs?: unknown };
  return updateTrackOffsetCommand({
    userId: user.id,
    trackVersionId,
    startOffsetMs: body.startOffsetMs,
  });
}
