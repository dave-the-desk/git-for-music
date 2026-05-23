import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, UploadTimingChoice, UploadTrackResponse } from '@git-for-music/shared';
import { checkpointDemoDawSnapshot } from '@/features/daw/server/snapshot-builder';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import {
  fileNameWithoutExtension,
  storeTrackUploadAsset,
} from '@/features/daw/server/assets';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';

export async function uploadTrackCommand(input: {
  userId: string;
  demoId: string;
  name?: string | null;
  trackId?: string | null;
  sourceVersionId?: string | null;
  timingChoice?: string | null;
  file: File;
}) {
  if (!input.demoId.trim()) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: input.demoId,
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
    select: {
      id: true,
      currentVersionId: true,
      project: {
        select: {
          id: true,
          group: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const currentVersionId = demo.currentVersionId;
  if (!currentVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'Demo has no current version yet' },
      { status: 400 },
    );
  }

  let selectedSourceVersionId = currentVersionId;
  if (typeof input.sourceVersionId === 'string' && input.sourceVersionId.trim()) {
    const version = await prisma.demoVersion.findFirst({
      where: {
        id: input.sourceVersionId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!version) {
      return NextResponse.json<ApiError>({ error: 'Source version not found' }, { status: 404 });
    }

    selectedSourceVersionId = version.id;
  }

  const rawBuffer = Buffer.from(await input.file.arrayBuffer());
  const timestamp = Date.now();
  const originalName = input.file.name || `track-${timestamp}.wav`;
  const checksum = createHash('sha256').update(rawBuffer).digest('hex');
  const trackVersionId = randomUUID();
  const assetId = randomUUID();

  let existingTrackId: string | null = null;
  if (typeof input.trackId === 'string' && input.trackId) {
    const existingTrack = await prisma.track.findFirst({
      where: {
        id: input.trackId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingTrack) {
      return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
    }

    existingTrackId = existingTrack.id;
  }

  const trackId = existingTrackId ?? randomUUID();
  const uploadedAsset = await storeTrackUploadAsset({
    groupId: demo.project.group.id,
    projectId: demo.project.id,
    demoId: demo.id,
    trackId,
    trackVersionId,
    assetId,
    fileName: originalName,
    rawBuffer,
  });

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    const nextVersion = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: selectedSourceVersionId,
      parentId: selectedSourceVersionId,
      label: `Added: ${typeof input.name === 'string' && input.name.trim() ? input.name.trim() : fileNameWithoutExtension(uploadedAsset.originalName)}`,
      description: 'Added audio track',
    });

    if (!existingTrackId) {
      const highestPositionTrack = await tx.track.findFirst({
        where: {
          demoId: demo.id,
        },
        orderBy: {
          position: 'desc',
        },
        select: {
          position: true,
        },
      });

      await tx.track.create({
        data: {
          id: trackId,
          demoId: demo.id,
          name:
            typeof input.name === 'string' && input.name.trim()
              ? input.name.trim()
              : fileNameWithoutExtension(uploadedAsset.originalName),
          position: (highestPositionTrack?.position ?? -1) + 1,
        },
        select: {
          id: true,
        },
      });
    }

    const trackVersion = await tx.trackVersion.create({
      data: {
        id: trackVersionId,
        trackId,
        demoVersionId: nextVersion.id,
        storageKey: uploadedAsset.storageKey,
        mimeType: input.file.type || 'audio/mpeg',
        sizeBytes: BigInt(input.file.size),
        checksum,
      },
      select: {
        id: true,
      },
    });

    const timingChoice =
      input.timingChoice === 'keepProjectTempo' ||
      input.timingChoice === 'updateProjectTempoFromUpload' ||
      input.timingChoice === 'uploadUnchanged'
        ? (input.timingChoice as UploadTimingChoice)
        : 'uploadUnchanged';

    const jobIds = await enqueueTrackUploadProcessingJobs(tx, {
      timingChoice,
      demoId: demo.id,
      demoVersionId: nextVersion.id,
      trackVersionId: trackVersion.id,
      createdById: input.userId,
    });

    await tx.demo.update({
      where: {
        id: demo.id,
      },
      data: {
        currentVersionId: nextVersion.id,
      },
      select: {
        id: true,
      },
    });

    return {
      trackVersionId: trackVersion.id,
      demoVersionId: nextVersion.id,
      jobIds,
    };
  });

  await checkpointDemoDawSnapshot(prisma, {
    projectId: demo.project.id,
    demoId: demo.id,
    createdById: input.userId,
  });

  const response: UploadTrackResponse = {
    trackVersionId: createdTrackVersion.trackVersionId,
    demoVersionId: createdTrackVersion.demoVersionId,
    status: 'ready',
    processingJobIds: createdTrackVersion.jobIds,
  };

  return NextResponse.json(response, { status: 201 });
}
