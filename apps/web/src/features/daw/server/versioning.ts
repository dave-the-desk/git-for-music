import type { Prisma } from '@git-for-music/db';

const TRACK_VERSION_FIELDS = {
  id: true,
  trackId: true,
  storageKey: true,
  sourceFileUrl: true,
  startOffsetMs: true,
  durationMs: true,
  sampleRate: true,
  channels: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  isDerived: true,
  operationType: true,
  parentTrackVersionId: true,
  segments: {
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
    orderBy: {
      position: 'asc',
    },
  },
} as const;

const DEMO_VERSION_FIELDS = {
  tempoBpm: true,
  timeSignatureNum: true,
  timeSignatureDen: true,
  musicalKey: true,
  tempoSource: true,
  keySource: true,
} as const;

export type DemoVersionCloneMap = {
  trackVersionIdMap: Map<string, string>;
  segmentIdMap: Map<string, string>;
};

export async function cloneTrackVersionsToDemoVersion(
  tx: Prisma.TransactionClient,
  sourceVersionId: string,
  targetVersionId: string,
): Promise<DemoVersionCloneMap> {
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

  const trackVersionIdMap = new Map<string, string>();
  const segmentIdMap = new Map<string, string>();

  for (const sourceTrackVersion of sourceTrackVersions) {
    const createdTrackVersion = await tx.trackVersion.create({
      data: {
        trackId: sourceTrackVersion.trackId,
        demoVersionId: targetVersionId,
        storageKey: sourceTrackVersion.storageKey,
        sourceFileUrl: sourceTrackVersion.sourceFileUrl,
        startOffsetMs: sourceTrackVersion.startOffsetMs,
        durationMs: sourceTrackVersion.durationMs,
        sampleRate: sourceTrackVersion.sampleRate,
        channels: sourceTrackVersion.channels,
        mimeType: sourceTrackVersion.mimeType,
        sizeBytes: sourceTrackVersion.sizeBytes,
        checksum: sourceTrackVersion.checksum,
        isDerived: sourceTrackVersion.isDerived,
        operationType: sourceTrackVersion.operationType,
        parentTrackVersionId: sourceTrackVersion.parentTrackVersionId,
      },
      select: {
        id: true,
      },
    });

    trackVersionIdMap.set(sourceTrackVersion.id, createdTrackVersion.id);

    for (const segment of sourceTrackVersion.segments) {
      const createdSegment = await tx.segment.create({
        data: {
          trackVersionId: createdTrackVersion.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          timelineStartMs: segment.timelineStartMs,
          gainDb: segment.gainDb,
          fadeInMs: segment.fadeInMs,
          fadeOutMs: segment.fadeOutMs,
          isMuted: segment.isMuted,
          position: segment.position,
        },
        select: {
          id: true,
        },
      });

      segmentIdMap.set(segment.id, createdSegment.id);
    }
  }

  return {
    trackVersionIdMap,
    segmentIdMap,
  };
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
  const sourceVersion = sourceVersionId
    ? await tx.demoVersion.findFirst({
        where: { id: sourceVersionId, demoId },
        select: DEMO_VERSION_FIELDS,
      })
    : null;

  const version = await tx.demoVersion.create({
    data: {
      demoId,
      label,
      description: description ?? null,
      ...(sourceVersion
        ? {
            tempoBpm: sourceVersion.tempoBpm,
            timeSignatureNum: sourceVersion.timeSignatureNum,
            timeSignatureDen: sourceVersion.timeSignatureDen,
            musicalKey: sourceVersion.musicalKey,
            tempoSource: sourceVersion.tempoSource,
            keySource: sourceVersion.keySource,
          }
        : {}),
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
    const cloneMap = await cloneTrackVersionsToDemoVersion(tx, sourceVersionId, version.id);
    return {
      ...version,
      cloneMap,
    };
  }

  return {
    ...version,
    cloneMap: {
      trackVersionIdMap: new Map<string, string>(),
      segmentIdMap: new Map<string, string>(),
    },
  };
}
