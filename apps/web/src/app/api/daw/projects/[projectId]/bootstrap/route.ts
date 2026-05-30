import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { loadDawProjectBootstrap } from '@/features/daw/server/command-api';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const demoId = req.nextUrl.searchParams.get('demoId');
  const operationSeqParam = req.nextUrl.searchParams.get('operationSeq');
  const operationSeq =
    operationSeqParam === null || operationSeqParam === ''
      ? null
      : Number(operationSeqParam);
  if (!demoId) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  if (operationSeqParam !== null && (!Number.isFinite(operationSeq) || !Number.isInteger(operationSeq))) {
    return NextResponse.json<ApiError>({ error: 'operationSeq must be a number' }, { status: 400 });
  }

  const bootstrap = await loadDawProjectBootstrap(prisma, {
    projectId,
    demoId,
    userId: user.id,
    operationSeq,
  });

  if (!bootstrap) {
    return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(bootstrap);
}
