import type { Prisma } from '@git-for-music/db';
import type { UploadTimingChoice } from '@git-for-music/shared';
import { enqueueProcessingJob } from '@/features/daw/server/jobs';

type UploadProcessingJobClient = Pick<Prisma.TransactionClient, 'processingJob'>;

export async function enqueueTrackUploadProcessingJobs(
  client: UploadProcessingJobClient,
  input: {
    timingChoice: UploadTimingChoice;
    demoId: string;
    demoVersionId: string;
    trackVersionId: string;
    createdById: string;
  },
) {
  const jobIds: string[] = [];

  if (input.timingChoice === 'keepProjectTempo') {
    const job = await enqueueProcessingJob(client, {
      type: 'TIME_STRETCH_TO_PROJECT',
      trackVersionId: input.trackVersionId,
      createdById: input.createdById,
      payload: {
        demoId: input.demoId,
        demoVersionId: input.demoVersionId,
        trackVersionId: input.trackVersionId,
      },
    });
    jobIds.push(job.id);
  } else if (input.timingChoice === 'updateProjectTempoFromUpload') {
    const job = await enqueueProcessingJob(client, {
      type: 'PROJECT_RETEMPO_FROM_TRACK',
      trackVersionId: input.trackVersionId,
      createdById: input.createdById,
      payload: {
        demoId: input.demoId,
        demoVersionId: input.demoVersionId,
        trackVersionId: input.trackVersionId,
      },
    });
    jobIds.push(job.id);
  }

  return jobIds;
}
