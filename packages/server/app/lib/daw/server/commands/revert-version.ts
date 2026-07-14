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
  emitDawReverted,
} from '@/app/lib/daw/server/realtime-gateway';
import {
  loadUserDisplayName,
  serializeCreatedDemoVersionTreeNode,
} from '@/app/lib/daw/server/versioning';

const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

type RevertToVersionCommandDeps = {
  client?: typeof prisma;
  loadOrCreateDemoUserActiveVersionState?: typeof loadOrCreateDemoUserActiveVersionState;
  setDemoUserActiveVersion?: typeof setDemoUserActiveVersion;
  createDemoVersionWithCopiedTracks?: typeof createDemoVersionWithCopiedTracks;
  recordDemoDawOperation?: typeof recordDemoDawOperation;
  checkpointDemoDawSnapshot?: typeof checkpointDemoDawSnapshot;
  emitAcceptedDawOperation?: typeof emitAcceptedDawOperation;
  emitDawReverted?: typeof emitDawReverted;
};

function isAncestorVersion(
  ancestorVersionId: string,
  descendantVersionId: string,
  versions: Array<{ id: string; parentId: string | null }>,
) {
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const visited = new Set<string>();
  let currentVersionId: string | null = descendantVersionId;

  while (currentVersionId) {
    if (currentVersionId === ancestorVersionId) {
      return true;
    }

    if (visited.has(currentVersionId)) {
      break;
    }

    visited.add(currentVersionId);
    currentVersionId = versionsById.get(currentVersionId)?.parentId ?? null;
  }

  return false;
}

export async function revertToVersionCommand(
  input: {
    userId: string;
    demoId: string;
    sourceVersionId: string;
    label?: string | null;
    description?: string | null;
  },
  deps: RevertToVersionCommandDeps = {},
) {
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

  const db = deps.client ?? prisma;
  const loadOrCreateActiveVersionState =
    deps.loadOrCreateDemoUserActiveVersionState ?? loadOrCreateDemoUserActiveVersionState;
  const setActiveVersion = deps.setDemoUserActiveVersion ?? setDemoUserActiveVersion;
  const createVersion = deps.createDemoVersionWithCopiedTracks ?? createDemoVersionWithCopiedTracks;
  const recordOperation = deps.recordDemoDawOperation ?? recordDemoDawOperation;
  const checkpointSnapshot = deps.checkpointDemoDawSnapshot ?? checkpointDemoDawSnapshot;
  const emitOperation = deps.emitAcceptedDawOperation ?? emitAcceptedDawOperation;
  const emitReverted = deps.emitDawReverted ?? emitDawReverted;

  const demo = await db.demo.findFirst({
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

  const sourceVersion = await db.demoVersion.findFirst({
    where: {
      id: input.sourceVersionId,
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

  const activeVersionState = await loadOrCreateActiveVersionState(db, {
    projectId: demo.project.id,
    demoId: demo.id,
    userId: input.userId,
  });

  const versions = await db.demoVersion.findMany({
    where: {
      demoId: demo.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      parentId: true,
    },
  });

  const currentVersionId = versions[0]?.id ?? null;
  if (!currentVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'No current version available for revert' },
      { status: 400 },
    );
  }

  const shouldFollowHead = activeVersionState.isFollowingHead;

  if (!isAncestorVersion(sourceVersion.id, currentVersionId, versions)) {
    return NextResponse.json<ApiError>(
      { error: 'Selected version must be an ancestor of the current branch head' },
      { status: 400 },
    );
  }

  let versionCreatedOperation: Awaited<ReturnType<typeof recordDemoDawOperation>> | null = null;

  const createdVersion = await db.$transaction(async (tx) => {
    const createdByName = await loadUserDisplayName(tx, input.userId);
    const version = await createVersion(tx, {
      demoId: demo.id,
      sourceVersionId: sourceVersion.id,
      parentId: currentVersionId,
      kind: 'REVERT',
      label: label || `Revert to ${sourceVersion.label}`,
      description: description || null,
      createdByName,
    });

    if (shouldFollowHead) {
      await setActiveVersion(tx, {
        projectId: demo.project.id,
        demoId: demo.id,
        userId: input.userId,
        versionId: version.id,
        isFollowingHead: true,
      });
    }

    versionCreatedOperation = await recordOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: 'VERSION_REVERTED_FROM',
        payload: {
          branchMode: 'continue',
          versionId: version.id,
          branchName: version.label,
          label: version.label,
          createdAt: version.createdAt.toISOString(),
          createdBy: input.userId,
          operationSummary: version.description,
          revertedFromVersionId: sourceVersion.id,
          currentVersionId: version.id,
          version: serializeCreatedDemoVersionTreeNode({
            id: version.id,
            label: version.label,
            description: version.description,
            createdByName: version.createdByName,
            parentId: version.parentId,
            createdAt: version.createdAt,
            branchMode: 'continue',
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

    await checkpointSnapshot(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      createdById: input.userId,
    });

    return version;
  });

  const recordedVersionCreatedOperation =
    versionCreatedOperation as DemoDawOperationInsertResult | null;

  if (recordedVersionCreatedOperation?.created) {
    emitOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: recordedVersionCreatedOperation.id,
      operationSeq: recordedVersionCreatedOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedVersionCreatedOperation.operationType ?? 'VERSION_REVERTED_FROM',
      payload: recordedVersionCreatedOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedVersionCreatedOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedVersionCreatedOperation.idempotencyKey ?? null,
      clientOperationId: recordedVersionCreatedOperation.clientOperationId ?? null,
      baseSnapshotId: recordedVersionCreatedOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedVersionCreatedOperation.baseOperationSeq ?? 0,
    });
  }

  emitReverted({
    projectId: demo.project.id,
    demoId: demo.id,
    actorUserId: input.userId,
    versionId: createdVersion.id,
    parentVersionId: createdVersion.parentId,
    revertedFromVersionId: sourceVersion.id,
    revertedToOperationId: recordedVersionCreatedOperation?.id ?? null,
    operationSeq: recordedVersionCreatedOperation?.operationSeq ?? null,
  });

  const response: CreateVersionResponse = {
    id: createdVersion.id,
    label: createdVersion.label,
    demoId: input.demoId,
    activeVersionId: shouldFollowHead ? createdVersion.id : activeVersionState.activeVersionId ?? createdVersion.id,
    isFollowingHead: shouldFollowHead,
    activeBranchName: shouldFollowHead ? createdVersion.label : activeVersionState.activeBranchName,
  };

  return NextResponse.json(response, { status: 201 });
}
