import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, ProcessingJobPayload, ProcessingJobType } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createProcessingJobCommand } from '@git-for-music/server/app/lib/daw/server/jobs';

type CreateProcessingJobRequest = {
  type: ProcessingJobType;
  trackVersionId: string;
  payload?: ProcessingJobPayload;
};

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<CreateProcessingJobRequest>;
  return createProcessingJobCommand({
    userId: user.id,
    trackVersionId: typeof body.trackVersionId === 'string' ? body.trackVersionId : '',
    type: body.type as ProcessingJobType,
    payload: body.payload,
  });
}
