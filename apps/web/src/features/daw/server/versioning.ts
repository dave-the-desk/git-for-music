import type { Prisma } from '@git-for-music/db';
import type {
  DawVersionTreeNodeSnapshot,
  DawVersionTreeTrackSnapshot,
} from '@/features/daw/protocol';

type DemoDawTimingSource = 'MANUAL' | 'ANALYZED' | 'IMPORTED';

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
  track: {
    select: {
      name: true,
      position: true,
    },
  },
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
  description: true,
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
  tracks: DawVersionTreeTrackSnapshot[];
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
  const tracks: DawVersionTreeTrackSnapshot[] = [];

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
        createdAt: true,
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

    tracks.push(
      serializeCreatedDemoTrackVersionTreeTrack({
        trackId: sourceTrackVersion.trackId,
        trackName: sourceTrackVersion.track.name,
        trackPosition: sourceTrackVersion.track.position,
        trackVersionId: createdTrackVersion.id,
        storageKey: sourceTrackVersion.storageKey,
        mimeType: sourceTrackVersion.mimeType,
        durationMs: sourceTrackVersion.durationMs,
        startOffsetMs: sourceTrackVersion.startOffsetMs,
        createdAt: createdTrackVersion.createdAt,
        isDerived: sourceTrackVersion.isDerived,
        operationType: sourceTrackVersion.operationType,
        parentTrackVersionId: sourceTrackVersion.parentTrackVersionId,
        segments: sourceTrackVersion.segments.map((segment) => ({
          id: segmentIdMap.get(segment.id) ?? segment.id,
          trackVersionId: createdTrackVersion.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          timelineStartMs: segment.timelineStartMs,
          timelineEndMs:
            (segment.timelineStartMs ?? sourceTrackVersion.startOffsetMs + segment.startMs) +
            Math.max(0, segment.endMs - segment.startMs),
          gainDb: segment.gainDb,
          fadeInMs: segment.fadeInMs,
          fadeOutMs: segment.fadeOutMs,
          isMuted: segment.isMuted,
          position: segment.position,
        })),
      }),
    );
  }

  return {
    trackVersionIdMap,
    segmentIdMap,
    tracks,
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
      description: true,
      tempoBpm: true,
      timeSignatureNum: true,
      timeSignatureDen: true,
      musicalKey: true,
      tempoSource: true,
      keySource: true,
      createdAt: true,
      parentId: true,
    },
  });

  if (sourceVersionId) {
    const cloneMap = await cloneTrackVersionsToDemoVersion(tx, sourceVersionId, version.id);
    return {
      ...version,
      cloneMap,
      tracks: cloneMap.tracks,
    };
  }

  return {
    ...version,
    cloneMap: {
      trackVersionIdMap: new Map<string, string>(),
      segmentIdMap: new Map<string, string>(),
      tracks: [],
    },
    tracks: [],
  };
}

export function serializeCreatedDemoVersionTreeNode(input: {
  id: string;
  label: string;
  description?: string | null;
  parentId?: string | null;
  createdAt: string | Date;
  branchMode?: 'continue' | 'fork';
  tempoBpm?: number | null;
  timeSignatureNum?: number;
  timeSignatureDen?: number;
  musicalKey?: string | null;
  tempoSource?: DemoDawTimingSource;
  keySource?: DemoDawTimingSource;
  isCurrent?: boolean;
  tracks?: DawVersionTreeTrackSnapshot[];
}): DawVersionTreeNodeSnapshot {
  return {
    id: input.id,
    label: input.label,
    description: input.description ?? null,
    parentId: input.parentId ?? null,
    createdAt:
      typeof input.createdAt === 'string' ? input.createdAt : input.createdAt.toISOString(),
    isCurrent: input.isCurrent ?? false,
    branchMode: input.branchMode,
    tempoBpm: input.tempoBpm ?? null,
    timeSignatureNum: input.timeSignatureNum ?? 4,
    timeSignatureDen: input.timeSignatureDen ?? 4,
    musicalKey: input.musicalKey ?? null,
    tempoSource: input.tempoSource ?? 'MANUAL',
    keySource: input.keySource ?? 'MANUAL',
    tracks: input.tracks ?? [],
  };
}

export function serializeCreatedDemoTrackVersionTreeTrack(input: {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType?: string | null;
  durationMs?: number | null;
  startOffsetMs?: number;
  createdAt?: string | Date;
  isDerived?: boolean;
  operationType?: 'ORIGINAL' | 'TIME_STRETCH';
  parentTrackVersionId?: string | null;
  segments?: DawVersionTreeTrackSnapshot['segments'];
}): DawVersionTreeTrackSnapshot {
  return {
    trackId: input.trackId,
    trackName: input.trackName,
    trackPosition: input.trackPosition,
    trackVersionId: input.trackVersionId,
    storageKey: input.storageKey,
    mimeType: input.mimeType ?? null,
    durationMs: input.durationMs ?? null,
    startOffsetMs: input.startOffsetMs ?? 0,
    createdAt:
      typeof input.createdAt === 'string'
        ? input.createdAt
        : input.createdAt?.toISOString() ?? new Date().toISOString(),
    isDerived: input.isDerived ?? false,
    operationType: input.operationType ?? 'ORIGINAL',
    parentTrackVersionId: input.parentTrackVersionId ?? null,
    segments: input.segments ?? [],
  };
}
