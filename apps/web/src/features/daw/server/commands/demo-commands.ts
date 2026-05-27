import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import { emitAcceptedDawOperation } from '@/features/daw/server/realtime-gateway';
import {
  checkpointDemoDawSnapshot,
  recordDemoDawOperation,
  type DemoDawOperationPayload,
  type DemoDawOperationType,
} from '@/features/daw/server/snapshot-builder';

export async function recordDemoCommand(input: {
  userId: string;
  demoId: string;
  operationType: DemoDawOperationType;
  payload: DemoDawOperationPayload;
  idempotencyKey?: string;
  clientOperationId?: string;
  checkpointTailOperations?: number;
}) {
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

  const result = await prisma.$transaction(async (tx) => {
    return recordDemoDawOperation(
      tx,
      {
        projectId: demo.project.id,
        demoId: demo.id,
        actorUserId: input.userId,
        operationType: input.operationType,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        clientOperationId: input.clientOperationId,
      },
      {
        checkpointTailOperations: input.checkpointTailOperations,
        checkpointCreatedById: input.userId,
      },
    );
  });

  if (result.created) {
    emitAcceptedDawOperation({
      projectId: demo.project.id,
      demoId: demo.id,
      operationId: result.id,
      operationSeq: result.operationSeq,
      actorUserId: input.userId,
      operationType: input.operationType,
      payload: input.payload as DawProjectOperationRecord['payload'],
      createdAt: result.createdAt ?? new Date().toISOString(),
      idempotencyKey: input.idempotencyKey ?? null,
      clientOperationId: input.clientOperationId ?? null,
      baseSnapshotId: result.baseSnapshotId ?? null,
      baseOperationSeq: result.baseOperationSeq ?? 0,
    });
  }

  return NextResponse.json(result, { status: 201 });
}

export async function checkpointDemoCommand(input: {
  userId: string;
  demoId: string;
  createdById?: string | null;
}) {
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

  const snapshot = await prisma.$transaction(async (tx) => {
    return checkpointDemoDawSnapshot(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      createdById: input.createdById ?? input.userId,
    });
  });

  return NextResponse.json(snapshot, { status: 201 });
}
