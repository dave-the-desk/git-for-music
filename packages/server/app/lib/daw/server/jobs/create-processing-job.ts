import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type {
  ApiError,
  ProcessingJobPayload,
  ProcessingJobType,
} from '@git-for-music/shared';
import { enqueueProcessingJob } from '@/app/lib/daw/server/jobs';

const QUEUABLE_JOB_TYPES = new Set<ProcessingJobType>([
  'TEMPO_ANALYSIS',
  'KEY_ANALYSIS',
  'TIME_STRETCH_TO_PROJECT',
  'PROJECT_RETEMPO_FROM_TRACK',
]);

export async function createProcessingJobCommand(input: {
  userId: string;
  trackVersionId: string;
  type: ProcessingJobType;
  payload?: ProcessingJobPayload;
}) {
  if (!input.trackVersionId.trim()) {
    return NextResponse.json<ApiError>({ error: 'trackVersionId is required' }, { status: 400 });
  }

  if (!QUEUABLE_JOB_TYPES.has(input.type)) {
    return NextResponse.json<ApiError>({ error: 'Invalid processing job type' }, { status: 400 });
  }

  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: input.trackVersionId,
      track: {
        demo: {
          project: {
            group: {
              members: {
                some: {
                  userId: input.userId,
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

  const payload = input.payload ?? undefined;

  if (
    (input.type === 'TIME_STRETCH_TO_PROJECT' || input.type === 'PROJECT_RETEMPO_FROM_TRACK') &&
    (!payload ||
      typeof payload !== 'object' ||
      !('demoVersionId' in payload) ||
      typeof (payload as { demoVersionId?: unknown }).demoVersionId !== 'string')
  ) {
    return NextResponse.json<ApiError>(
      { error: 'demoVersionId is required for this job type' },
      { status: 400 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    return enqueueProcessingJob(tx, {
      type: input.type,
      trackVersionId: trackVersion.id,
      createdById: input.userId,
      payload,
    });
  });

  return NextResponse.json({ id: job.id }, { status: 201 });
}
