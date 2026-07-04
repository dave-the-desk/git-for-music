import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/app/lib/daw/protocol';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
} from '@/app/lib/daw/server/snapshot-builder';
import type { DemoDawOperationInsertResult } from '@/app/lib/daw/server/snapshot-builder';
import { setDemoUserActiveVersion } from '@/app/lib/daw/server/demo-user-active-version';
import { isValidTempoBpm } from '@/app/lib/daw/utils/timing';
import { emitAcceptedDawOperation } from '@/app/lib/daw/server/realtime-gateway';
import { emitWorkspaceRealtimeChanged } from '../../../workspace-realtime';
import { serializeCreatedDemoVersionTreeNode } from '@/app/lib/daw/server/versioning';

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const DEFAULT_SHARED_TEMPO_BPM = 100;

export async function createDemoCommand(input: {
  userId: string;
  projectId: string;
  name: string;
  description?: string | null;
  sharedDemoTempoBpm?: number | null;
}) {
  const name = input.name.trim();
  const description = input.description?.trim() ?? '';
  const sharedDemoTempoBpm = isValidTempoBpm(input.sharedDemoTempoBpm)
    ? input.sharedDemoTempoBpm
    : DEFAULT_SHARED_TEMPO_BPM;

  if (!input.projectId || !name) {
    return NextResponse.json<ApiError>(
      { error: 'projectId and name are required' },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Demo name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      group: {
        members: {
          some: {
            userId: input.userId,
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      group: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
  }

  let versionCreatedOperation:
    | Awaited<ReturnType<typeof recordDemoDawOperation>>
    | null = null;

  const demo = await prisma.$transaction(async (tx) => {
    const createdDemo = await tx.demo.create({
      data: {
        projectId: project.id,
        name,
        description: description || null,
      },
      select: {
        id: true,
        name: true,
        projectId: true,
      },
    });

    const initialVersion = await tx.demoVersion.create({
      data: {
        demoId: createdDemo.id,
        label: 'Initial version',
        description: 'Created demo',
        kind: 'EXPLICIT',
        tempoBpm: sharedDemoTempoBpm,
        parentId: null,
      },
      select: {
        id: true,
        label: true,
        description: true,
        tempoBpm: true,
        timeSignatureNum: true,
        timeSignatureDen: true,
        musicalKey: true,
        tempoSource: true,
        keySource: true,
        createdAt: true,
        parentId: true,
      },
    });

    await tx.demo.update({
      where: {
        id: createdDemo.id,
      },
      data: {
        currentVersionId: initialVersion.id,
      },
      select: {
        id: true,
      },
    });

    await setDemoUserActiveVersion(tx, {
      projectId: project.id,
      demoId: createdDemo.id,
      userId: input.userId,
      versionId: initialVersion.id,
      isFollowingHead: true,
    });

    versionCreatedOperation = await recordDemoDawOperation(
      tx,
      {
        projectId: project.id,
        demoId: createdDemo.id,
        actorUserId: input.userId,
        operationType: 'VERSION_CREATED',
        payload: {
          versionId: initialVersion.id,
          parentVersionId: initialVersion.parentId,
          branchName: initialVersion.label,
          branchMode: 'continue',
          label: initialVersion.label,
          createdAt: initialVersion.createdAt.toISOString(),
          createdBy: input.userId,
          operationSummary: initialVersion.description,
          version: serializeCreatedDemoVersionTreeNode({
            id: initialVersion.id,
            label: initialVersion.label,
            description: initialVersion.description,
            parentId: initialVersion.parentId,
            createdAt: initialVersion.createdAt,
            branchMode: 'continue',
            tempoBpm: initialVersion.tempoBpm,
            timeSignatureNum: initialVersion.timeSignatureNum,
            timeSignatureDen: initialVersion.timeSignatureDen,
            musicalKey: initialVersion.musicalKey,
            tempoSource: initialVersion.tempoSource,
            keySource: initialVersion.keySource,
            kind: 'EXPLICIT',
            isCurrent: true,
          }),
        },
      },
      {
        checkpointCreatedById: input.userId,
      },
    );

    await checkpointDemoDawSnapshot(tx, {
      projectId: project.id,
      demoId: createdDemo.id,
      createdById: input.userId,
    });

    return createdDemo;
  });

  const recordedVersionCreatedOperation =
    versionCreatedOperation as DemoDawOperationInsertResult | null;

  if (recordedVersionCreatedOperation?.created) {
    emitAcceptedDawOperation({
      projectId: project.id,
      demoId: demo.id,
      operationId: recordedVersionCreatedOperation.id,
      operationSeq: recordedVersionCreatedOperation.operationSeq,
      actorUserId: input.userId,
      operationType: recordedVersionCreatedOperation.operationType ?? 'VERSION_CREATED',
      payload: recordedVersionCreatedOperation.payload as DawProjectOperationRecord['payload'],
      createdAt: recordedVersionCreatedOperation.createdAt ?? new Date().toISOString(),
      idempotencyKey: recordedVersionCreatedOperation.idempotencyKey ?? null,
      clientOperationId: recordedVersionCreatedOperation.clientOperationId ?? null,
      baseSnapshotId: recordedVersionCreatedOperation.baseSnapshotId ?? null,
      baseOperationSeq: recordedVersionCreatedOperation.baseOperationSeq ?? 0,
    });
  }

  emitWorkspaceRealtimeChanged(`project:${project.group.slug}:${project.slug}`, {
    actorUserId: input.userId,
    reason: 'demo-created',
  });

  return NextResponse.json(
    {
      id: demo.id,
      name: demo.name,
      projectId: demo.projectId,
      projectSlug: project.slug,
      groupSlug: project.group.slug,
    },
    { status: 201 },
  );
}
