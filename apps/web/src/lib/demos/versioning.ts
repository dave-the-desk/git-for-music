import type { Prisma } from '@git-for-music/db';

const TRACK_VERSION_FIELDS = {
  trackId: true,
  storageKey: true,
  durationMs: true,
  sampleRate: true,
  channels: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  isDerived: true,
  segments: {
    select: {
      startMs: true,
      endMs: true,
      gainDb: true,
      fadeInMs: true,
      fadeOutMs: true,
      isMuted: true,
      position: true,
    },
    orderBy: {
      position: 'asc',
    },
  },
} as const;

export async function cloneTrackVersionsToDemoVersion(
  tx: Prisma.TransactionClient,
  sourceVersionId: string,
  targetVersionId: string,
) {
  const sourceTrackVersions = await tx.trackVersion.findMany({
    where: {
      demoVersionId: sourceVersionId,
    },
    select: TRACK_VERSION_FIELDS,
    orderBy: {
      track: {
        position: 'asc',
      },
    },
  });

  for (const sourceTrackVersion of sourceTrackVersions) {
    await tx.trackVersion.create({
      data: {
        trackId: sourceTrackVersion.trackId,
        demoVersionId: targetVersionId,
        storageKey: sourceTrackVersion.storageKey,
        durationMs: sourceTrackVersion.durationMs,
        sampleRate: sourceTrackVersion.sampleRate,
        channels: sourceTrackVersion.channels,
        mimeType: sourceTrackVersion.mimeType,
        sizeBytes: sourceTrackVersion.sizeBytes,
        checksum: sourceTrackVersion.checksum,
        isDerived: sourceTrackVersion.isDerived,
        segments: sourceTrackVersion.segments.length
          ? {
              createMany: {
                data: sourceTrackVersion.segments.map((segment) => ({
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  gainDb: segment.gainDb,
                  fadeInMs: segment.fadeInMs,
                  fadeOutMs: segment.fadeOutMs,
                  isMuted: segment.isMuted,
                  position: segment.position,
                })),
              },
            }
          : undefined,
      },
      select: {
        id: true,
      },
    });
  }
}

export async function createDemoVersionWithCopiedTracks(
  tx: Prisma.TransactionClient,
  {
    demoId,
    label,
    description,
    parentId,
    sourceVersionId,
  }: {
    demoId: string;
    label: string;
    description?: string | null;
    parentId?: string | null;
    sourceVersionId?: string | null;
  },
) {
  const version = await tx.demoVersion.create({
    data: {
      demoId,
      label,
      description: description ?? null,
      parentId: parentId ?? null,
    },
    select: {
      id: true,
      label: true,
      createdAt: true,
      parentId: true,
    },
  });

  if (sourceVersionId) {
    await cloneTrackVersionsToDemoVersion(tx, sourceVersionId, version.id);
  }

  return version;
}
