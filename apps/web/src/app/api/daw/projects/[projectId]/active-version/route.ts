import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { setUserActiveVersion } from '@/features/daw/server/command-api';
import type {
  DawSetUserActiveVersionRequest,
  DawSetUserActiveVersionResponse,
} from '@/features/daw/protocol';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const body = (await req.json()) as Partial<DawSetUserActiveVersionRequest>;

  if (!isNonEmptyString(body.demoId)) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  if (!isNonEmptyString(body.activeVersionId)) {
    return NextResponse.json<ApiError>({ error: 'activeVersionId is required' }, { status: 400 });
  }

  if (body.isFollowingHead !== undefined && typeof body.isFollowingHead !== 'boolean') {
    return NextResponse.json<ApiError>({ error: 'isFollowingHead must be a boolean' }, { status: 400 });
  }

  try {
    const result = await setUserActiveVersion(prisma, {
      projectId,
      demoId: body.demoId,
      userId: user.id,
      activeVersionId: body.activeVersionId,
      isFollowingHead: body.isFollowingHead,
    });

    if (!result) {
      return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
    }

    const response: DawSetUserActiveVersionResponse = {
      activeVersionId: result.activeVersionId ?? body.activeVersionId,
      isFollowingHead: result.isFollowingHead,
      activeBranchName: result.activeBranchName,
    };

    return NextResponse.json<DawSetUserActiveVersionResponse>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update active version';
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 404 });
    }
    if (message.toLowerCase().includes('required') || message.toLowerCase().includes('invalid')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 400 });
    }
    return NextResponse.json<ApiError>({ error: message }, { status: 500 });
  }
}
