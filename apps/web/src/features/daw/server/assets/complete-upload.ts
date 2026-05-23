import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, DawAssetCompleteUploadRequest, UploadTimingChoice, UploadTrackResponse } from '@git-for-music/shared';
import { checkpointDemoDawSnapshot, recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import { emitDawAssetProcessingStatus } from '@/features/daw/server/realtime-gateway';
import { verifyAssetUploadToken, assetObjectExists } from './storage-provider';

export async function completeUploadedOriginalAsset(input: {
  userId: string;
  uploadToken: string;
  metadata: DawAssetCompleteUploadRequest;
}) {
  const token = verifyAssetUploadToken(input.uploadToken);
  if (!token) {
    return NextResponse.json<ApiError>({ error: 'Invalid or expired upload token' }, { status: 400 });
  }

  if (Date.now() > Date.parse(token.expiresAt)) {
    return NextResponse.json<ApiError>({ error: 'Upload token expired' }, { status: 400 });
  }

  if (token.userId !== input.userId) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const uploadExists = await assetObjectExists(token.objectKey);
  if (!uploadExists) {
    return NextResponse.json<ApiError>({ error: 'Uploaded asset not found' }, { status: 404 });
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: token.demoId,
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

  if (!demo.currentVersionId) {
    return NextResponse.json<ApiError>({ error: 'Demo has no current version yet' }, { status: 400 });
  }

  let selectedSourceVersionId = demo.currentVersionId;
  if (token.sourceVersionId?.trim()) {
    const version = await prisma.demoVersion.findFirst({
      where: {
        id: token.sourceVersionId,
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

  const timingChoice =
    token.timingChoice === 'keepProjectTempo' ||
    token.timingChoice === 'updateProjectTempoFromUpload' ||
    token.timingChoice === 'uploadUnchanged'
      ? token.timingChoice
      : 'uploadUnchanged';

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    const nextVersion = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: selectedSourceVersionId,
      parentId: selectedSourceVersionId,
      label: `Added: ${typeof token.name === 'string' && token.name.trim() ? token.name.trim() : token.fileName.replace(/\.[^.]+$/, '')}`,
      description: 'Added audio track',
    });

    let trackId = token.trackId ?? null;
    if (token.createTrack || !trackId) {
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

      const createdTrack = await tx.track.create({
        data: {
          id: trackId ?? undefined,
          demoId: demo.id,
          name:
            typeof token.name === 'string' && token.name.trim()
              ? token.name.trim()
              : token.fileName.replace(/\.[^.]+$/, ''),
          position: (highestPositionTrack?.position ?? -1) + 1,
        },
        select: {
          id: true,
        },
      });
      trackId = createdTrack.id;
    } else {
      const existingTrack = await tx.track.findFirst({
        where: {
          id: trackId,
          demoId: demo.id,
        },
        select: {
          id: true,
        },
      });

      if (!existingTrack) {
        throw new Error('Track not found');
      }
    }

    if (!trackId) {
      throw new Error('Track not found');
    }

    const trackVersion = await tx.trackVersion.create({
      data: {
        trackId,
        demoVersionId: nextVersion.id,
        storageKey: `/${token.objectKey}`,
        mimeType: token.contentType || 'audio/mpeg',
        sizeBytes: BigInt(input.metadata.sizeBytes),
        checksum: input.metadata.checksum,
      },
      select: {
        id: true,
      },
    });

    const asset = await tx.audioAssetMetadata.create({
      data: {
        id: token.assetId,
        projectId: demo.project.id,
        demoId: demo.id,
        trackId,
        trackVersionId: trackVersion.id,
        assetKind: 'ORIGINAL',
        storageKey: `/${token.objectKey}`,
        mimeType: token.contentType,
        sampleRate: input.metadata.sampleRate,
        bitDepth: input.metadata.bitDepth,
        channelCount: input.metadata.channelCount,
        durationMs: input.metadata.durationMs,
        sizeBytes: BigInt(input.metadata.sizeBytes),
        checksum: input.metadata.checksum,
      },
      select: {
        id: true,
        storageKey: true,
      },
    });

    await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'ASSET_ADDED',
        payload: {
          assetId: asset.id,
          projectId: demo.project.id,
          demoId: demo.id,
          trackId,
          trackVersionId: trackVersion.id,
          assetKind: 'ORIGINAL',
          storageKey: asset.storageKey,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    const jobIds = await enqueueTrackUploadProcessingJobs(tx, {
      timingChoice: timingChoice as UploadTimingChoice,
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

  emitDawAssetProcessingStatus({
    projectId: demo.project.id,
    demoId: demo.id,
    assetId: token.assetId,
    status: 'queued',
    trackId: null,
    trackVersionId: createdTrackVersion.trackVersionId,
    message: createdTrackVersion.jobIds.length > 0 ? 'Processing jobs queued' : 'Upload completed without processing jobs',
  });

  const response: UploadTrackResponse = {
    trackVersionId: createdTrackVersion.trackVersionId,
    demoVersionId: createdTrackVersion.demoVersionId,
    status: 'ready',
    processingJobIds: createdTrackVersion.jobIds,
  };

  return NextResponse.json(response, { status: 201 });
}
