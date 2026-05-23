import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, prisma } from '@git-for-music/db';

export type DemoDawTimingSource = 'MANUAL' | 'ANALYZED' | 'IMPORTED';

export interface DemoDawSnapshotSegment {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  crossfadeInMs?: number | null;
  crossfadeOutMs?: number | null;
  crossfadeCurve?: string | null;
}

export interface DemoDawSnapshotTrack {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  startOffsetMs: number;
  createdAt: string;
  isDerived: boolean;
  operationType: 'ORIGINAL' | 'TIME_STRETCH';
  parentTrackVersionId: string | null;
  segments: DemoDawSnapshotSegment[];
}

export interface DemoDawSnapshotVersion {
  id: string;
  label: string;
  description: string | null;
  tempoBpm: number | null;
  timeSignatureNum: number;
  timeSignatureDen: number;
  musicalKey: string | null;
  tempoSource: DemoDawTimingSource;
  keySource: DemoDawTimingSource;
  parentId: string | null;
  createdAt: string;
  tracks: DemoDawSnapshotTrack[];
}

export interface DemoDawSnapshotData {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  project: {
    id: string;
    slug: string;
    group: {
      id: string;
      slug: string;
    };
  };
  versions: DemoDawSnapshotVersion[];
  comments: DemoDawSnapshotComment[];
  annotations: DemoDawSnapshotAnnotation[];
}

