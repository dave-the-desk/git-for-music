import { describe, expect, it } from 'vitest';
import { enqueueTrackUploadProcessingJobs } from '@/app/lib/daw/server/jobs/upload-processing';

type ProcessingJobCreateInput = {
  data: {
    type: string;
    status: string;
    progress: number;
    trackVersionId: string;
    createdById: string;
    payload?: Record<string, unknown>;
  };
};

function createClient() {
  const calls: ProcessingJobCreateInput[] = [];
  return {
    calls,
    client: {
      processingJob: {
        async create(input: ProcessingJobCreateInput) {
          calls.push(input);
          return { id: `job-${calls.length}` };
        },
      },
    },
  };
}

describe('enqueueTrackUploadProcessingJobs', () => {
  it('keeps version keys on derived audio job payloads', async () => {
    const { calls, client } = createClient();

    const jobIds = await enqueueTrackUploadProcessingJobs(client, {
      timingChoice: 'keepProjectTempo',
      demoId: 'demo-1',
      demoVersionId: 'demo-version-1',
      trackVersionId: 'track-version-1',
      createdById: 'user-1',
    });

    expect(jobIds).toEqual(['job-1']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual({
      type: 'TIME_STRETCH_TO_PROJECT',
      status: 'PENDING',
      progress: 0,
      trackVersionId: 'track-version-1',
      createdById: 'user-1',
      payload: {
        demoId: 'demo-1',
        demoVersionId: 'demo-version-1',
        trackVersionId: 'track-version-1',
      },
    });
  });

  it('keeps version keys for project-tempo updates too', async () => {
    const { calls, client } = createClient();

    const jobIds = await enqueueTrackUploadProcessingJobs(client, {
      timingChoice: 'updateProjectTempoFromUpload',
      demoId: 'demo-2',
      demoVersionId: 'demo-version-2',
      trackVersionId: 'track-version-2',
      createdById: 'user-2',
    });

    expect(jobIds).toEqual(['job-1']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual({
      type: 'PROJECT_RETEMPO_FROM_TRACK',
      status: 'PENDING',
      progress: 0,
      trackVersionId: 'track-version-2',
      createdById: 'user-2',
      payload: {
        demoId: 'demo-2',
        demoVersionId: 'demo-version-2',
        trackVersionId: 'track-version-2',
      },
    });
  });
});
