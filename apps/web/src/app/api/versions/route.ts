import { NextRequest, NextResponse } from 'next/server';
import type { CreateVersionRequest, ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { createDemoVersionCommand } from '@/features/daw/server/commands';

const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<CreateVersionRequest>;
  return createDemoVersionCommand({
    userId: user.id,
    demoId: body.demoId ?? '',
    label: body.label,
    description: body.description,
    sourceVersionId: body.sourceVersionId,
  });
}