export interface DemoDawSnapshotComment {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

export interface DemoDawSnapshotAnnotation {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

export type DemoDawOperationType =
  | 'TRACK_RENAMED'
  | 'TRACK_OFFSET_UPDATED'
  | 'SEGMENT_SPLIT'
  | 'SEGMENT_MOVED'
  | 'SEGMENT_DELETED'
  | 'SEGMENT_TRIMMED'
  | 'SEGMENT_MERGED'
  | 'CROSSFADE_SET'
  | 'VERSION_TIMING_UPDATED'
  | 'ASSET_ADDED'
  | 'COMMENT_ADDED'
  | 'COMMENT_UPDATED'
  | 'COMMENT_DELETED'
  | 'ANNOTATION_ADDED'
  | 'ANNOTATION_UPDATED'
  | 'ANNOTATION_DELETED';

export type DemoDawOperationPayload =
  | {
      trackId: string;
      trackName: string;
    }
  | {
      trackVersionId: string;
      startOffsetMs: number;
    }
  | {
      trackVersionId: string;
      sourceSegmentId: string | null;
      leftSegment: DemoDawSnapshotSegment;
      rightSegment: DemoDawSnapshotSegment;
    }
  | {
      trackVersionId: string;
      segmentId: string;
      timelineStartMs: number;
    }
  | {
      trackVersionId: string;
      segmentId: string;
    }
  | {
      trackVersionId: string;
      segmentId: string;
      from: {
        startMs: number;
        endMs: number;
      };
      to: {
        startMs: number;
        endMs: number;
      };
    }
  | {
      trackVersionId: string;
      segmentIds: string[];
      mergedSegment: DemoDawSnapshotSegment;
    }
  | {
      trackVersionId: string;
      leftSegmentId: string;
      rightSegmentId: string;
      crossfadeInMs: number;
      crossfadeOutMs: number;
      curve: string | null;
    }
  | {
      versionId: string;
      label: string;
      tempoBpm: number | null;
      timeSignatureNum: number;
      timeSignatureDen: number;
      musicalKey: string | null;
      tempoSource: DemoDawTimingSource;
      keySource: DemoDawTimingSource;
    }
  | {
      commentId: string;
      demoId: string;
      trackId: string | null;
      segmentId: string | null;
      startTimeMs: number | null;
      endTimeMs: number | null;
      body: string;
      createdBy: string;
      resolved: boolean;
    }
  | {
      annotationId: string;
      demoId: string;
      trackId: string | null;
      segmentId: string | null;
      startTimeMs: number | null;
      endTimeMs: number | null;
      body: string;
      createdBy: string;
      resolved: boolean;
    }
  | {
      assetId: string;
      projectId: string;
      demoId: string;
      trackId: string | null;
      trackVersionId: string | null;
      assetKind: 'ORIGINAL' | 'DERIVED' | 'PEAKS' | 'ANALYSIS';
      storageKey: string;
    };

export interface DemoDawSnapshotOperationRow {
  id: string;
  projectId: string;
  demoId: string;
  type: DemoDawOperationType;
  createdAt: string;
  actorUserId: string;
  baseSnapshotId: string | null;
  baseOperationSeq: number;
  operationSeq: number;
  payload: DemoDawOperationPayload;
  idempotencyKey: string;
  clientOperationId: string;
}

type DemoDawDatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface DemoDawOperationInsertResult {
  id: string;
  operationSeq: number;
  created: boolean;
}

interface DemoScope {
  projectId: string;
  demoId: string;
}

interface AuthorizedDemoScope extends DemoScope {
  groupId: string;
  groupSlug: string;
  projectSlug: string;
  demoName: string;
  demoDescription: string | null;
  currentVersionId: string | null;
}

interface DemoSourceVersionRow {
  id: string;
  label: string;
  description: string | null;
  tempoBpm: number | null;
  timeSignatureNum: number;
  timeSignatureDen: number;
  musicalKey: string | null;
  tempoSource: DemoDawTimingSource;
  keySource: DemoDawTimingSource;
  parentId: string | null;
  createdAt: Date;
  trackVersions: Array<{
    id: string;
    storageKey: string;
    mimeType: string | null;
    durationMs: number | null;
    startOffsetMs: number;
    createdAt: Date;
    isDerived: boolean;
    operationType: 'ORIGINAL' | 'TIME_STRETCH';
    parentTrackVersionId: string | null;
    track: {
      id: string;
      name: string;
      position: number;
    };
    segments: Array<{
      id: string;
      startMs: number;
      endMs: number;
      timelineStartMs: number | null;
      gainDb: number;
      fadeInMs: number;
      fadeOutMs: number;
      isMuted: boolean;
      position: number;
    }>;
  }>;
}

interface DemoSourceData {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  project: {
    id: string;
    slug: string;
    group: {
      id: string;
      slug: string;
    };
  };
  versions: DemoSourceVersionRow[];
  comments: DemoDawSnapshotComment[];
  annotations: DemoDawSnapshotAnnotation[];
}

const DEFAULT_SNAPSHOT_CHECKPOINT_TAIL = 12;

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeTrackVersion(trackVersion: DemoSourceVersionRow['trackVersions'][number]): DemoDawSnapshotTrack {
  return {
    trackId: trackVersion.track.id,
    trackName: trackVersion.track.name,
    trackPosition: trackVersion.track.position,
    trackVersionId: trackVersion.id,
    storageKey: trackVersion.storageKey,
    mimeType: trackVersion.mimeType,
    durationMs: trackVersion.durationMs,
    startOffsetMs: trackVersion.startOffsetMs,
    createdAt: toIsoString(trackVersion.createdAt),
    isDerived: trackVersion.isDerived,
    operationType: trackVersion.operationType,
    parentTrackVersionId: trackVersion.parentTrackVersionId,
    segments: trackVersion.segments.map((segment) => serializeSegment(trackVersion.id, segment)),
  };
}

function serializeSegment(
  trackVersionId: string,
  segment: DemoSourceVersionRow['trackVersions'][number]['segments'][number],
): DemoDawSnapshotSegment {
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
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  };
}

function serializeVersion(version: DemoSourceVersionRow): DemoDawSnapshotVersion {
  return {
    id: version.id,
    label: version.label,
    description: version.description,
    tempoBpm: version.tempoBpm,
    timeSignatureNum: version.timeSignatureNum,
    timeSignatureDen: version.timeSignatureDen,
    musicalKey: version.musicalKey,
    tempoSource: version.tempoSource,
    keySource: version.keySource,
    parentId: version.parentId,
    createdAt: toIsoString(version.createdAt),
    tracks: version.trackVersions.map((trackVersion) => serializeTrackVersion(trackVersion)),
  };
}

function serializeComment(comment: {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}): DemoDawSnapshotComment {
  return {
    ...comment,
    createdAt: toIsoString(comment.createdAt),
    updatedAt: toIsoString(comment.updatedAt),
  };
}

function serializeAnnotation(annotation: {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}): DemoDawSnapshotAnnotation {
  return {
    ...annotation,
    createdAt: toIsoString(annotation.createdAt),
    updatedAt: toIsoString(annotation.updatedAt),
  };
}

function serializeDemoSourceData(demo: DemoSourceData): DemoDawSnapshotData {
  return {
    id: demo.id,
    name: demo.name,
    description: demo.description,
    currentVersionId: demo.currentVersionId,
    project: {
      id: demo.project.id,
      slug: demo.project.slug,
      group: {
        id: demo.project.group.id,
        slug: demo.project.group.slug,
      },
    },
    versions: demo.versions.map((version) => serializeVersion(version)),
    comments: demo.comments,
    annotations: demo.annotations,
  };
}

function cloneSnapshot<T>(snapshot: T): T {
  return structuredClone(snapshot);
}

function hydrateSnapshotProjectMetadata(snapshot: DemoDawSnapshotData, source: DemoSourceData) {
  snapshot.project = {
    id: snapshot.project.id ?? source.project.id,
    slug: snapshot.project.slug ?? source.project.slug,
    group: {
      id: snapshot.project.group.id ?? source.project.group.id,
      slug: snapshot.project.group.slug ?? source.project.group.slug,
    },
  };
  return snapshot;
}

function updateTrackName(snapshot: DemoDawSnapshotData, trackId: string, trackName: string) {
  for (const version of snapshot.versions) {
    for (const track of version.tracks) {
      if (track.trackId === trackId) {
        track.trackName = trackName;
      }
    }
  }
}

function updateTrackOffset(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  startOffsetMs: number,
) {
  for (const version of snapshot.versions) {
    for (const track of version.tracks) {
      if (track.trackVersionId === trackVersionId) {
        track.startOffsetMs = startOffsetMs;
        return;
      }
    }
  }
}

function updateVersionTiming(
  snapshot: DemoDawSnapshotData,
  payload: Extract<DemoDawOperationPayload, { versionId: string }>,
) {
  const version = snapshot.versions.find((candidate) => candidate.id === payload.versionId);
  if (!version) return;

  version.label = payload.label;
  version.tempoBpm = payload.tempoBpm;
  version.timeSignatureNum = payload.timeSignatureNum;
  version.timeSignatureDen = payload.timeSignatureDen;
  version.musicalKey = payload.musicalKey;
  version.tempoSource = payload.tempoSource;
  version.keySource = payload.keySource;
}

function moveSegment(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  segmentId: string,
  timelineStartMs: number,
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    const nextSegments = track.segments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            timelineStartMs,
          }
        : segment,
    );

    track.segments = nextSegments;
    return;
  }
}

