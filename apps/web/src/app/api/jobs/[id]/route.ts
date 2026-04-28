import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, JobStatusResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

function serializeJob(job: {
  id: string;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  result: unknown;
}) {
  const response: JobStatusResponse = {
    id: job.id,
    type: job.type as JobStatusResponse['type'],
    status: job.status as JobStatusResponse['status'],
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
    ...(job.result !== null ? { result: job.result } : {}),
  };

  return response;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json<ApiError>({ error: 'Job not found' }, { status: 404 });
  }

  const job = await prisma.processingJob.findFirst({
    where: {
      id,
      createdById: user.id,
    },
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      error: true,
      result: true,
    },
  });

  if (!job) {
    return NextResponse.json<ApiError>({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(serializeJob(job));
}
