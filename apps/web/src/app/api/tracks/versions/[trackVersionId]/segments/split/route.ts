import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, SplitSegmentRequest, SplitSegmentResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { MIN_SPLIT_DISTANCE_MS, splitSegment } from '@/features/daw/utils/segments';

const POSITION_EPSILON_MS = 0.001;

function isNear(valueA: number, valueB: number) {
  return Math.abs(valueA - valueB) <= POSITION_EPSILON_MS;
}

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serializeSegment(trackVersionId: string, segment: {
  id: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
}) {
  const timelineStartMs = segment.timelineStartMs ?? segment.startMs;
  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
    gainDb: segment.gainDb,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    isMuted: segment.isMuted,
    position: segment.position,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackVersionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { trackVersionId } = await params;
  const body = (await req.json()) as Partial<SplitSegmentRequest>;

  const segmentStartMs = parseFiniteNumber(body.segmentStartMs);
  const segmentEndMs = parseFiniteNumber(body.segmentEndMs);
  const splitTimeMs = parseFiniteNumber(body.splitTimeMs);

  if (segmentStartMs === null || segmentEndMs === null || splitTimeMs === null) {
    return NextResponse.json<ApiError>(
      { error: 'segmentStartMs, segmentEndMs, and splitTimeMs must be finite numbers' },
      { status: 400 },
    );
  }

  if (segmentEndMs <= segmentStartMs) {
    return NextResponse.json<ApiError>(
      { error: 'segmentEndMs must be greater than segmentStartMs' },
      { status: 400 },
    );
  }

  const trackVersion = await prisma.trackVersion.findFirst({
    where: {
      id: trackVersionId,
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
    select: {
      id: true,
      startOffsetMs: true,
    },
  });

  if (!trackVersion) {
    return NextResponse.json<ApiError>({ error: 'Track version not found' }, { status: 404 });
  }

  const existingSegmentsCount = await prisma.segment.count({
    where: {
      trackVersionId: trackVersion.id,
    },
  });

  const existingSegment = body.segmentId
    ? await prisma.segment.findFirst({
        where: {
          id: body.segmentId,
          trackVersionId: trackVersion.id,
        },
        select: {
          id: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          gainDb: true,
          fadeInMs: true,
          fadeOutMs: true,
          isMuted: true,
          position: true,
        },
      })
    : null;

  if (body.segmentId && !existingSegment) {
    return NextResponse.json<ApiError>({ error: 'Segment not found' }, { status: 404 });
  }

  if (!body.segmentId && existingSegmentsCount > 0) {
    return NextResponse.json<ApiError>(
      { error: 'segmentId is required when the track version already has persisted segments' },
      { status: 400 },
    );
  }

  const baseSegment =
    existingSegment ?? {
      id: `implicit:${trackVersion.id}`,
      startMs: segmentStartMs,
      endMs: segmentEndMs,
      timelineStartMs: trackVersion.startOffsetMs,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
    };

  if (existingSegment) {
    if (!isNear(existingSegment.startMs, segmentStartMs) || !isNear(existingSegment.endMs, segmentEndMs)) {
      return NextResponse.json<ApiError>(
        { error: 'Segment bounds no longer match the saved clip' },
        { status: 409 },
      );
    }
  }

  let splitResponse: SplitSegmentResponse;

  try {
    const { leftSegment, rightSegment } = splitSegment(baseSegment, splitTimeMs, MIN_SPLIT_DISTANCE_MS);

    const ids = await prisma.$transaction(async (tx) => {
      if (existingSegment) {
        await tx.segment.updateMany({
          where: {
            trackVersionId: trackVersion.id,
            position: {
              gt: existingSegment.position,
            },
          },
          data: {
            position: {
              increment: 1,
            },
          },
        });

        await tx.segment.update({
          where: {
            id: existingSegment.id,
          },
          data: {
            startMs: leftSegment.startMs,
            endMs: leftSegment.endMs,
            timelineStartMs: leftSegment.timelineStartMs,
            gainDb: leftSegment.gainDb,
            fadeInMs: leftSegment.fadeInMs,
            fadeOutMs: leftSegment.fadeOutMs,
            isMuted: leftSegment.isMuted,
            position: leftSegment.position,
          },
        });

        const right = await tx.segment.create({
          data: {
            trackVersionId: trackVersion.id,
            startMs: rightSegment.startMs,
            endMs: rightSegment.endMs,
            timelineStartMs: rightSegment.timelineStartMs,
            gainDb: rightSegment.gainDb,
            fadeInMs: rightSegment.fadeInMs,
            fadeOutMs: rightSegment.fadeOutMs,
            isMuted: rightSegment.isMuted,
            position: rightSegment.position,
          },
          select: {
            id: true,
          },
        });

          return {
          leftSegment: serializeSegment(trackVersion.id, {
            ...existingSegment,
            startMs: leftSegment.startMs,
            endMs: leftSegment.endMs,
            timelineStartMs:
              leftSegment.timelineStartMs ?? trackVersion.startOffsetMs + leftSegment.startMs,
          }),
          rightSegment: serializeSegment(trackVersion.id, {
            id: right.id,
            startMs: rightSegment.startMs,
            endMs: rightSegment.endMs,
            timelineStartMs:
              rightSegment.timelineStartMs ?? trackVersion.startOffsetMs + rightSegment.startMs,
            gainDb: rightSegment.gainDb,
            fadeInMs: rightSegment.fadeInMs,
            fadeOutMs: rightSegment.fadeOutMs,
            isMuted: rightSegment.isMuted,
            position: rightSegment.position,
          }),
        };
      }

      const left = await tx.segment.create({
        data: {
          trackVersionId: trackVersion.id,
          startMs: leftSegment.startMs,
          endMs: leftSegment.endMs,
          timelineStartMs: leftSegment.timelineStartMs,
          gainDb: leftSegment.gainDb,
          fadeInMs: leftSegment.fadeInMs,
          fadeOutMs: leftSegment.fadeOutMs,
          isMuted: leftSegment.isMuted,
          position: leftSegment.position,
        },
        select: {
          id: true,
        },
      });

      const right = await tx.segment.create({
        data: {
          trackVersionId: trackVersion.id,
          startMs: rightSegment.startMs,
          endMs: rightSegment.endMs,
          timelineStartMs: rightSegment.timelineStartMs,
          gainDb: rightSegment.gainDb,
          fadeInMs: rightSegment.fadeInMs,
          fadeOutMs: rightSegment.fadeOutMs,
          isMuted: rightSegment.isMuted,
          position: rightSegment.position,
        },
        select: {
          id: true,
        },
      });

      return {
        leftSegment: serializeSegment(trackVersion.id, {
          id: left.id,
          startMs: leftSegment.startMs,
          endMs: leftSegment.endMs,
          timelineStartMs:
            leftSegment.timelineStartMs ?? trackVersion.startOffsetMs + leftSegment.startMs,
          gainDb: leftSegment.gainDb,
          fadeInMs: leftSegment.fadeInMs,
          fadeOutMs: leftSegment.fadeOutMs,
          isMuted: leftSegment.isMuted,
          position: leftSegment.position,
        }),
        rightSegment: serializeSegment(trackVersion.id, {
          id: right.id,
          startMs: rightSegment.startMs,
          endMs: rightSegment.endMs,
          timelineStartMs:
            rightSegment.timelineStartMs ?? trackVersion.startOffsetMs + rightSegment.startMs,
          gainDb: rightSegment.gainDb,
          fadeInMs: rightSegment.fadeInMs,
          fadeOutMs: rightSegment.fadeOutMs,
          isMuted: rightSegment.isMuted,
          position: rightSegment.position,
        }),
      };
    });

    splitResponse = {
      trackVersionId: trackVersion.id,
      leftSegmentId: ids.leftSegment.id,
      rightSegmentId: ids.rightSegment.id,
      leftSegment: ids.leftSegment,
      rightSegment: ids.rightSegment,
    };
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Could not split segment',
      },
      { status: 400 },
    );
  }

  return NextResponse.json(splitResponse);
}