function removeSegment(snapshot: DemoDawSnapshotData, trackVersionId: string, segmentId: string) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    const nextSegments = track.segments
      .filter((segment) => segment.id !== segmentId)
      .map((segment, index) => ({
        ...segment,
        position: index,
      }));
    track.segments = nextSegments;
    return;
  }
}

function trimSegment(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  segmentId: string,
  to: { startMs: number; endMs: number },
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    track.segments = track.segments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            startMs: to.startMs,
            endMs: to.endMs,
            timelineStartMs: segment.timelineStartMs,
          }
        : segment,
    );
    return;
  }
}

function mergeSegments(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  segmentIds: string[],
  mergedSegment: DemoDawSnapshotSegment,
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    track.segments = track.segments
      .filter((segment) => !segmentIds.includes(segment.id))
      .concat({ ...mergedSegment, trackVersionId })
      .sort((left, right) => left.position - right.position);
    return;
  }
}

function setCrossfade(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  leftSegmentId: string,
  rightSegmentId: string,
  crossfadeInMs: number,
  crossfadeOutMs: number,
  curve: string | null,
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    track.segments = track.segments.map((segment) => {
      if (segment.id === leftSegmentId) {
        return {
          ...segment,
          crossfadeOutMs,
          crossfadeCurve: curve,
        };
      }
      if (segment.id === rightSegmentId) {
        return {
          ...segment,
          crossfadeInMs,
          crossfadeCurve: curve,
        };
      }
      return segment;
    });
    return;
  }
}

