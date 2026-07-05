import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, prisma } from '@git-for-music/db';
import { buildTrackVersionAudioUrl } from '@git-for-music/shared';
import { loadOrCreateDemoUserActiveVersionState } from '@/app/lib/daw/server/demo-user-active-version';

export type DemoDawTimingSource = 'MANUAL' | 'ANALYZED' | 'IMPORTED';

export interface DemoDawSnapshotSegment {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  timelineEndMs: number | null;
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
  operationHistory: DemoDawSnapshotOperationHistoryItem[];
}

export interface DemoDawPageData extends DemoDawSnapshotData {
  activeVersionId: string | null;
  isFollowingHead: boolean;
  activeBranchName: string | null;
}

export interface DemoDawSnapshotOperationHistoryItem {
  operationId: string;
  operationSeq: number;
  operationType: DemoDawOperationType;
  versionId: string | null;
  currentVersionId: string | null;
  trackId: string | null;
  segmentId: string | null;
  summary: string;
  actorUserId: string;
  createdAt: string;
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
  | 'TRACK_REMOVED'
  | 'TRACK_OFFSET_UPDATED'
  | 'SEGMENT_SPLIT'
  | 'SEGMENT_MOVED'
  | 'SEGMENT_DELETED'
  | 'SEGMENT_TRIMMED'
  | 'SEGMENT_MERGED'
  | 'SEGMENT_FADE_SET'
  | 'CROSSFADE_SET'
  | 'VERSION_CREATED'
  | 'VERSION_RENAMED'
  | 'VERSION_SELECTED'
  | 'VERSION_BRANCH_CREATED'
  | 'VERSION_REVERTED_FROM'
  | 'CURRENT_VERSION_CHANGED'
  | 'TRACK_VERSION_CREATED'
  | 'VERSION_PARENT_SET'
  | 'VERSION_OPERATION_SUMMARY_SET'
  | 'VERSION_NODE_ADDED'
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
      trackId: string;
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
      segmentId: string;
      fromTrackVersionId: string;
      toTrackVersionId: string;
      fromTimelineStartMs: number;
      fromTimelineEndMs: number;
      toTimelineStartMs: number;
      toTimelineEndMs: number;
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
      segmentId: string;
      fadeInMs: number;
      fadeOutMs: number;
      previousFadeInMs?: number | null;
      previousFadeOutMs?: number | null;
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
      trackId: string;
      assetId: string;
      storageKey: string;
      name: string;
      trackVersionId: string | null;
      startOffsetMs: number;
      durationMs: number;
      sourceStartMs: number;
      sourceEndMs: number;
      timelineStartMs: number;
      timelineEndMs: number;
      gainDb: number;
      fadeInMs: number;
      fadeOutMs: number;
      isMuted: boolean;
      position: number;
      recordedTempoBpm: number | null;
      sourceTempoBpm: number | null;
      createdAt: string;
    }
  | {
      trackId: string;
      assetId: string;
      storageKey: string;
      name: string;
      trackVersionId: string | null;
      startOffsetMs: number;
      durationMs: number;
      sourceStartMs: number;
      sourceEndMs: number;
      timelineStartMs: number;
      timelineEndMs: number;
      gainDb: number;
      fadeInMs: number;
      fadeOutMs: number;
      isMuted: boolean;
      position: number;
      recordedTempoBpm: number | null;
      sourceTempoBpm: number | null;
      createdAt: string;
      restoredAt: string;
      restoredBy: string;
      operationSummary: string;
    }
  | {
      trackId: string;
      deletedAt: string;
      deletedBy: string;
      operationSummary: string;
    }
  | {
      versionId?: string;
      parentVersionId?: string | null;
      branchName?: string | null;
      branchMode?: 'continue' | 'fork';
      label?: string | null;
      createdAt?: string;
      createdBy?: string;
      operationSummary?: string | null;
      version: DemoDawSnapshotVersion;
    }
  | {
      versionId: string;
      label: string;
    }
  | {
      currentVersionId: string;
      previousVersionId: string | null;
    }
  | {
      branchMode?: 'continue' | 'fork';
      version: DemoDawSnapshotVersion;
      sourceVersionId: string;
    }
  | {
      versionId?: string;
      revertedFromVersionId: string;
      currentVersionId: string;
      branchMode?: 'continue' | 'fork';
      branchName?: string | null;
      label?: string | null;
      createdAt?: string;
      createdBy?: string;
      operationSummary?: string | null;
      version: DemoDawSnapshotVersion;
    }
  | {
      previousVersionId: string | null;
      currentVersionId: string;
    }
  | {
      versionId?: string | null;
      trackId?: string;
      trackVersionId?: string;
      operationSummary?: string | null;
      track: DemoDawSnapshotTrack;
    }
  | {
      versionId: string;
      parentId: string | null;
    }
  | {
      versionId: string;
      description: string | null;
    }
  | {
      version: DemoDawSnapshotVersion;
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
  createdAt?: string;
  projectId?: string;
  demoId?: string;
  actorUserId?: string;
  operationType?: DemoDawOperationType;
  payload?: DemoDawOperationPayload;
  baseSnapshotId?: string | null;
  baseOperationSeq?: number;
  idempotencyKey?: string;
  clientOperationId?: string;
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
const DEFAULT_SNAPSHOT_CHECKPOINT_DEBOUNCE_WINDOW_MS = 5_000;
const DEFAULT_SNAPSHOT_CHECKPOINT_OPERATION_COUNT_K = 12;
const AUTO_VERSION_SEMANTIC_OPERATION_TYPES = new Set<
  DemoDawOperationType | 'TRACK_ADDED' | 'TRACK_REMOVED'
>([
  'TRACK_ADDED',
  'TRACK_REMOVED',
  'TRACK_VERSION_CREATED',
  'SEGMENT_SPLIT',
  'SEGMENT_MERGED',
  'TRACK_OFFSET_UPDATED',
  'SEGMENT_MOVED',
  'SEGMENT_DELETED',
  'SEGMENT_FADE_SET',
  'CROSSFADE_SET',
]);

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeTrackVersion(trackVersion: DemoSourceVersionRow['trackVersions'][number]): DemoDawSnapshotTrack {
  return {
    trackId: trackVersion.track.id,
    trackName: trackVersion.track.name,
    trackPosition: trackVersion.track.position,
    trackVersionId: trackVersion.id,
    storageKey: buildTrackVersionAudioUrl(trackVersion.id),
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
  const timelineEndMs = timelineStartMs + Math.max(0, segment.endMs - segment.startMs);
  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
    timelineEndMs,
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
    operationHistory: [],
  };
}

function cloneSnapshot<T>(snapshot: T): T {
  return structuredClone(snapshot);
}

function normalizeSnapshotTrackAudioUrls(snapshot: DemoDawSnapshotData) {
  for (const version of snapshot.versions) {
    for (const track of version.tracks) {
      track.storageKey = buildTrackVersionAudioUrl(track.trackVersionId);
    }
  }
}

function ensureOperationHistory(snapshot: DemoDawSnapshotData) {
  snapshot.operationHistory ??= [];
  return snapshot.operationHistory;
}

function upsertOperationHistory(
  snapshot: DemoDawSnapshotData,
  item: DemoDawSnapshotOperationHistoryItem,
) {
  const history = ensureOperationHistory(snapshot);
  const existingIndex = history.findIndex((entry) => entry.operationId === item.operationId);
  const nextHistory =
    existingIndex === -1
      ? [...history, item]
      : history.map((entry) => (entry.operationId === item.operationId ? { ...entry, ...item } : entry));
  snapshot.operationHistory = nextHistory.slice(-100);
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

function removeTrack(snapshot: DemoDawSnapshotData, trackId: string) {
  snapshot.versions = snapshot.versions.map((version) => ({
    ...version,
    tracks: version.tracks.filter((track) => track.trackId !== trackId),
  }));
  snapshot.comments = snapshot.comments.filter((comment) => comment.trackId !== trackId);
  snapshot.annotations = snapshot.annotations.filter((annotation) => annotation.trackId !== trackId);
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

  if ('label' in payload && payload.label !== undefined) version.label = payload.label;
  if ('tempoBpm' in payload) version.tempoBpm = payload.tempoBpm ?? null;
  if ('timeSignatureNum' in payload) version.timeSignatureNum = payload.timeSignatureNum ?? version.timeSignatureNum;
  if ('timeSignatureDen' in payload) version.timeSignatureDen = payload.timeSignatureDen ?? version.timeSignatureDen;
  if ('musicalKey' in payload) version.musicalKey = payload.musicalKey ?? null;
  if ('tempoSource' in payload && payload.tempoSource) version.tempoSource = payload.tempoSource;
  if ('keySource' in payload && payload.keySource) version.keySource = payload.keySource;
}

function normalizeSnapshotTrackSegments(segments: DemoDawSnapshotSegment[]) {
  return segments.map((segment, index) => ({
    ...segment,
    position: index,
  }));
}

function upsertVersion(snapshot: DemoDawSnapshotData, version: DemoDawSnapshotVersion) {
  const existingIndex = snapshot.versions.findIndex((candidate) => candidate.id === version.id);
  if (existingIndex === -1) {
    snapshot.versions = [...snapshot.versions, cloneSnapshot(version)];
    return;
  }

  const existing = snapshot.versions[existingIndex]!;
  const tracks =
    version.tracks && version.tracks.length > 0 ? cloneSnapshot(version.tracks) : existing.tracks;
  snapshot.versions = snapshot.versions.map((candidate) =>
    candidate.id === version.id
      ? {
          ...existing,
          ...cloneSnapshot(version),
          tracks: cloneSnapshot(tracks),
        }
      : candidate,
  );
}

function upsertVersionTrack(snapshot: DemoDawSnapshotData, versionId: string, track: DemoDawSnapshotTrack) {
  const version = snapshot.versions.find((candidate) => candidate.id === versionId);
  if (!version) return;

  const existingIndex = version.tracks.findIndex(
    (candidate) => candidate.trackVersionId === track.trackVersionId || candidate.trackId === track.trackId,
  );
  if (existingIndex === -1) {
    version.tracks = [...version.tracks, cloneSnapshot(track)];
    return;
  }

  version.tracks = version.tracks.map((candidate) =>
    candidate.trackVersionId === track.trackVersionId || candidate.trackId === track.trackId
      ? { ...candidate, ...cloneSnapshot(track) }
      : candidate,
  );
}

function setCurrentVersion(snapshot: DemoDawSnapshotData, currentVersionId: string) {
  snapshot.currentVersionId = currentVersionId;
  snapshot.versions = snapshot.versions.map((version) => ({
    ...version,
    isCurrent: version.id === currentVersionId,
  }));
}

function getLatestVersionId(snapshot: DemoDawSnapshotData) {
  let latestVersionId: string | null = null;
  let latestCreatedAt = -Infinity;

  for (const version of snapshot.versions) {
    const createdAt = Date.parse(version.createdAt);
    if (!Number.isFinite(createdAt)) {
      continue;
    }

    if (latestVersionId === null || createdAt > latestCreatedAt) {
      latestVersionId = version.id;
      latestCreatedAt = createdAt;
    }
  }

  return latestVersionId;
}

function reconcileCurrentVersion(snapshot: DemoDawSnapshotData) {
  const latestVersionId = getLatestVersionId(snapshot);
  if (!latestVersionId) {
    return;
  }

  setCurrentVersion(snapshot, latestVersionId);
}

function moveSegment(
  snapshot: DemoDawSnapshotData,
  payload: {
    segmentId: string;
    fromTrackVersionId: string;
    toTrackVersionId: string;
    fromTimelineStartMs: number;
    fromTimelineEndMs: number;
    toTimelineStartMs: number;
    toTimelineEndMs: number;
  },
) {
  for (const version of snapshot.versions) {
    const sourceTrackIndex = version.tracks.findIndex((candidate) => candidate.trackVersionId === payload.fromTrackVersionId);
    const targetTrackIndex = version.tracks.findIndex((candidate) => candidate.trackVersionId === payload.toTrackVersionId);

    if (targetTrackIndex === -1) continue;

    const sourceTrack = sourceTrackIndex >= 0 ? version.tracks[sourceTrackIndex] : null;
    const targetTrack = version.tracks[targetTrackIndex] ?? null;
    if (!targetTrack) continue;

    const occurrences = version.tracks.flatMap((track) =>
      track.segments
        .filter((segment) => segment.id === payload.segmentId)
        .map((segment) => ({
          track,
          segment,
        })),
    );

    const sourceSegment = sourceTrack?.segments.find((segment) => segment.id === payload.segmentId) ?? null;
    const targetSegment = targetTrack.segments.find((segment) => segment.id === payload.segmentId) ?? null;
    const existingSegment = sourceSegment ?? targetSegment ?? occurrences[0]?.segment ?? null;

    if (!existingSegment) continue;

    if (
      occurrences.length === 1 &&
      targetSegment &&
      targetSegment.trackVersionId === payload.toTrackVersionId &&
      targetSegment.timelineStartMs === payload.toTimelineStartMs &&
      targetSegment.timelineEndMs === payload.toTimelineEndMs
    ) {
      return;
    }

    const cleanedTracks = version.tracks.map((track) => ({
      ...track,
      segments: normalizeSnapshotTrackSegments(track.segments.filter((segment) => segment.id !== payload.segmentId)),
    }));
    const cleanedTargetTrack = cleanedTracks.find((track) => track.trackVersionId === payload.toTrackVersionId);
    if (!cleanedTargetTrack) continue;

    const insertionIndex =
      payload.fromTrackVersionId === payload.toTrackVersionId
        ? Math.min(existingSegment.position, cleanedTargetTrack.segments.length)
        : cleanedTargetTrack.segments.length;

    const movedSegment: DemoDawSnapshotSegment = {
      ...existingSegment,
      trackVersionId: payload.toTrackVersionId,
      timelineStartMs: payload.toTimelineStartMs,
      timelineEndMs: payload.toTimelineEndMs,
      position: insertionIndex,
    };

    const nextTargetSegments = normalizeSnapshotTrackSegments(
      [
        ...cleanedTargetTrack.segments.slice(0, insertionIndex),
        movedSegment,
        ...cleanedTargetTrack.segments.slice(insertionIndex),
      ].map((segment) => ({
        ...segment,
        trackVersionId: payload.toTrackVersionId,
      })),
    );

    version.tracks = cleanedTracks.map((track) =>
      track.trackVersionId === payload.toTrackVersionId
        ? {
            ...track,
            segments: nextTargetSegments,
          }
        : track,
    );
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

function setSegmentFade(
  snapshot: DemoDawSnapshotData,
  trackVersionId: string,
  segmentId: string,
  fadeInMs: number,
  fadeOutMs: number,
) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) continue;

    track.segments = track.segments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            fadeInMs,
            fadeOutMs,
          }
        : segment,
    );
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
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'TRACK_REMOVED':
      {
        const payload = operation.payload as Extract<DemoDawOperationPayload, { trackId: string }>;
        removeTrack(snapshot, payload.trackId);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
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
      {
        upsertSplitSegments(
          snapshot,
          operation.payload as Extract<
            DemoDawOperationPayload,
            { sourceSegmentId: string | null; leftSegment: DemoDawSnapshotSegment; rightSegment: DemoDawSnapshotSegment }
          >,
        );
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'SEGMENT_MOVED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          {
            segmentId: string;
            fromTrackVersionId: string;
            toTrackVersionId: string;
            fromTimelineStartMs: number;
            fromTimelineEndMs: number;
            toTimelineStartMs: number;
            toTimelineEndMs: number;
          }
        >;
        moveSegment(snapshot, payload);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'SEGMENT_DELETED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentId: string }
        >;
        removeSegment(snapshot, payload.trackVersionId, payload.segmentId);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'SEGMENT_TRIMMED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentId: string; to: { startMs: number; endMs: number } }
        >;
        trimSegment(snapshot, payload.trackVersionId, payload.segmentId, payload.to);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'SEGMENT_MERGED':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { trackVersionId: string; segmentIds: string[]; mergedSegment: DemoDawSnapshotSegment }
        >;
        mergeSegments(snapshot, payload.trackVersionId, payload.segmentIds, payload.mergedSegment);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'SEGMENT_FADE_SET':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          {
            trackVersionId: string;
            segmentId: string;
            fadeInMs: number;
            fadeOutMs: number;
          }
        >;
        setSegmentFade(snapshot, payload.trackVersionId, payload.segmentId, payload.fadeInMs, payload.fadeOutMs);
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
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
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'VERSION_CREATED':
    case 'VERSION_NODE_ADDED':
      upsertVersion(
        snapshot,
        (operation.payload as Extract<DemoDawOperationPayload, { version: DemoDawSnapshotVersion }>).version,
      );
      return snapshot;
    case 'VERSION_BRANCH_CREATED':
    case 'VERSION_REVERTED_FROM':
      {
        const payload = operation.payload as Extract<
          DemoDawOperationPayload,
          { version?: DemoDawSnapshotVersion; versionId?: string; currentVersionId?: string }
        >;
        if (payload.version) {
          upsertVersion(snapshot, payload.version);
        } else if (payload.currentVersionId) {
          setCurrentVersion(snapshot, payload.currentVersionId);
        }
      }
      return snapshot;
    case 'VERSION_RENAMED':
      {
        const payload = operation.payload as Extract<DemoDawOperationPayload, { versionId: string; label: string }>;
        const version = snapshot.versions.find((candidate) => candidate.id === payload.versionId);
        if (version) {
          version.label = payload.label;
        }
      }
      return snapshot;
    case 'VERSION_SELECTED':
    case 'CURRENT_VERSION_CHANGED':
      return snapshot;
    case 'TRACK_VERSION_CREATED':
      {
        const payload = operation.payload as {
          versionId?: string | null;
          track: DemoDawSnapshotTrack;
        };
        if (payload.versionId) {
          upsertVersionTrack(snapshot, payload.versionId, payload.track);
        }
        const historyItem = buildOperationHistoryItem(snapshot, operation);
        if (historyItem) {
          upsertOperationHistory(snapshot, historyItem);
        }
      }
      return snapshot;
    case 'VERSION_PARENT_SET':
      {
        const payload = operation.payload as Extract<DemoDawOperationPayload, { versionId: string; parentId: string | null }>;
        const version = snapshot.versions.find((candidate) => candidate.id === payload.versionId);
        if (version) {
          version.parentId = payload.parentId;
        }
      }
      return snapshot;
    case 'VERSION_OPERATION_SUMMARY_SET':
      {
        const payload = operation.payload as Extract<DemoDawOperationPayload, { versionId: string; description: string | null }>;
        const version = snapshot.versions.find((candidate) => candidate.id === payload.versionId);
        if (version) {
          version.description = payload.description;
        }
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

export async function loadLatestDemoSnapshotAtOrBeforeOperationSeq(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
  operationSeq: number,
) {
  return client.projectSnapshot.findFirst({
    where: {
      projectId: scope.projectId,
      demoId: scope.demoId,
      operationSeq: {
        lte: operationSeq,
      },
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

function findTrackById(snapshot: DemoDawSnapshotData, trackId: string) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackId === trackId);
    if (track) return track;
  }
  return null;
}

function findTrackByVersionId(snapshot: DemoDawSnapshotData, trackVersionId: string) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (track) return track;
  }
  return null;
}

function buildOperationHistoryItem(
  snapshot: DemoDawSnapshotData,
  operation: DemoDawSnapshotOperationRow,
): DemoDawSnapshotOperationHistoryItem | null {
  const currentVersionId = snapshot.currentVersionId ?? null;
  const baseItem = {
    operationId: operation.id,
    operationSeq: operation.operationSeq,
    operationType: operation.type,
    versionId: currentVersionId,
    currentVersionId,
    trackId: null,
    segmentId: null,
    actorUserId: operation.actorUserId,
    createdAt: operation.createdAt,
  } satisfies Omit<DemoDawSnapshotOperationHistoryItem, 'summary'>;

  switch (operation.type) {
    case 'TRACK_RENAMED': {
      const payload = operation.payload as Extract<DemoDawOperationPayload, { trackId: string; trackName: string }>;
      const track = findTrackById(snapshot, payload.trackId);
      return {
        ...baseItem,
        trackId: payload.trackId,
        summary: track ? `Renamed track to ${payload.trackName.trim()}` : 'Renamed track',
      };
    }
    case 'TRACK_REMOVED': {
      const payload = operation.payload as Extract<DemoDawOperationPayload, { trackId: string }>;
      const track = findTrackById(snapshot, payload.trackId);
      return {
        ...baseItem,
        trackId: payload.trackId,
        summary: track ? `Deleted track ${track.trackName}` : 'Deleted track',
      };
    }
    case 'TRACK_VERSION_CREATED': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        { trackId?: string; trackVersionId?: string; track: DemoDawSnapshotTrack }
      >;
      return {
        ...baseItem,
        trackId: payload.trackId ?? payload.track?.trackId ?? null,
        summary: `Created track version${payload.track?.trackName ? ` for ${payload.track.trackName}` : ''}`,
      };
    }
    case 'SEGMENT_SPLIT': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        { trackVersionId: string; segmentId?: string; leftSegment: DemoDawSnapshotSegment; rightSegment: DemoDawSnapshotSegment }
      >;
      const track = findTrackByVersionId(snapshot, payload.trackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.sourceSegmentId ?? null,
        summary: track ? `Split clip on ${track.trackName}` : 'Split clip',
      };
    }
    case 'SEGMENT_MOVED': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        {
          segmentId: string;
          fromTrackVersionId: string;
          toTrackVersionId: string;
          fromTimelineStartMs: number;
          fromTimelineEndMs: number;
          toTimelineStartMs: number;
          toTimelineEndMs: number;
        }
      >;
      const track = findTrackByVersionId(snapshot, payload.toTrackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId,
        summary: track ? `Moved clip on ${track.trackName}` : 'Moved clip',
      };
    }
    case 'SEGMENT_TRIMMED': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        { trackVersionId: string; segmentId: string; to: { startMs: number; endMs: number } }
      >;
      const track = findTrackByVersionId(snapshot, payload.trackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId,
        summary: track ? `Trimmed clip on ${track.trackName}` : 'Trimmed clip',
      };
    }
    case 'SEGMENT_MERGED': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        { trackVersionId: string; segmentIds: string[]; mergedSegment: DemoDawSnapshotSegment }
      >;
      const track = findTrackByVersionId(snapshot, payload.trackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentIds[0] ?? null,
        summary: track ? `Merged clips on ${track.trackName}` : 'Merged clips',
      };
    }
    case 'SEGMENT_FADE_SET': {
      const payload = operation.payload as Extract<
        DemoDawOperationPayload,
        { trackVersionId: string; segmentId: string }
      >;
      const track = findTrackByVersionId(snapshot, payload.trackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId,
        summary: track ? `Set fade on ${track.trackName}` : 'Set fade',
      };
    }
    case 'CROSSFADE_SET': {
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
      const track = findTrackByVersionId(snapshot, payload.trackVersionId);
      return {
        ...baseItem,
        trackId: track?.trackId ?? null,
        segmentId: payload.leftSegmentId,
        summary: track ? `Adjusted crossfade on ${track.trackName}` : 'Adjusted crossfade',
      };
    }
    default:
      return null;
  }
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
    createdAt: toIsoString(row.createdAt),
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
      createdAt: true,
    },
  });

  return {
    id: created.id,
    operationSeq: created.operationSeq,
    createdAt: toIsoString(created.createdAt),
    created: true,
    projectId: input.projectId,
    demoId: input.demoId,
    actorUserId: input.actorUserId,
    operationType: input.operationType,
    payload: input.payload,
    baseSnapshotId: latestSnapshot?.id ?? null,
    baseOperationSeq: latestSnapshot?.operationSeq ?? 0,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    clientOperationId: input.clientOperationId ?? randomUUID(),
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
  const source = snapshotState ?? (await loadSnapshotStateForDemo(client, scope));
  reconcileCurrentVersion(source);
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
  operationSeq,
}: {
  groupId: string;
  projectId: string;
  demoId: string;
  userId: string;
  operationSeq?: number | null;
}): Promise<DemoDawPageData | null> {
  const accessibleDemo = await resolveAccessibleDemo(prisma, {
    groupId,
    projectId,
    demoId,
    userId,
  });

  if (!accessibleDemo) {
    return null;
  }

  const [snapshotState, activeVersionState] = await Promise.all([
    loadSnapshotStateForDemo(prisma, accessibleDemo, {
      operationSeq,
    }),
    loadOrCreateDemoUserActiveVersionState(prisma, {
      // Use the resolved database project id here. The route param is a slug.
      projectId: accessibleDemo.projectId,
      demoId,
      userId,
    }),
  ]);

  return {
    ...snapshotState,
    activeVersionId: activeVersionState.activeVersionId,
    isFollowingHead: activeVersionState.isFollowingHead,
    activeBranchName: activeVersionState.activeBranchName,
  };
}

