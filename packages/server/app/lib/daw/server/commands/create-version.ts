import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, CreateVersionResponse } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/app/lib/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/app/lib/daw/server/snapshot-builder';
import {
  loadOrCreateDemoUserActiveVersionState,
  setDemoUserActiveVersion,
} from '@/app/lib/daw/server/demo-user-active-version';
import { createDemoVersionWithCopiedTracks } from '@/app/lib/daw/server/versions';
import {
  emitAcceptedDawOperation,
  emitDawVersionTreeChanged,
} from '@/app/lib/daw/server/realtime-gateway';
import { serializeCreatedDemoVersionTreeNode } from '@/app/lib/daw/server/versioning';

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

  const activeVersionState = await loadOrCreateDemoUserActiveVersionState(prisma, {
    projectId: demo.project.id,
    demoId: demo.id,
    userId: input.userId,
  });

  const sourceVersionId = input.sourceVersionId ?? activeVersionState.activeVersionId;

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

  // If the creator is extending the checkout they are currently on, treat it as
  // a head-advancing commit; otherwise preserve the side-branch semantics.
  const branchMode =
    sourceVersion.id === activeVersionState.activeVersionId ? 'continue' : 'fork';

  let versionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const createdVersion = await prisma.$transaction(async (tx) => {
    const version = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: sourceVersion.id,
      parentId: sourceVersion.id,
      kind: 'EXPLICIT',
      label: label || `Snapshot from ${sourceVersion.label}`,
      description: description || null,
    });

    await setDemoUserActiveVersion(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      userId: input.userId,
      versionId: version.id,
      isFollowingHead: true,
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
          branchMode,
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
            branchMode,
            tempoBpm: version.tempoBpm,
            timeSignatureNum: version.timeSignatureNum,
            timeSignatureDen: version.timeSignatureDen,
            musicalKey: version.musicalKey,
            tempoSource: version.tempoSource,
            keySource: version.keySource,
            kind: version.kind,
            isCurrent: true,
            tracks: version.tracks,
          }),
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

  emitDawVersionTreeChanged({
    projectId: demo.project.id,
    demoId: demo.id,
    actorUserId: input.userId,
  });

  const response: CreateVersionResponse = {
    id: createdVersion.id,
    label: createdVersion.label,
    demoId: input.demoId,
    activeVersionId: createdVersion.id,
    isFollowingHead: true,
    activeBranchName: createdVersion.label,
  };

  return NextResponse.json(response, { status: 201 });
}