function upsertComment(
  snapshot: DemoDawSnapshotData,
  payload: Extract<DemoDawOperationPayload, { commentId: string }>,
  deleted = false,
) {
  const current = snapshot.comments.find((entry) => entry.id === payload.commentId);
  if (deleted) {
    snapshot.comments = snapshot.comments.filter((entry) => entry.id !== payload.commentId);
    return;
  }

  const nextComment: DemoDawSnapshotComment = {
    id: payload.commentId,
    demoId: payload.demoId,
    trackId: payload.trackId ?? null,
    segmentId: payload.segmentId ?? null,
    startTimeMs: payload.startTimeMs ?? null,
    endTimeMs: payload.endTimeMs ?? null,
    body: payload.body,
    createdBy: payload.createdBy,
    resolved: payload.resolved,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: current?.author ?? {
      id: payload.createdBy,
      name: null,
      avatarUrl: null,
    },
  };

  const existingIndex = snapshot.comments.findIndex((entry) => entry.id === payload.commentId);
  if (existingIndex === -1) {
    snapshot.comments = [...snapshot.comments, nextComment];
    return;
  }

  snapshot.comments = snapshot.comments.map((entry) =>
    entry.id === payload.commentId
      ? {
          ...entry,
          ...nextComment,
          createdAt: entry.createdAt ?? nextComment.createdAt,
        }
      : entry,
  );
}

function upsertAnnotation(
  snapshot: DemoDawSnapshotData,
  payload: Extract<DemoDawOperationPayload, { annotationId: string }>,
  deleted = false,
) {
  const current = snapshot.annotations.find((entry) => entry.id === payload.annotationId);
  if (deleted) {
    snapshot.annotations = snapshot.annotations.filter((entry) => entry.id !== payload.annotationId);
    return;
  }

  const nextAnnotation: DemoDawSnapshotAnnotation = {
    id: payload.annotationId,
    demoId: payload.demoId,
    trackId: payload.trackId ?? null,
    segmentId: payload.segmentId ?? null,
    startTimeMs: payload.startTimeMs ?? null,
    endTimeMs: payload.endTimeMs ?? null,
    body: payload.body,
    createdBy: payload.createdBy,
    resolved: payload.resolved,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: current?.author ?? {
      id: payload.createdBy,
      name: null,
      avatarUrl: null,
    },
  };

  const existingIndex = snapshot.annotations.findIndex((entry) => entry.id === payload.annotationId);
  if (existingIndex === -1) {
    snapshot.annotations = [...snapshot.annotations, nextAnnotation];
    return;
  }

  snapshot.annotations = snapshot.annotations.map((entry) =>
    entry.id === payload.annotationId
      ? {
          ...entry,
          ...nextAnnotation,
          createdAt: entry.createdAt ?? nextAnnotation.createdAt,
        }
      : entry,
  );
}

function upsertSplitSegments(
  snapshot: DemoDawSnapshotData,
  payload: Extract<
    DemoDawOperationPayload,
    { sourceSegmentId: string | null; leftSegment: DemoDawSnapshotSegment; rightSegment: DemoDawSnapshotSegment }
  >,
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === payload.trackVersionId);
    if (!track) continue;

    const nextSegments = track.segments
      .filter((segment) => segment.id !== payload.sourceSegmentId)
      .filter((segment) => segment.id !== payload.leftSegment.id && segment.id !== payload.rightSegment.id)
      .concat([
        { ...payload.leftSegment, trackVersionId: payload.trackVersionId },
        { ...payload.rightSegment, trackVersionId: payload.trackVersionId },
      ])
      .sort((left, right) => left.position - right.position);

    track.segments = nextSegments;
    return;
  }
}

