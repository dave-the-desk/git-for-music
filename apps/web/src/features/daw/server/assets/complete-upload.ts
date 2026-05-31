import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type {
  ApiError,
  DawAssetCompleteUploadRequest,
  UploadTimingChoice,
  UploadTrackResponse,
} from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/features/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/features/daw/server/snapshot-builder';
import {
  loadOrCreateDemoUserActiveVersionState,
} from '@/features/daw/server/demo-user-active-version';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import {
  emitAcceptedDawOperation,
  emitDawAssetProcessingStatus,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import {
  serializeCreatedDemoTrackVersionTreeTrack,
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

  const activeVersionState = await loadOrCreateDemoUserActiveVersionState(prisma, {
    projectId: demo.project.id,
    demoId: demo.id,
    userId: input.userId,
  });

  if (!activeVersionState.activeVersionId) {
    return NextResponse.json<ApiError>({ error: 'Demo has no current version yet' }, { status: 400 });
  }

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
  }

  const timingChoice =
    token.timingChoice === 'keepProjectTempo' ||
    token.timingChoice === 'updateProjectTempoFromUpload' ||
    token.timingChoice === 'uploadUnchanged'
      ? token.timingChoice
      : 'uploadUnchanged';

  const targetVersionId = activeVersionState.activeVersionId;
  let trackVersionCreatedOperation: DemoDawOperationInsertResult | null = null;

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    let trackName =
      typeof token.name === 'string' && token.name.trim()
        ? token.name.trim()
        : token.fileName.replace(/\.[^.]+$/, '');
    let trackPosition = 0;

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
          name: trackName,
          position: (highestPositionTrack?.position ?? -1) + 1,
        },
        select: {
          id: true,
          name: true,
          position: true,
        },
      });
      trackId = createdTrack.id;
      trackName = createdTrack.name;
      trackPosition = createdTrack.position;
    } else {
      const existingTrack = await tx.track.findFirst({
        where: {
          id: trackId,
          demoId: demo.id,
        },
        select: {
          id: true,
          name: true,
          position: true,
        },
      });

      if (!existingTrack) {
        throw new Error('Track not found');
      }

      trackName = existingTrack.name;
      trackPosition = existingTrack.position;
    }

    if (!trackId) {
      throw new Error('Track not found');
    }

    const trackVersion = await tx.trackVersion.create({
      data: {
        trackId,
        demoVersionId: targetVersionId,
        storageKey: `/${token.objectKey}`,
        mimeType: token.contentType || 'audio/mpeg',
        sizeBytes: BigInt(input.metadata.sizeBytes),
        checksum: input.metadata.checksum,
        startOffsetMs:
          typeof input.metadata.startOffsetMs === 'number'
            ? input.metadata.startOffsetMs
            : typeof input.metadata.timelineStartMs === 'number'
              ? input.metadata.timelineStartMs
              : 0,
        durationMs: input.metadata.durationMs,
        sampleRate: input.metadata.sampleRate,
        channels: input.metadata.channelCount,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    const isRecording = token.sourceType === 'recording';
    const timelineStartMs =
      typeof input.metadata.timelineStartMs === 'number'
        ? input.metadata.timelineStartMs
        : typeof input.metadata.startOffsetMs === 'number'
          ? input.metadata.startOffsetMs
          : 0;
    const sourceStartMs = typeof input.metadata.sourceStartMs === 'number' ? input.metadata.sourceStartMs : 0;
    const sourceEndMs =
      typeof input.metadata.sourceEndMs === 'number' ? input.metadata.sourceEndMs : input.metadata.durationMs;
    const segment =
      isRecording
        ? await tx.segment.create({
            data: {
              trackVersionId: trackVersion.id,
              startMs: sourceStartMs,
              endMs: sourceEndMs,
              timelineStartMs,
              gainDb: typeof input.metadata.gainDb === 'number' ? input.metadata.gainDb : 0,
              fadeInMs: typeof input.metadata.fadeInMs === 'number' ? input.metadata.fadeInMs : 0,
              fadeOutMs: typeof input.metadata.fadeOutMs === 'number' ? input.metadata.fadeOutMs : 0,
              isMuted: input.metadata.isMuted ?? false,
              position: typeof input.metadata.position === 'number' ? input.metadata.position : 0,
            },
            select: {
              id: true,
              startMs: true,
              endMs: true,
              timelineStartMs: true,
              gainDb: true,
              fadeInMs: true,
              fadeOutMs: true,
              isMuted: true,
              position: true,
            },
          })
        : null;

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

    trackVersionCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'TRACK_VERSION_CREATED',
        payload: {
          versionId: targetVersionId,
          trackId,
          trackVersionId: trackVersion.id,
          operationSummary: 'Added audio track',
          track: serializeCreatedDemoTrackVersionTreeTrack({
            trackId,
            trackName,
            trackPosition,
            trackVersionId: trackVersion.id,
            storageKey: `/${token.objectKey}`,
            mimeType: token.contentType || 'audio/mpeg',
            durationMs: input.metadata.durationMs,
            startOffsetMs:
              typeof input.metadata.startOffsetMs === 'number'
                ? input.metadata.startOffsetMs
                : timelineStartMs,
            createdAt: trackVersion.createdAt,
            isDerived: false,
            operationType: 'ORIGINAL',
            parentTrackVersionId: null,
            segments: segment
              ? [
                  {
                    id: segment.id,
                    trackVersionId: trackVersion.id,
                    startMs: segment.startMs,
                    endMs: segment.endMs,
                    timelineStartMs: segment.timelineStartMs,
                    timelineEndMs:
                      segment.timelineStartMs !== null
                        ? segment.timelineStartMs + (segment.endMs - segment.startMs)
                        : null,
                    gainDb: segment.gainDb,
                    fadeInMs: segment.fadeInMs,
                    fadeOutMs: segment.fadeOutMs,
                    isMuted: segment.isMuted,
                    position: segment.position,
                  },
                ]
              : [],
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
      demoVersionId: targetVersionId,
      trackVersionId: trackVersion.id,
      createdById: input.userId,
    });

    return {
      trackVersionId: trackVersion.id,
      demoVersionId: targetVersionId,
      jobIds,
    };
  });

  const recordedTrackVersionOperation =
    trackVersionCreatedOperation as DemoDawOperationInsertResult | null;

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

    emitDawVersionTreeChanged({
      projectId: demo.project.id,
      demoId: demo.id,
      actorUserId: input.userId,
    });
  }

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
