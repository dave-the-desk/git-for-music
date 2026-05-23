import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { renameTrackCommand } from '@/features/daw/server/commands';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackId } = await params;
  const body = (await req.json()) as { name?: unknown };
  return renameTrackCommand({
    userId: user.id,
    trackId,
    name: body.name,
  });
}
