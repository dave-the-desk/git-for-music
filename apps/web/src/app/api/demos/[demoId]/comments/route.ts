import { prisma } from '@git-for-music/db';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type {
  ApiError,
  CreateDemoCommentRequest,
  DemoComment,
} from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import {
  commitDawProjectOperation,
} from '@/features/daw/server/command-api';
import { loadSnapshotStateForDemo } from '@/features/daw/server/snapshot-builder';

function toProjectedComment(comment: DemoComment): DemoComment {
  return comment;
}

async function resolveDemo(userId: string, demoId: string) {
  return prisma.demo.findFirst({
    where: {
      id: demoId,
      project: {
        group: {
          members: {
            some: {
              userId,
            },
          },
        },
      },
    },
    select: {
      id: true,
      projectId: true,
    },
  });
}

async function loadProjectedComments(projectId: string, demoId: string) {
  const state = await loadSnapshotStateForDemo(prisma, {
    projectId,
    demoId,
  });
  return state.comments;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ demoId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { demoId } = await params;
  const demo = await resolveDemo(user.id, demoId);
  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const comments = await loadProjectedComments(demo.projectId, demo.id);
  return NextResponse.json<DemoComment[]>(comments.map(toProjectedComment));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ demoId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { demoId } = await params;
  const demo = await resolveDemo(user.id, demoId);
  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const body = (await req.json()) as Partial<CreateDemoCommentRequest>;
  const commentBody = typeof body.body === 'string' ? body.body.trim() : '';
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : null;
  const segmentId = typeof body.segmentId === 'string' && body.segmentId.trim() ? body.segmentId.trim() : null;
  const startTimeMs =
    typeof body.startTimeMs === 'number' && Number.isFinite(body.startTimeMs) && body.startTimeMs >= 0
      ? body.startTimeMs
      : null;
  const endTimeMs =
    typeof body.endTimeMs === 'number' && Number.isFinite(body.endTimeMs) && body.endTimeMs >= 0
      ? body.endTimeMs
      : null;

  if (!commentBody) {
    return NextResponse.json<ApiError>({ error: 'Comment body cannot be empty' }, { status: 400 });
  }

  if (!trackId && segmentId) {
    return NextResponse.json<ApiError>({ error: 'trackId is required when using segmentId' }, { status: 400 });
  }

  const payload = {
    commentId: randomUUID(),
    demoId: demo.id,
    trackId,
    segmentId,
    startTimeMs,
    endTimeMs,
    body: commentBody,
    createdBy: user.id,
    resolved: false,
  } as const;

  const result = await commitDawProjectOperation(prisma, {
    projectId: demo.projectId,
    userId: user.id,
    request: {
      demoId: demo.id,
      operationType: 'COMMENT_ADDED',
      payload,
      baseSnapshotId: null,
      baseOperationSeq: 0,
      targetTrackId: trackId,
      targetSegmentId: segmentId,
      affectedTimeRange:
        startTimeMs !== null || endTimeMs !== null
          ? {
              startMs: startTimeMs ?? endTimeMs ?? 0,
              endMs: endTimeMs ?? startTimeMs ?? 0,
            }
          : null,
      idempotencyKey: randomUUID(),
      clientOperationId: randomUUID(),
    },
  });

  if ('conflict' in result && result.conflict) {
    return NextResponse.json<ApiError & { conflict: typeof result.conflict }>({
      error: result.conflict.reason,
      conflict: result.conflict,
    }, { status: 409 });
  }

  const comments = await loadProjectedComments(demo.projectId, demo.id);
  const created = comments.find((comment) => comment.id === payload.commentId) ?? comments.at(-1) ?? null;
  if (!created) {
    return NextResponse.json<ApiError>({ error: 'Could not create comment' }, { status: 500 });
  }

  return NextResponse.json<DemoComment>(created, { status: 201 });
}
