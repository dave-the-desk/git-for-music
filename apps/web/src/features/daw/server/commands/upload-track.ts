import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, UploadTimingChoice, UploadTrackResponse } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/features/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/features/daw/server/snapshot-builder';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import {
  fileNameWithoutExtension,
  storeTrackUploadAsset,
} from '@/features/daw/server/assets';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
import {
  emitAcceptedDawOperation,
  emitDawProjectRebootstrapRequired,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import {
  serializeCreatedDemoTrackVersionTreeTrack,
  serializeCreatedDemoVersionTreeNode,
} from '@/features/daw/server/versioning';

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
  let existingTrackName: string | null = null;
  let existingTrackPosition: number | null = null;
  if (typeof input.trackId === 'string' && input.trackId) {
    const existingTrack = await prisma.track.findFirst({
      where: {
        id: input.trackId,
        demoId: demo.id,
      },
      select: {
        id: true,
        name: true,
        position: true,
      },
    });

    if (!existingTrack) {
      return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
    }

    existingTrackId = existingTrack.id;
    existingTrackName = existingTrack.name;
    existingTrackPosition = existingTrack.position;
  }

  const trackId = existingTrackId ?? randomUUID();
  const trackName =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : fileNameWithoutExtension(originalName);
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

  let trackVersionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;
  let versionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;
  let currentVersionChangedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    const nextVersion = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: selectedSourceVersionId,
      parentId: selectedSourceVersionId,
      label: `Added: ${trackName}`,
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

      const createdTrack = await tx.track.create({
        data: {
          id: trackId,
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
      existingTrackId = createdTrack.id;
      existingTrackName = createdTrack.name;
      existingTrackPosition = createdTrack.position;
    } else if (existingTrackName === null || existingTrackPosition === null) {
      const track = await tx.track.findFirst({
        where: {
          id: trackId,
          demoId: demo.id,
        },
        select: {
          name: true,
          position: true,
        },
      });
      existingTrackName = track?.name ?? trackName;
      existingTrackPosition = track?.position ?? 0;
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
        createdAt: true,
      },
    });

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
            trackName: existingTrackName ?? trackName,
            trackPosition: existingTrackPosition ?? 0,
            trackVersionId: trackVersion.id,
            storageKey: uploadedAsset.storageKey,
            mimeType: input.file.type || 'audio/mpeg',
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

    currentVersionChangedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'CURRENT_VERSION_CHANGED',
        payload: {
          previousVersionId: currentVersionId,
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

  const recordedTrackVersionCreatedOperation =
    trackVersionCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedVersionCreatedOperation =
    versionCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedCurrentVersionChangedOperation =
    currentVersionChangedOperation as DemoDawOperationInsertResult | null;

  if (recordedTrackVersionCreatedOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedTrackVersionCreatedOperation.id,
      operationSeq: recordedTrackVersionCreatedOperation.operationSeq,
      actorUserId: input.userId,
      operationType:
        recordedTrackVersionCreatedOperation.operationType ?? 'TRACK_VERSION_CREATED',
      payload: recordedTrackVersionCreatedOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedTrackVersionCreatedOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedTrackVersionCreatedOperation.idempotencyKey ?? null,
      clientOperationId: recordedTrackVersionCreatedOperation.clientOperationId ?? null,
      baseSnapshotId: recordedTrackVersionCreatedOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedTrackVersionCreatedOperation.baseOperationSeq ?? 0,
    });
  }

  if (recordedVersionCreatedOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedVersionCreatedOperation.id,
      operationSeq: recordedVersionCreatedOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedVersionCreatedOperation.operationType ?? 'VERSION_BRANCH_CREATED',
      payload: recordedVersionCreatedOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedVersionCreatedOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedVersionCreatedOperation.idempotencyKey ?? null,
      clientOperationId: recordedVersionCreatedOperation.clientOperationId ?? null,
      baseSnapshotId: recordedVersionCreatedOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedVersionCreatedOperation.baseOperationSeq ?? 0,
    });
  }

  if (recordedCurrentVersionChangedOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedCurrentVersionChangedOperation.id,
      operationSeq: recordedCurrentVersionChangedOperation.operationSeq,
      actorUserId: input.userId,
      operationType:
        recordedCurrentVersionChangedOperation.operationType ?? 'CURRENT_VERSION_CHANGED',
      payload:
        recordedCurrentVersionChangedOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedCurrentVersionChangedOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedCurrentVersionChangedOperation.idempotencyKey ?? null,
      clientOperationId: recordedCurrentVersionChangedOperation.clientOperationId ?? null,
      baseSnapshotId: recordedCurrentVersionChangedOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedCurrentVersionChangedOperation.baseOperationSeq ?? 0,
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
    reason: 'Upload created a new version head and should be reconciled by clients',
  });

  const response: UploadTrackResponse = {
    trackVersionId: createdTrackVersion.trackVersionId,
    demoVersionId: createdTrackVersion.demoVersionId,
    status: 'ready',
    processingJobIds: createdTrackVersion.jobIds,
  };

  return NextResponse.json(response, { status: 201 });
}
