import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, UploadTimingChoice, UploadTrackResponse } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/app/lib/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/app/lib/daw/server/snapshot-builder';
import { loadOrCreateDemoUserActiveVersionState, setDemoUserActiveVersion } from '@/app/lib/daw/server/demo-user-active-version';
import { enqueueTrackUploadProcessingJobs } from '@/app/lib/daw/server/jobs/upload-processing';
import { storeTrackUploadAsset } from '@/app/lib/daw/server/assets';
import {
  emitAcceptedDawOperation,
  emitDawVersionTreeChanged,
} from '@/app/lib/daw/server/realtime-gateway';
import {
  createDemoVersionWithCopiedTracks,
  serializeCreatedDemoTrackVersionTreeTrack,
  serializeCreatedDemoVersionTreeNode,
} from '@/app/lib/daw/server/versioning';
import { getDuplicateBlankTrackVersionIds } from '@/app/lib/daw/server/track-duplicate-cleanup';

function fileNameWithoutExtension(fileName: string) {
  const extension = path.extname(fileName);
  return fileName.slice(0, fileName.length - extension.length) || fileName;
}

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

  const currentVersionId = activeVersionState.activeVersionId;
  if (!currentVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'Demo has no current version yet' },
      { status: 400 },
    );
  }

  const sourceVersionId = input.sourceVersionId?.trim() || currentVersionId;
  const sourceVersion = await prisma.demoVersion.findFirst({
    where: {
      id: sourceVersionId,
      demoId: demo.id,
    },
    select: {
      id: true,
      label: true,
    },
  });

  if (!sourceVersion) {
    return NextResponse.json<ApiError>({ error: 'Source version not found' }, { status: 404 });
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
  const contentType = input.file.type || 'audio/mpeg';
  const uploadedAsset = await storeTrackUploadAsset({
    groupId: demo.project.group.id,
    projectId: demo.project.id,
    demoId: demo.id,
    trackId,
    trackVersionId,
    assetId,
    fileName: originalName,
    contentType,
    rawBuffer,
  });

  let versionBranchCreatedOperation: DemoDawOperationInsertResult | null = null;
  let trackVersionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    let effectiveTargetVersionId = currentVersionId;
    const branchMode =
      sourceVersion.id === activeVersionState.activeVersionId ? 'continue' : 'fork';
    const branchLabel = 'Added audio track';
    const branchDescription = `${branchLabel} from ${sourceVersion.label}`;
    const branchVersion = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: sourceVersion.id,
      parentId: sourceVersion.id,
      kind: 'BRANCH',
      label: branchLabel,
      description: branchDescription,
    });

    await setDemoUserActiveVersion(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      userId: input.userId,
      versionId: branchVersion.id,
      isFollowingHead: true,
    });

    versionBranchCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'VERSION_BRANCH_CREATED',
        payload: {
          versionId: branchVersion.id,
          parentVersionId: branchVersion.parentId,
          branchName: branchVersion.label,
          branchMode,
          label: branchVersion.label,
          createdAt: branchVersion.createdAt.toISOString(),
          createdBy: input.userId,
          operationSummary: branchVersion.description,
          sourceVersionId: sourceVersion.id,
          version: serializeCreatedDemoVersionTreeNode({
            id: branchVersion.id,
            label: branchVersion.label,
            description: branchVersion.description,
            parentId: branchVersion.parentId,
            createdAt: branchVersion.createdAt,
            branchMode,
            tempoBpm: branchVersion.tempoBpm,
            timeSignatureNum: branchVersion.timeSignatureNum,
            timeSignatureDen: branchVersion.timeSignatureDen,
            musicalKey: branchVersion.musicalKey,
            tempoSource: branchVersion.tempoSource,
            keySource: branchVersion.keySource,
            kind: branchVersion.kind,
            isCurrent: true,
            tracks: branchVersion.tracks,
          }),
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    effectiveTargetVersionId = branchVersion.id;

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
        demoVersionId: effectiveTargetVersionId,
        storageKey: uploadedAsset.storageKey,
        mimeType: contentType,
        sizeBytes: BigInt(input.file.size),
        checksum,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (contentType !== 'application/x-git-for-music-empty-track') {
      const duplicateTrackVersions = await tx.trackVersion.findMany({
        where: {
          demoVersionId: effectiveTargetVersionId,
        },
        select: {
          id: true,
          trackId: true,
          mimeType: true,
          track: {
            select: {
              name: true,
            },
          },
        },
      });
      const duplicateTrackVersionIds = getDuplicateBlankTrackVersionIds(
        duplicateTrackVersions.map((entry) => ({
          trackVersionId: entry.id,
          trackId: entry.trackId,
          trackName: entry.track.name,
          mimeType: entry.mimeType,
        })),
      ).filter((duplicateTrackVersionId) => duplicateTrackVersionId !== trackVersion.id);

      if (duplicateTrackVersionIds.length > 0) {
        await tx.trackVersion.deleteMany({
          where: {
            id: {
              in: duplicateTrackVersionIds,
            },
          },
        });
      }
    }

    trackVersionCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'TRACK_VERSION_CREATED',
        payload: {
          versionId: effectiveTargetVersionId,
          trackId,
          trackVersionId: trackVersion.id,
          operationSummary: branchLabel,
          version: serializeCreatedDemoVersionTreeNode({
            id: branchVersion.id,
            label: branchVersion.label,
            description: branchVersion.description,
            parentId: branchVersion.parentId,
            createdAt: branchVersion.createdAt,
            branchMode,
            tempoBpm: branchVersion.tempoBpm,
            timeSignatureNum: branchVersion.timeSignatureNum,
            timeSignatureDen: branchVersion.timeSignatureDen,
            musicalKey: branchVersion.musicalKey,
            tempoSource: branchVersion.tempoSource,
            keySource: branchVersion.keySource,
            kind: branchVersion.kind,
            isCurrent: true,
            tracks: branchVersion.tracks,
          }),
          track: serializeCreatedDemoTrackVersionTreeTrack({
            trackId,
            trackName: existingTrackName ?? trackName,
            trackPosition: existingTrackPosition ?? 0,
            trackVersionId: trackVersion.id,
            storageKey: uploadedAsset.storageKey,
            mimeType: contentType,
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
      demoVersionId: effectiveTargetVersionId,
      trackVersionId: trackVersion.id,
      createdById: input.userId,
    });

    return {
      trackVersionId: trackVersion.id,
      demoVersionId: effectiveTargetVersionId,
      jobIds,
    };
  });

  await checkpointDemoDawSnapshot(prisma, {
    projectId: demo.project.id,
    demoId: demo.id,
    createdById: input.userId,
  });

  const recordedVersionBranchOperation =
    versionBranchCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedTrackVersionCreatedOperation =
    trackVersionCreatedOperation as DemoDawOperationInsertResult | null;

  if (recordedVersionBranchOperation?.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedVersionBranchOperation.id,
      operationSeq: recordedVersionBranchOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedVersionBranchOperation.operationType ?? 'VERSION_BRANCH_CREATED',
      payload: recordedVersionBranchOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedVersionBranchOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedVersionBranchOperation.idempotencyKey ?? null,
      clientOperationId: recordedVersionBranchOperation.clientOperationId ?? null,
      baseSnapshotId: recordedVersionBranchOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedVersionBranchOperation.baseOperationSeq ?? 0,
    });
  }

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

    emitDawVersionTreeChanged({
      projectId: demo.project.id,
      demoId: demo.id,
      actorUserId: input.userId,
    });
  }

  const response: UploadTrackResponse = {
    trackVersionId: createdTrackVersion.trackVersionId,
    demoVersionId: createdTrackVersion.demoVersionId,
    status: 'ready',
    processingJobIds: createdTrackVersion.jobIds,
  };

  return NextResponse.json(response, { status: 201 });
}
