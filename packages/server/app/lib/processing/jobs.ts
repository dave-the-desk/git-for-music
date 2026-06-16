import type { Prisma } from '@git-for-music/db';
import type { ProcessingJobPayload, ProcessingJobType } from '@git-for-music/shared';

type ProcessingJobClient = Pick<Prisma.TransactionClient, 'processingJob'>;

export interface EnqueueProcessingJobInput {
  type: ProcessingJobType;
  trackVersionId: string;
  createdById: string;
  payload?: ProcessingJobPayload;
}

export async function enqueueProcessingJob(client: ProcessingJobClient, input: EnqueueProcessingJobInput) {
  const job = await client.processingJob.create({
    data: {
      type: input.type,
      status: 'PENDING',
      progress: 0,
      trackVersionId: input.trackVersionId,
      createdById: input.createdById,
      payload: input.payload ? (input.payload as Prisma.InputJsonValue) : undefined,
    },
    select: {
      id: true,
    },
  });

  return job;
}