function applyDemoOperation(snapshot: DemoDawSnapshotData, operation: DemoDawSnapshotOperationRow) {
  switch (operation.type) {
    case 'TRACK_RENAMED':
      {
        const payload = operation.payload as Extract<DemoDawOperationPayload, { trackId: string; trackName: string }>;
        updateTrackName(snapshot, payload.trackId, payload.trackName);
      }
      return snapshot;
    case 'TRACK_OFFSET_UPDATED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; startOffsetMs: number }
        >;
        updateTrackOffset(snapshot, payload.trackVersionId, payload.startOffsetMs);
      }
      return snapshot;
    case 'SEGMENT_SPLIT':
      upsertSplitSegments(
        snapshot,
        operation.payload as Extract<
          DemoDawOperationPayload,
          { sourceSegmentId: string | null; leftSegment: DemoDawSnapshotSegment; rightSegment: DemoDawSnapshotSegment }
        >,
      );
      return snapshot;
    case 'SEGMENT_MOVED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentId: string; timelineStartMs: number }
        >;
        moveSegment(snapshot, payload.trackVersionId, payload.segmentId, payload.timelineStartMs);
      }
      return snapshot;
    case 'SEGMENT_DELETED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentId: string }
        >;
        removeSegment(snapshot, payload.trackVersionId, payload.segmentId);
      }
      return snapshot;
    case 'SEGMENT_TRIMMED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentId: string; to: { startMs: number; endMs: number } }
        >;
        trimSegment(snapshot, payload.trackVersionId, payload.segmentId, payload.to);
      }
      return snapshot;
    case 'SEGMENT_MERGED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentIds: string[]; mergedSegment: DemoDawSnapshotSegment }
        >;
        mergeSegments(snapshot, payload.trackVersionId, payload.segmentIds, payload.mergedSegment);
      }
      return snapshot;
    case 'CROSSFADE_SET':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          {
            trackVersionId: string;
            leftSegmentId: string;
            rightSegmentId: string;
            crossfadeInMs: number;
            crossfadeOutMs: number;
            curve: string | null;
          }
        >;
        setCrossfade(
          snapshot,
          payload.trackVersionId,
          payload.leftSegmentId,
          payload.rightSegmentId,
          payload.crossfadeInMs,
          payload.crossfadeOutMs,
          payload.curve,
        );
      }
      return snapshot;
    case 'VERSION_TIMING_UPDATED':
      updateVersionTiming(snapshot, operation.payload as Extract<DemoDawOperationPayload, { versionId: string }>);
      return snapshot;
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED':
      upsertComment(snapshot, operation.payload as Extract<DemoDawOperationPayload, { commentId: string }>);
      return snapshot;
    case 'COMMENT_DELETED':
      upsertComment(
        snapshot,
        operation.payload as Extract<DemoDawOperationPayload, { commentId: string }>,
        true,
      );
      return snapshot;
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED':
      upsertAnnotation(snapshot, operation.payload as Extract<DemoDawOperationPayload, { annotationId: string }>);
      return snapshot;
    case 'ANNOTATION_DELETED':
      upsertAnnotation(
        snapshot,
        operation.payload as Extract<DemoDawOperationPayload, { annotationId: string }>,
        true,
      );
      return snapshot;
    case 'ASSET_ADDED':
      return snapshot;
    default:
      return snapshot;
  }
}