export async function loadSnapshotStateForDemo(
  client: DemoDawDatabaseClient,
  scope: DemoScope,
  options: {
    operationSeq?: number | null;
  } = {},
) {
  const targetOperationSeq =
    typeof options.operationSeq === 'number' && Number.isFinite(options.operationSeq)
      ? options.operationSeq
      : null;

  if (targetOperationSeq !== null) {
    const latestSnapshot = await loadLatestDemoSnapshotAtOrBeforeOperationSeq(
      client,
      scope,
      targetOperationSeq,
    );

    if (!latestSnapshot) {
      const result = serializeDemoSourceData(await loadDemoSourceData(client, scope));
      const operations = await loadDemoOperationTail(client, scope, 0);
      for (const operation of operations) {
        if (operation.operationSeq > targetOperationSeq) {
          break;
        }
        applyDemoOperation(result, operation);
      }
      ensureOperationHistory(result);
      reconcileCurrentVersion(result);
      return result;
    }

    const snapshot = latestSnapshot.snapshot as unknown as DemoDawSnapshotData;
    const result = cloneSnapshot(snapshot);
    if (result && typeof result === 'object') {
      delete (result as unknown as Record<string, unknown>).recordingTakesByTrackId;
    }
    if (!result.project?.id || !result.project.group?.id) {
      hydrateSnapshotProjectMetadata(result, await loadDemoSourceData(client, scope));
    }
    ensureOperationHistory(result);
    const tailOperations = await loadDemoOperationTail(client, scope, latestSnapshot.operationSeq);

    for (const operation of tailOperations) {
      if (operation.operationSeq > targetOperationSeq) {
        break;
      }
      applyDemoOperation(result, operation);
    }

    reconcileCurrentVersion(result);
    normalizeSnapshotTrackAudioUrls(result);
    return result;
  }

  const latestSnapshot = await loadLatestDemoSnapshot(client, scope);

  if (!latestSnapshot) {
    const result = serializeDemoSourceData(await loadDemoSourceData(client, scope));
    const operations = await loadDemoOperationTail(client, scope, 0);
    for (const operation of operations) {
      applyDemoOperation(result, operation);
    }
    reconcileCurrentVersion(result);
    normalizeSnapshotTrackAudioUrls(result);
    return result;
  }

  const snapshot = latestSnapshot.snapshot as unknown as DemoDawSnapshotData;
  const result = cloneSnapshot(snapshot);
  if (result && typeof result === 'object') {
    delete (result as unknown as Record<string, unknown>).recordingTakesByTrackId;
  }
  if (!result.project?.id || !result.project.group?.id) {
    hydrateSnapshotProjectMetadata(result, await loadDemoSourceData(client, scope));
  }
  ensureOperationHistory(result);
  const tailOperations = await loadDemoOperationTail(client, scope, latestSnapshot.operationSeq);

  for (const operation of tailOperations) {
    applyDemoOperation(result, operation);
  }

  reconcileCurrentVersion(result);
  normalizeSnapshotTrackAudioUrls(result);

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

export function shouldCreateAutoVersion(input: {
  latestOperationType: DemoDawOperationType | 'TRACK_ADDED' | 'TRACK_REMOVED';
  latestOperationCreatedAt: Date | string;
  latestOperationSeq: number;
  latestVersionOperationSeq: number | null;
  now?: Date | string;
  debounceWindowMs?: number;
  operationCountK?: number;
}) {
  if (AUTO_VERSION_SEMANTIC_OPERATION_TYPES.has(input.latestOperationType)) {
    return true;
  }

  const now = input.now ? new Date(toIsoString(input.now)) : new Date();
  const latestOperationCreatedAt = new Date(toIsoString(input.latestOperationCreatedAt));
  const debounceWindowMs =
    input.debounceWindowMs ?? DEFAULT_SNAPSHOT_CHECKPOINT_DEBOUNCE_WINDOW_MS;
  const operationCountK = input.operationCountK ?? DEFAULT_SNAPSHOT_CHECKPOINT_OPERATION_COUNT_K;
  const latestVersionOperationSeq = input.latestVersionOperationSeq ?? 0;

  if (now.getTime() - latestOperationCreatedAt.getTime() >= debounceWindowMs) {
    return true;
  }

  return input.latestOperationSeq - latestVersionOperationSeq >= operationCountK;
}
