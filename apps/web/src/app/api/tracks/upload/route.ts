import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, UploadTimingChoice } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { uploadTrackCommand } from '@/features/daw/server/commands';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json<ApiError>(
      { error: 'multipart/form-data required' },
      { status: 415 },
    );
  }

  const formData = await req.formData();
  const demoId = formData.get('demoId');
  const name = formData.get('name');
  const incomingTrackId = formData.get('trackId');
  const sourceVersionId = formData.get('sourceVersionId');
  const timingChoiceRaw = formData.get('timingChoice');
  const file = formData.get('file');

  if (typeof demoId !== 'string' || !demoId.trim()) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json<ApiError>({ error: 'Audio file is required' }, { status: 400 });
  }

  return uploadTrackCommand({
    userId: user.id,
    demoId,
    name: typeof name === 'string' ? name : null,
    trackId: typeof incomingTrackId === 'string' ? incomingTrackId : null,
    sourceVersionId: typeof sourceVersionId === 'string' ? sourceVersionId : null,
    timingChoice:
      timingChoiceRaw === 'keepProjectTempo' ||
      timingChoiceRaw === 'updateProjectTempoFromUpload' ||
      timingChoiceRaw === 'uploadUnchanged'
        ? (timingChoiceRaw as UploadTimingChoice)
        : null,
    file,
  });
}