async function resolveAccessibleDemo(
  client: DemoDawDatabaseClient,
  {
    groupId,
    projectId,
    demoId,
    userId,
  }: {
    groupId: string;
    projectId: string;
    demoId: string;
    userId: string;
  },
): Promise<AuthorizedDemoScope | null> {
  const demo = await client.demo.findFirst({
    where: {
      id: demoId,
      project: {
        slug: projectId,
        group: {
          slug: groupId,
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
      name: true,
      description: true,
      currentVersionId: true,
      project: {
        select: {
          id: true,
          slug: true,
          group: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!demo) return null;

  return {
    projectId: demo.project.id,
    demoId: demo.id,
    groupId: demo.project.group.id,
    groupSlug: demo.project.group.slug,
    projectSlug: demo.project.slug,
    demoName: demo.name,
    demoDescription: demo.description,
    currentVersionId: demo.currentVersionId,
  };
}

async function loadDemoSourceData(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
): Promise<DemoSourceData> {
  const demo = await client.demo.findFirst({
    where: {
      id: scope.demoId,
      projectId: scope.projectId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      currentVersionId: true,
      project: {
        select: {
          id: true,
          slug: true,
          group: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      },
      versions: {
        orderBy: {
          createdAt: 'desc',
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
          parentId: true,
          createdAt: true,
          trackVersions: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              durationMs: true,
              startOffsetMs: true,
              createdAt: true,
              isDerived: true,
              operationType: true,
              parentTrackVersionId: true,
              segments: {
                orderBy: {
                  position: 'asc',
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
              },
              track: {
                select: {
                  id: true,
                  name: true,
                  position: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!demo) {
    throw new Error('Demo not found');
  }

  return {
    ...demo,
    comments: [],
    annotations: [],
  };
}

export async function loadLatestDemoSnapshot(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
) {
  return client.projectSnapshot.findFirst({
    where: {
      demoId: scope.demoId,
    },
    orderBy: [
      { operationSeq: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      projectId: true,
      demoId: true,
      operationSeq: true,
      snapshot: true,
      createdById: true,
      createdAt: true,
    },
  });
}

export async function loadDemoOperationTail(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
  afterOperationSeq: number,
): Promise<DemoDawSnapshotOperationRow[]> {
  const rows = await client.projectOperationLog.findMany({
    where: {
      demoId: scope.demoId,
      operationSeq: {
        gt: afterOperationSeq,
      },
    },
    orderBy: {
      operationSeq: 'asc',
    },
    select: {
      id: true,
      projectId: true,
      demoId: true,
      operationType: true,
      createdAt: true,
      actorUserId: true,
      baseSnapshotId: true,
      baseOperationSeq: true,
      operationSeq: true,
      payload: true,
      idempotencyKey: true,
      clientOperationId: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    type: row.operationType as DemoDawOperationType,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    baseSnapshotId: row.baseSnapshotId,
    baseOperationSeq: row.baseOperationSeq,
    operationSeq: row.operationSeq,
    payload: row.payload as DemoDawOperationPayload,
    idempotencyKey: row.idempotencyKey,
    clientOperationId: row.clientOperationId,
  }));
}

export async function appendDemoDawOperation(
  client: DemoDawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    actorUserId: string;
    operationType: DemoDawOperationType;
    payload: DemoDawOperationPayload;
    idempotencyKey?: string;
    clientOperationId?: string;
  },
): Promise<DemoDawOperationInsertResult> {
  const latestSnapshot = await loadLatestDemoSnapshot(client, {
    projectId: input.projectId,
    demoId: input.demoId,
  });

  const existingByIdempotency = input.idempotencyKey
    ? await client.projectOperationLog.findFirst({
        where: {
          demoId: input.demoId,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          id: true,
          operationSeq: true,
        },
      })
    : null;

  if (existingByIdempotency) {
    return {
      ...existingByIdempotency,
      created: false,
    };
  }

  const existingByClientOperationId = input.clientOperationId
    ? await client.projectOperationLog.findFirst({
        where: {
          demoId: input.demoId,
          clientOperationId: input.clientOperationId,
        },
        select: {
          id: true,
          operationSeq: true,
        },
      })
    : null;

  if (existingByClientOperationId) {
    return {
      ...existingByClientOperationId,
      created: false,
    };
  }

  const latestOperation = await client.projectOperationLog.findFirst({
    where: {
      demoId: input.demoId,
    },
    orderBy: {
      operationSeq: 'desc',
    },
    select: {
      operationSeq: true,
    },
  });

  const nextOperationSeq = (latestOperation?.operationSeq ?? 0) + 1;

  const created = await client.projectOperationLog.create({
    data: {
      projectId: input.projectId,
      demoId: input.demoId,
      actorUserId: input.actorUserId,
      baseSnapshotId: latestSnapshot?.id ?? null,
      baseOperationSeq: latestSnapshot?.operationSeq ?? 0,
      operationSeq: nextOperationSeq,
      operationType: input.operationType,
      payload: input.payload as Prisma.InputJsonValue,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      clientOperationId: input.clientOperationId ?? randomUUID(),
    },
    select: {
      id: true,
      operationSeq: true,
    },
  });

  return {
    ...created,
    created: true,
  };
}

export async function recordDemoDawOperation(
  client: DemoDawDatabaseClient,
  input: Parameters<typeof appendDemoDawOperation>[1],
  options?: {
    checkpointTailOperations?: number;
    checkpointCreatedById?: string | null;
    forceCheckpoint?: boolean;
  },
) {
  const operation = await appendDemoDawOperation(client, input);

  if (!operation.created) {
    return operation;
  }

  const shouldCheckpoint = await shouldCheckpointDemoDawSnapshot(
    client,
    {
      projectId: input.projectId,
      demoId: input.demoId,
    },
    options?.checkpointTailOperations,
  );

  if (shouldCheckpoint || options?.forceCheckpoint) {
    const derivedState = await loadSnapshotStateForDemo(client, {
      projectId: input.projectId,
      demoId: input.demoId,
    });

    await checkpointDemoDawSnapshot(
      client,
      {
        projectId: input.projectId,
        demoId: input.demoId,
        createdById: options?.checkpointCreatedById ?? input.actorUserId,
      },
      derivedState,
    );
  }

  return operation;
}

async function writeDemoDawSnapshot(
  client: DemoDawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    createdById?: string | null;
    snapshotState: DemoDawSnapshotData;
  },
) {
  const scope = {
    projectId: input.projectId,
    demoId: input.demoId,
  };
  const latestSnapshot = await loadLatestDemoSnapshot(client, scope);
  const latestOperation = await client.projectOperationLog.findFirst({
    where: {
      demoId: input.demoId,
    },
    orderBy: {
      operationSeq: 'desc',
    },
    select: {
      operationSeq: true,
      actorUserId: true,
    },
  });

  const createdById = input.createdById ?? latestOperation?.actorUserId ?? latestSnapshot?.createdById;
  if (!createdById) {
    throw new Error('Unable to determine snapshot author');
  }

  return client.projectSnapshot.create({
    data: {
      projectId: input.projectId,
      demoId: input.demoId,
      operationSeq: latestOperation?.operationSeq ?? latestSnapshot?.operationSeq ?? 0,
      snapshot: input.snapshotState as unknown as Prisma.InputJsonValue,
      createdById,
    },
    select: {
      id: true,
      operationSeq: true,
      createdAt: true,
    },
  });
}

export async function checkpointDemoDawSnapshot(
  client: DemoDawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    createdById?: string | null;
  },
  snapshotState?: DemoDawSnapshotData,
) {
  const scope = {
    projectId: input.projectId,
    demoId: input.demoId,
  };
  const source = snapshotState ?? serializeDemoSourceData(await loadDemoSourceData(client, scope));
  return writeDemoDawSnapshot(client, {
    projectId: input.projectId,
    demoId: input.demoId,
    createdById: input.createdById,
    snapshotState: source,
  });
}

export async function loadDemoDawPageDataWithSnapshots({
  groupId,
  projectId,
  demoId,
  userId,
}: {
  groupId: string;
  projectId: string;
  demoId: string;
  userId: string;
}): Promise<DemoDawSnapshotData | null> {
  const accessibleDemo = await resolveAccessibleDemo(prisma, {
    groupId,
    projectId,
    demoId,
    userId,
  });

  if (!accessibleDemo) {
    return null;
  }

  return loadSnapshotStateForDemo(prisma, accessibleDemo);
}

export async function loadSnapshotStateForDemo(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
) {
  const latestSnapshot = await loadLatestDemoSnapshot(client, scope);

  if (!latestSnapshot) {
    const result = serializeDemoSourceData(await loadDemoSourceData(client, scope));
    const operations = await loadDemoOperationTail(client, scope, 0);
    for (const operation of operations) {
      applyDemoOperation(result, operation);
    }
    return result;
  }

  const snapshot = latestSnapshot.snapshot as unknown as DemoDawSnapshotData;
  const result = cloneSnapshot(snapshot);
  if (!result.project?.id || !result.project.group?.id) {
    hydrateSnapshotProjectMetadata(result, await loadDemoSourceData(client, scope));
  }
  const tailOperations = await loadDemoOperationTail(client, scope, latestSnapshot.operationSeq);

  for (const operation of tailOperations) {
    applyDemoOperation(result, operation);
  }

  return result;
}

export async function getLatestSnapshotSequence(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
) {
  const latestSnapshot = await loadLatestDemoSnapshot(client, scope);
  return latestSnapshot?.operationSeq ?? 0;
}

export async function shouldCheckpointDemoDawSnapshot(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
  maxTailOperations = DEFAULT_SNAPSHOT_CHECKPOINT_TAIL,
) {
  const latestSnapshot = await loadLatestDemoSnapshot(client, scope);
  const latestOperation = await client.projectOperationLog.findFirst({
    where: {
      demoId: scope.demoId,
    },
    orderBy: {
      operationSeq: 'desc',
    },
    select: {
      operationSeq: true,
    },
  });

  const latestSnapshotSeq = latestSnapshot?.operationSeq ?? 0;
  const latestOperationSeq = latestOperation?.operationSeq ?? 0;

  return latestOperationSeq - latestSnapshotSeq >= maxTailOperations;
}
