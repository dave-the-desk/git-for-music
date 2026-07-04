import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, RevertVersionRequest } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { revertToVersionCommand } from '@git-for-music/server/app/lib/daw/server/commands';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<RevertVersionRequest>;
  return await revertToVersionCommand({
    userId: user.id,
    demoId: body.demoId ?? '',
    sourceVersionId: body.sourceVersionId ?? '',
    label: body.label,
    description: body.description,
  });
}
