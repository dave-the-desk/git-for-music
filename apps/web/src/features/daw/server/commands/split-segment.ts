import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError, SplitSegmentRequest, SplitSegmentResponse } from '@git-for-music/shared';
import { MIN_SPLIT_DISTANCE_MS, splitSegment } from '@/features/daw/utils/segments';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';

const POSITION_EPSILON_MS = 0.001;

function isNear(valueA: number, valueB: number) {
  return Math.abs(valueA - valueB) <= POSITION_EPSILON_MS;
}

function parseFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serializeSegment(
  trackVersionId: string,
  segment: {
    id: string;
    startMs: number;
    endMs: number;
    timelineStartMs: number | null;
    gainDb: number;
    fadeInMs: number;
    fadeOutMs: number;
    isMuted: boolean;
    position: number;
  },
) {
  const timelineStartMs = segment.timelineStartMs ?? segment.startMs;
  const durationMs = segment.endMs - segment.startMs;
  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    sourceStartMs: segment.startMs,
    sourceEndMs: segment.endMs,
    timelineStartMs,
    timelineEndMs: timelineStartMs + durationMs,
    durationMs,
    gainDb: segment.gainDb,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    isMuted: segment.isMuted,
    position: segment.position,
  };
}

export async function splitSegmentCommand(input: {
  userId: string;
  trackVersionId: string;
  body: Partial<SplitSegmentRequest>;
}) {
  const segmentStartMs = parseFiniteNumber(input.body.segmentStartMs);
  const segmentEndMs = parseFiniteNumber(input.body.segmentEndMs);
  const splitTimeMs = parseFiniteNumber(input.body.splitTimeMs);

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
      id: input.trackVersionId,
      track: {
        demo: {
          project: {
            group: {
              members: { some: { userId: input.userId } },
            },
          },
        },
      },
    },
    select: {
      id: true,
      startOffsetMs: true,
      track: {
        select: {
          demoId: true,
          demo: {
            select: {
              project: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      },
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

  const existingSegment = input.body.segmentId
    ? await prisma.segment.findFirst({
        where: {
          id: input.body.segmentId,
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

  if (input.body.segmentId && !existingSegment) {
    return NextResponse.json<ApiError>({ error: 'Segment not found' }, { status: 404 });
  }

  if (!input.body.segmentId && existingSegmentsCount > 0) {
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

        await recordDemoDawOperation(
          tx,
          {
            projectId: trackVersion.track.demo.project.id,
            demoId: trackVersion.track.demoId,
            actorUserId: input.userId,
            operationType: 'SEGMENT_SPLIT',
            payload: {
              trackVersionId: trackVersion.id,
              sourceSegmentId: existingSegment?.id ?? null,
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
            },
          },
          {
            checkpointCreatedById: input.userId,
          },
        );

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

      await recordDemoDawOperation(
        tx,
        {
          projectId: trackVersion.track.demo.project.id,
          demoId: trackVersion.track.demoId,
          actorUserId: input.userId,
          operationType: 'SEGMENT_SPLIT',
          payload: {
            trackVersionId: trackVersion.id,
            sourceSegmentId: null,
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
          },
        },
        {
          checkpointCreatedById: input.userId,
        },
      );

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

    const splitResponse: SplitSegmentResponse = {
      trackVersionId: trackVersion.id,
      leftSegmentId: ids.leftSegment.id,
      rightSegmentId: ids.rightSegment.id,
      leftSegment: ids.leftSegment,
      rightSegment: ids.rightSegment,
    };

    return NextResponse.json(splitResponse);
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Could not split segment',
      },
      { status: 400 },
    );
  }
}
