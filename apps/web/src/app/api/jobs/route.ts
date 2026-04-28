import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type {
  ApiError,
  ProcessingJobPayload,
  ProcessingJobType,
} from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { enqueueProcessingJob } from '@/lib/processing/jobs';

const QUEUABLE_JOB_TYPES = new Set<ProcessingJobType>([
  'TEMPO_ANALYSIS',
  'KEY_ANALYSIS',
  'TIME_STRETCH_TO_PROJECT',
  'PROJECT_RETEMPO_FROM_TRACK',
]);

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
  if (!body.type || !QUEUABLE_JOB_TYPES.has(body.type)) {
    return NextResponse.json<ApiError>({ error: 'Invalid processing job type' }, { status: 400 });
  }

  const jobType = body.type;

  if (typeof body.trackVersionId !== 'string' || !body.trackVersionId.trim()) {
    return NextResponse.json<ApiError>({ error: 'trackVersionId is required' }, { status: 400 });
  }

  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: body.trackVersionId,
      track: {
        demo: {
          project: {
            group: {
              members: {
                some: {
                  userId: user.id,
                },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!trackVersion) {
    return NextResponse.json<ApiError>({ error: 'Track version not found' }, { status: 404 });
  }

  const payload = body.payload ?? undefined;

  if (
    (body.type === 'TIME_STRETCH_TO_PROJECT' || body.type === 'PROJECT_RETEMPO_FROM_TRACK') &&
    (!payload || typeof payload !== 'object' || !('demoVersionId' in payload) || typeof (payload as { demoVersionId?: unknown }).demoVersionId !== 'string')
  ) {
    return NextResponse.json<ApiError>({ error: 'demoVersionId is required for this job type' }, { status: 400 });
  }

  const job = await prisma.$transaction(async (tx) => {
    return enqueueProcessingJob(tx, {
      type: jobType,
      trackVersionId: trackVersion.id,
      createdById: user.id,
      payload,
    });
  });

  return NextResponse.json({ id: job.id }, { status: 201 });
}
