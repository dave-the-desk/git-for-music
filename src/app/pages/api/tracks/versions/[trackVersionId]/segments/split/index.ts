import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, SplitSegmentRequest } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { splitSegmentCommand } from '@git-for-music/server/app/lib/daw/server/commands';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId } = await params;
  const body = (await req.json()) as Partial<SplitSegmentRequest>;
  return splitSegmentCommand({
    userId: user.id,
    trackVersionId,
    body,
  });
}
