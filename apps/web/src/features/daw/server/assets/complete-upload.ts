import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type {
  ApiError,
  DawAssetCompleteUploadRequest,
  UploadRecordedClipResponse,
  UploadTimingChoice,
  UploadTrackResponse,
} from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  loadSnapshotStateForDemo,
  recordDemoDawOperation,
} from '@/features/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/features/daw/server/snapshot-builder';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import {
  emitAcceptedDawOperation,
  emitDawAssetProcessingStatus,
  emitDawProjectRebootstrapRequired,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import {
  serializeCreatedDemoTrackVersionTreeTrack,
  serializeCreatedDemoVersionTreeNode,
} from '@/features/daw/server/versioning';
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

  if (token.attachMode === 'clip') {
    const createdAsset = await prisma.$transaction(async (tx) => {
      let trackId = token.trackId ?? null;
      if (trackId) {
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
      } else {
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
      }

      const resolvedTrackId = trackId ?? '';

      const asset = await tx.audioAssetMetadata.create({
        data: {
          id: token.assetId,
          projectId: demo.project.id,
          demoId: demo.id,
          trackId: resolvedTrackId,
          trackVersionId: null,
          assetKind: 'ORIGINAL',
          storageKey: `/${token.objectKey}`,
          mimeType: token.contentType || 'audio/mpeg',
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

      const operation = await recordDemoDawOperation(
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
            trackId: resolvedTrackId,
            trackVersionId: null,
            assetKind: 'ORIGINAL',
            storageKey: asset.storageKey,
          },
        },
        {
          checkpointCreatedById: input.userId,
        },
      );

      if (operation.created) {
        emitAcceptedDawOperation({
          projectId: demo.project.id,
          demoId: demo.id,
          operationId: operation.id,
          operationSeq: operation.operationSeq,
          actorUserId: input.userId,
          operationType: operation.operationType ?? 'ASSET_ADDED',
          payload: operation.payload as DawProjectOperationRecord['payload'],
          createdAt: operation.createdAt ?? new Date().toISOString(),
          idempotencyKey: operation.idempotencyKey ?? null,
          clientOperationId: operation.clientOperationId ?? null,
          baseSnapshotId: operation.baseSnapshotId ?? null,
          baseOperationSeq: operation.baseOperationSeq ?? 0,
        });
      }

      const snapshotState = await loadSnapshotStateForDemo(tx, {
        projectId: demo.project.id,
        demoId: demo.id,
      });
      const takeCreatedAt = new Date().toISOString();
      const takePosition = snapshotState.recordingTakesByTrackId?.[resolvedTrackId]?.length ?? input.metadata.position ?? 0;
      const takeOperation = await recordDemoDawOperation(
        tx,
        {
          projectId: demo.project.id,
          demoId: demo.id,
          actorUserId: input.userId,
          operationType: 'TAKE_ADDED',
          payload: {
            trackId: resolvedTrackId,
            takeId: input.metadata.takeId?.trim() || token.assetId,
            assetId: asset.id,
            storageKey: asset.storageKey,
            name:
              typeof input.metadata.name === 'string' && input.metadata.name.trim()
                ? input.metadata.name.trim()
                : token.fileName.replace(/\.[^.]+$/, ''),
            trackVersionId: input.metadata.trackVersionId ?? null,
            startOffsetMs:
              typeof input.metadata.startOffsetMs === 'number' ? input.metadata.startOffsetMs : 0,
            durationMs: input.metadata.durationMs,
            sourceStartMs:
              typeof input.metadata.sourceStartMs === 'number' ? input.metadata.sourceStartMs : 0,
            sourceEndMs:
              typeof input.metadata.sourceEndMs === 'number'
                ? input.metadata.sourceEndMs
                : input.metadata.durationMs,
            timelineStartMs:
              typeof input.metadata.timelineStartMs === 'number'
                ? input.metadata.timelineStartMs
                : typeof input.metadata.startOffsetMs === 'number'
                  ? input.metadata.startOffsetMs
                  : 0,
            timelineEndMs:
              typeof input.metadata.timelineEndMs === 'number'
                ? input.metadata.timelineEndMs
                : (typeof input.metadata.startOffsetMs === 'number'
                    ? input.metadata.startOffsetMs
                    : 0) + input.metadata.durationMs,
            gainDb: typeof input.metadata.gainDb === 'number' ? input.metadata.gainDb : 0,
            fadeInMs: typeof input.metadata.fadeInMs === 'number' ? input.metadata.fadeInMs : 0,
            fadeOutMs: typeof input.metadata.fadeOutMs === 'number' ? input.metadata.fadeOutMs : 0,
            isMuted: input.metadata.isMuted ?? false,
            position: takePosition,
            recordedTempoBpm: input.metadata.recordedTempoBpm ?? null,
            sourceTempoBpm: input.metadata.sourceTempoBpm ?? null,
            createdAt: takeCreatedAt,
          },
        },
        {
          checkpointCreatedById: input.userId,
        },
      );

      if (takeOperation.created) {
        emitAcceptedDawOperation({
          projectId: demo.project.id,
          demoId: demo.id,
          operationId: takeOperation.id,
          operationSeq: takeOperation.operationSeq,
          actorUserId: input.userId,
          operationType: takeOperation.operationType ?? 'TAKE_ADDED',
          payload: takeOperation.payload as DawProjectOperationRecord['payload'],
          createdAt: takeOperation.createdAt ?? takeCreatedAt,
          idempotencyKey: takeOperation.idempotencyKey ?? null,
          clientOperationId: takeOperation.clientOperationId ?? null,
          baseSnapshotId: takeOperation.baseSnapshotId ?? null,
          baseOperationSeq: takeOperation.baseOperationSeq ?? 0,
        });
      }

      return {
        assetId: asset.id,
        storageKey: asset.storageKey,
      };
    });

    await checkpointDemoDawSnapshot(prisma, {
      projectId: demo.project.id,
      demoId: demo.id,
      createdById: input.userId,
    });

    const response: UploadRecordedClipResponse = {
      assetId: createdAsset.assetId,
      objectKey: createdAsset.storageKey.replace(/^\//, ''),
      status: 'ready',
    };

    return NextResponse.json(response, { status: 201 });
  }

  let trackVersionCreatedOperation: DemoDawOperationInsertResult | null = null;
  let versionCreatedOperation: DemoDawOperationInsertResult | null = null;
  let currentVersionChangedOperation: DemoDawOperationInsertResult | null = null;

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
        createdAt: true,
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

    const operation = await recordDemoDawOperation(
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

    if (operation.created) {
      emitAcceptedDawOperation({
        projectId: demo.project.id,
        demoId: demo.id,
        operationId: operation.id,
        operationSeq: operation.operationSeq,
        actorUserId: input.userId,
        operationType: operation.operationType ?? 'ASSET_ADDED',
        payload: operation.payload as DawProjectOperationRecord['payload'],
        createdAt: operation.createdAt ?? new Date().toISOString(),
        idempotencyKey: operation.idempotencyKey ?? null,
        clientOperationId: operation.clientOperationId ?? null,
        baseSnapshotId: operation.baseSnapshotId ?? null,
        baseOperationSeq: operation.baseOperationSeq ?? 0,
      });
    }

    versionCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'VERSION_BRANCH_CREATED',
        payload: {
          versionId: nextVersion.id,
          parentVersionId: nextVersion.parentId,
          branchName: nextVersion.label,
          label: nextVersion.label,
          createdAt: nextVersion.createdAt.toISOString(),
          createdBy: input.userId,
          operationSummary: nextVersion.description,
          sourceVersionId: selectedSourceVersionId,
          version: serializeCreatedDemoVersionTreeNode({
            id: nextVersion.id,
            label: nextVersion.label,
            description: nextVersion.description,
            parentId: nextVersion.parentId,
            createdAt: nextVersion.createdAt,
            isCurrent: true,
          }),
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    trackVersionCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'TRACK_VERSION_CREATED',
        payload: {
          versionId: nextVersion.id,
          trackId,
          trackVersionId: trackVersion.id,
          operationSummary: 'Added audio track',
          track: serializeCreatedDemoTrackVersionTreeTrack({
            trackId,
            trackName:
              typeof token.name === 'string' && token.name.trim()
                ? token.name.trim()
                : token.fileName.replace(/\.[^.]+$/, ''),
            trackPosition: 0,
            trackVersionId: trackVersion.id,
            storageKey: `/${token.objectKey}`,
            mimeType: token.contentType || 'audio/mpeg',
            durationMs: null,
            startOffsetMs: 0,
            createdAt: trackVersion.createdAt,
            isDerived: false,
            operationType: 'ORIGINAL',
            parentTrackVersionId: null,
            segments: [],
          }),
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

    currentVersionChangedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'CURRENT_VERSION_CHANGED',
        payload: {
          previousVersionId: demo.currentVersionId,
          currentVersionId: nextVersion.id,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

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

  const recordedTrackVersionOperation =
    trackVersionCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedVersionOperation = versionCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedCurrentVersionOperation =
    currentVersionChangedOperation as DemoDawOperationInsertResult | null;

  if (recordedVersionOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedVersionOperation.id,
      operationSeq: recordedVersionOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedVersionOperation.operationType ?? 'VERSION_BRANCH_CREATED',
      payload: recordedVersionOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedVersionOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedVersionOperation.idempotencyKey ?? null,
      clientOperationId: recordedVersionOperation.clientOperationId ?? null,
      baseSnapshotId: recordedVersionOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedVersionOperation.baseOperationSeq ?? 0,
    });
  }

  if (recordedTrackVersionOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedTrackVersionOperation.id,
      operationSeq: recordedTrackVersionOperation.operationSeq,
      actorUserId: input.userId,
      operationType:
        recordedTrackVersionOperation.operationType ?? 'TRACK_VERSION_CREATED',
      payload: recordedTrackVersionOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedTrackVersionOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedTrackVersionOperation.idempotencyKey ?? null,
      clientOperationId: recordedTrackVersionOperation.clientOperationId ?? null,
      baseSnapshotId: recordedTrackVersionOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedTrackVersionOperation.baseOperationSeq ?? 0,
    });
  }

  if (recordedCurrentVersionOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedCurrentVersionOperation.id,
      operationSeq: recordedCurrentVersionOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedCurrentVersionOperation.operationType ?? 'CURRENT_VERSION_CHANGED',
      payload:
        recordedCurrentVersionOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedCurrentVersionOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedCurrentVersionOperation.idempotencyKey ?? null,
      clientOperationId: recordedCurrentVersionOperation.clientOperationId ?? null,
      baseSnapshotId: recordedCurrentVersionOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedCurrentVersionOperation.baseOperationSeq ?? 0,
    });
  }

  emitDawVersionTreeChanged({
    projectId: demo.project.id,
    demoId: demo.id,
    actorUserId: input.userId,
  });

  emitDawProjectRebootstrapRequired({
    projectId: demo.project.id,
    demoId: demo.id,
    actorUserId: input.userId,
    reason: 'Completed upload changed the version tree and should be reconciled by clients',
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
