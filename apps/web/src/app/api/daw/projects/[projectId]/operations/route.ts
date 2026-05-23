import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import {
  commitDawProjectOperation,
  loadDawProjectOperations,
} from '@/features/daw/server/command-api';
import type { DawOperationCommitRequest } from '@/features/daw/protocol';

function parseAfterSeq(value: string | null) {
  if (value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const demoId = req.nextUrl.searchParams.get('demoId');
  if (!demoId) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  const afterSeq = parseAfterSeq(req.nextUrl.searchParams.get('afterSeq'));
  if (afterSeq === null) {
    return NextResponse.json<ApiError>({ error: 'afterSeq must be a non-negative number' }, { status: 400 });
  }

  const operations = await loadDawProjectOperations(prisma, {
    projectId,
    demoId,
    userId: user.id,
    afterSeq,
  });

  if (!operations) {
    return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({ operations });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const body = (await req.json()) as Partial<DawOperationCommitRequest> & {
    operationType?: string;
    payload?: unknown;
    idempotencyKey?: string;
    clientOperationId?: string;
    checkpointTailOperations?: unknown;
  };

  if (!body.demoId) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  if (!body.operationType || !body.payload) {
    return NextResponse.json<ApiError>(
      { error: 'operationType and payload are required' },
      { status: 400 },
    );
  }

  if (body.baseSnapshotId === undefined) {
    return NextResponse.json<ApiError>({ error: 'baseSnapshotId is required' }, { status: 400 });
  }

  if (typeof body.baseOperationSeq !== 'number' || !Number.isFinite(body.baseOperationSeq) || body.baseOperationSeq < 0) {
    return NextResponse.json<ApiError>({ error: 'baseOperationSeq is required' }, { status: 400 });
  }

  if (!body.clientOperationId) {
    return NextResponse.json<ApiError>({ error: 'clientOperationId is required' }, { status: 400 });
  }

  const idempotencyKey = body.idempotencyKey ?? req.headers.get('idempotency-key') ?? req.headers.get('x-idempotency-key');
  if (!idempotencyKey) {
    return NextResponse.json<ApiError>({ error: 'idempotencyKey is required' }, { status: 400 });
  }

  const checkpointTailOperations =
    typeof body.checkpointTailOperations === 'number' && Number.isFinite(body.checkpointTailOperations)
      ? Math.floor(body.checkpointTailOperations)
      : undefined;

  try {
    const result = await commitDawProjectOperation(prisma, {
      projectId,
      userId: user.id,
      request: {
        demoId: body.demoId,
        operationType: body.operationType as DawOperationCommitRequest['operationType'],
        payload: body.payload as DawOperationCommitRequest['payload'],
        baseSnapshotId: body.baseSnapshotId,
        baseOperationSeq: body.baseOperationSeq,
        targetTrackId: body.targetTrackId,
        targetSegmentId: body.targetSegmentId,
        affectedTimeRange: body.affectedTimeRange,
        idempotencyKey,
        clientOperationId: body.clientOperationId,
        checkpointTailOperations,
      } as DawOperationCommitRequest,
    });

    if ('conflict' in result && result.conflict) {
      return NextResponse.json(
        {
          error: result.conflict.reason,
          conflict: result.conflict,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(result.operation, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not commit operation';
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 404 });
    }
    if (message.toLowerCase().includes('no changes provided')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 400 });
    }
    if (message.toLowerCase().includes('required') || message.toLowerCase().includes('must be') || message.toLowerCase().includes('invalid')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 400 });
    }
    if (message.toLowerCase().includes('bounds no longer match')) {
      return NextResponse.json<ApiError>({ error: message }, { status: 409 });
    }
    return NextResponse.json<ApiError>({ error: message }, { status: 500 });
  }
}
