import { NextRequest, NextResponse } from 'next/server';
import type { CreateVersionRequest, ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createDemoVersionCommand } from '@git-for-music/server/app/lib/daw/server/commands';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<CreateVersionRequest>;
  return await createDemoVersionCommand({
    userId: user.id,
    demoId: body.demoId ?? '',
    label: body.label,
    description: body.description,
    sourceVersionId: body.sourceVersionId,
  });
}
