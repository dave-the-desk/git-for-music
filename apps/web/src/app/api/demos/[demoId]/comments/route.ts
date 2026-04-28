import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, CreateDemoCommentRequest, DemoComment } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

function selectCommentPayload() {
  return {
    id: true,
    demoId: true,
    trackId: true,
    body: true,
    isResolved: true,
    timestampMs: true,
    createdAt: true,
    updatedAt: true,
    author: {
      select: {
        id: true,
        name: true,
        avatarUrl: true,
      },
    },
  } as const;
}

type CommentRecord = {
  id: string;
  demoId: string;
  trackId: string | null;
  body: string;
  isResolved: boolean;
  timestampMs: number | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

function serializeComment(comment: CommentRecord) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
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
  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
      project: {
        group: {
          members: {
            some: {
              userId: user.id,
            },
          },
        },
      },
    },
    select: { id: true },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const comments = await prisma.comment.findMany({
    where: {
      demoId: demo.id,
    },
    orderBy: [{ trackId: 'asc' }, { timestampMs: 'asc' }, { createdAt: 'asc' }],
    select: selectCommentPayload(),
  });

  return NextResponse.json<DemoComment[]>(comments.map(serializeComment));
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
  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
      project: {
        group: {
          members: {
            some: {
              userId: user.id,
            },
          },
        },
      },
    },
    select: { id: true },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const body = (await req.json()) as Partial<CreateDemoCommentRequest>;
  const commentBody = typeof body.body === 'string' ? body.body.trim() : '';
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : null;
  const timestampMs =
    typeof body.timestampMs === 'number' && Number.isFinite(body.timestampMs) && body.timestampMs >= 0
      ? body.timestampMs
      : null;

  if (!commentBody) {
    return NextResponse.json<ApiError>({ error: 'Comment body cannot be empty' }, { status: 400 });
  }

  if (trackId) {
    const track = await prisma.track.findFirst({
      where: {
        id: trackId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!track) {
      return NextResponse.json<ApiError>(
        { error: 'trackId must belong to the same demo' },
        { status: 400 },
      );
    }
  }

  if (timestampMs !== null && !trackId) {
    return NextResponse.json<ApiError>({ error: 'timestampMs requires trackId' }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: {
      demoId: demo.id,
      trackId,
      body: commentBody,
      timestampMs,
      authorId: user.id,
    },
    select: selectCommentPayload(),
  });

  return NextResponse.json<DemoComment>(serializeComment(comment), { status: 201 });
}
