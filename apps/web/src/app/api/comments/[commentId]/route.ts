import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, DemoComment, UpdateCommentRequest } from '@git-for-music/shared';
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

async function getEditableComment(commentId: string, userId: string) {
  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
    },
    select: {
      id: true,
      authorId: true,
      demo: {
        select: {
          project: {
            select: {
              group: {
                select: {
                  members: {
                    where: {
                      userId,
                    },
                    select: {
                      role: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!comment) {
    return null;
  }

  const role = comment.demo.project.group.members[0]?.role;
  const isPrivileged = role === 'ADMIN' || role === 'OWNER';

  if (comment.authorId !== userId && !isPrivileged) {
    return null;
  }

  return comment;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { commentId } = await params;
  const editableComment = await getEditableComment(commentId, user.id);

  if (!editableComment) {
    return NextResponse.json<ApiError>({ error: 'Comment not found' }, { status: 404 });
  }

  const body = (await req.json()) as Partial<UpdateCommentRequest>;
  const nextBody =
    typeof body.body === 'string' ? body.body.trim() : undefined;
  const nextResolved =
    typeof body.isResolved === 'boolean' ? body.isResolved : undefined;

  if (nextBody === undefined && nextResolved === undefined) {
    return NextResponse.json<ApiError>(
      { error: 'Provide body or isResolved to update the comment' },
      { status: 400 },
    );
  }

  if (nextBody !== undefined && !nextBody) {
    return NextResponse.json<ApiError>({ error: 'Comment body cannot be empty' }, { status: 400 });
  }

  const updated = await prisma.comment.update({
    where: {
      id: editableComment.id,
    },
    data: {
      ...(nextBody !== undefined ? { body: nextBody } : {}),
      ...(nextResolved !== undefined ? { isResolved: nextResolved } : {}),
    },
    select: selectCommentPayload(),
  });

  return NextResponse.json<DemoComment>(serializeComment(updated));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { commentId } = await params;
  const editableComment = await getEditableComment(commentId, user.id);

  if (!editableComment) {
    return NextResponse.json<ApiError>({ error: 'Comment not found' }, { status: 404 });
  }

  await prisma.comment.delete({
    where: {
      id: editableComment.id,
    },
  });

  return NextResponse.json({ ok: true });
}
