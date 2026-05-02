import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, MoveSegmentResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string; segmentId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId, segmentId } = await params;
  const body = (await req.json()) as { timelineStartMs?: unknown };
  const timelineStartMs = parseFiniteNumber(body.timelineStartMs);

  if (timelineStartMs === null || timelineStartMs < 0) {
    return NextResponse.json<ApiError>(
      { error: 'timelineStartMs must be a non-negative number' },
      { status: 400 },
    );
  }

  const segment = await prisma.segment.findFirst({
    where: {
      id: segmentId,
      trackVersionId,
      trackVersion: {
        track: {
          demo: {
            project: {
              group: {
                members: { some: { userId: user.id } },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      trackVersionId: true,
      startMs: true,
      endMs: true,
      timelineStartMs: true,
      gainDb: true,
      fadeInMs: true,
      fadeOutMs: true,
      isMuted: true,
      position: true,
    },
  });

  if (!segment) {
    return NextResponse.json<ApiError>({ error: 'Segment not found' }, { status: 404 });
  }

  const updated = await prisma.segment.update({
    where: { id: segment.id },
    data: { timelineStartMs },
    select: {
      id: true,
      trackVersionId: true,
      startMs: true,
      endMs: true,
      timelineStartMs: true,
      gainDb: true,
      fadeInMs: true,
      fadeOutMs: true,
      isMuted: true,
      position: true,
    },
  });

  const response: MoveSegmentResponse = {
    trackVersionId: updated.trackVersionId,
    segment: {
      id: updated.id,
      trackVersionId: updated.trackVersionId,
      startMs: updated.startMs,
      endMs: updated.endMs,
      sourceStartMs: updated.startMs,
      sourceEndMs: updated.endMs,
      timelineStartMs: updated.timelineStartMs ?? updated.startMs,
      timelineEndMs: (updated.timelineStartMs ?? updated.startMs) + (updated.endMs - updated.startMs),
      durationMs: updated.endMs - updated.startMs,
      gainDb: updated.gainDb,
      fadeInMs: updated.fadeInMs,
      fadeOutMs: updated.fadeOutMs,
      isMuted: updated.isMuted,
      position: updated.position,
    },
  };

  return NextResponse.json(response);
}
