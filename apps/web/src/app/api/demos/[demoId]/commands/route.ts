import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { checkpointDemoCommand, recordDemoCommand } from '@/features/daw/server/commands';

type DemoCommandRequest =
  | {
      kind: 'record-operation';
      operationType: Parameters<typeof recordDemoCommand>[0]['operationType'];
      payload: Parameters<typeof recordDemoCommand>[0]['payload'];
      idempotencyKey?: string;
      clientOperationId?: string;
      checkpointTailOperations?: number;
    }
  | {
      kind: 'checkpoint-snapshot';
      createdById?: string | null;
    };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ demoId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { demoId } = await params;
  const body = (await req.json()) as Partial<DemoCommandRequest> & { kind?: string };

  if (body.kind === 'record-operation') {
    if (!body.operationType || !body.payload) {
      return NextResponse.json<ApiError>(
        { error: 'operationType and payload are required' },
        { status: 400 },
      );
    }

    return recordDemoCommand({
      userId: user.id,
      demoId,
      operationType: body.operationType,
      payload: body.payload,
      idempotencyKey: body.idempotencyKey,
      clientOperationId: body.clientOperationId,
      checkpointTailOperations: body.checkpointTailOperations,
    });
  }

  if (body.kind === 'checkpoint-snapshot') {
    return checkpointDemoCommand({
      userId: user.id,
      demoId,
      createdById: body.createdById ?? user.id,
    });
  }

  return NextResponse.json<ApiError>({ error: 'Unsupported command kind' }, { status: 400 });
}
