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
import {
  loadOrCreateDemoUserActiveVersionState,
} from '@/features/daw/server/demo-user-active-version';
import { enqueueTrackUploadProcessingJobs } from '@/features/daw/server/jobs/upload-processing';
import {
  fileNameWithoutExtension,
  storeTrackUploadAsset,
} from '@/features/daw/server/assets';
import {
  emitAcceptedDawOperation,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import {
  serializeCreatedDemoTrackVersionTreeTrack,
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

  const targetVersionId = currentVersionId;
  let trackVersionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
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
        demoVersionId: targetVersionId,
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
          versionId: targetVersionId,
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

  await checkpointDemoDawSnapshot(prisma, {
    projectId: demo.project.id,
    demoId: demo.id,
    createdById: input.userId,
  });

  const recordedTrackVersionCreatedOperation =
    trackVersionCreatedOperation as DemoDawOperationInsertResult | null;

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
