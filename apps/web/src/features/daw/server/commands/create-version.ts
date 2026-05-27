import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/features/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/features/daw/server/snapshot-builder';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
import {
  emitAcceptedDawOperation,
  emitDawProjectRebootstrapRequired,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import { serializeCreatedDemoVersionTreeNode } from '@/features/daw/server/versioning';

const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export async function createDemoVersionCommand(input: {
  userId: string;
  demoId: string;
  label?: string | null;
  description?: string | null;
  sourceVersionId?: string | null;
}) {
  if (!input.demoId.trim()) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  const label = input.label?.trim() ?? '';
  const description = input.description?.trim() ?? '';

  if (label.length > MAX_LABEL_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Version label must be ${MAX_LABEL_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
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
        },
      },
    },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const sourceVersionId = input.sourceVersionId ?? demo.currentVersionId;
  const previousCurrentVersionId = demo.currentVersionId ?? null;

  if (!sourceVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'No source version available to copy' },
      { status: 400 },
    );
  }

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
    return NextResponse.json<ApiError>(
      { error: 'Selected source version was not found' },
      { status: 404 },
    );
  }

  let versionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;
  let currentVersionChangedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const createdVersion = await prisma.$transaction(async (tx) => {
    const version = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: sourceVersion.id,
      parentId: sourceVersion.id,
      label: label || `Snapshot from ${sourceVersion.label}`,
      description: description || null,
    });

    await tx.demo.update({
      where: {
        id: demo.id,
      },
      data: {
        currentVersionId: version.id,
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
          versionId: version.id,
          parentVersionId: version.parentId,
          branchName: version.label,
          label: version.label,
          createdAt: version.createdAt.toISOString(),
          createdBy: input.userId,
          operationSummary: version.description,
          sourceVersionId: sourceVersion.id,
          version: serializeCreatedDemoVersionTreeNode({
            id: version.id,
            label: version.label,
            description: version.description,
            parentId: version.parentId,
            createdAt: version.createdAt,
            tempoBpm: version.tempoBpm,
            timeSignatureNum: version.timeSignatureNum,
            timeSignatureDen: version.timeSignatureDen,
            musicalKey: version.musicalKey,
            tempoSource: version.tempoSource,
            keySource: version.keySource,
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
          previousVersionId: previousCurrentVersionId,
          currentVersionId: version.id,
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    await checkpointDemoDawSnapshot(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      createdById: input.userId,
    });

    return version;
  });

  const recordedVersionCreatedOperation =
    versionCreatedOperation as DemoDawOperationInsertResult | null;
  const recordedCurrentVersionChangedOperation =
    currentVersionChangedOperation as DemoDawOperationInsertResult | null;

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
    reason: 'Version tree mutation completed via server fallback path',
  });

  return NextResponse.json(
    { id: createdVersion.id, label: createdVersion.label, demoId: input.demoId },
    { status: 201 },
  );
}
