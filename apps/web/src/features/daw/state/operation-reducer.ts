import type { DemoAnnotation, DemoComment } from '@git-for-music/shared';
import type {
  DawTrack,
  DawVersion,
  LocalProjectState,
  ProjectOperationHistoryEntry,
  TrackRecordingTake,
  TrackTimelineSegment,
} from './local-project-state';
import type { DawProjectOperationRecord, DawProjectBootstrapResponse, DawSegmentSnapshot } from '@/features/daw/protocol';

export type TimelineHistoryEntry =
  | {
      kind: 'move-track';
      trackVersionId: string;
      previousStartOffsetMs: number;
      nextStartOffsetMs: number;
    }
  | {
      kind: 'move-segment';
      trackVersionId: string;
      segmentId: string;
      previousTimelineStartMs: number;
      nextTimelineStartMs: number;
    }
  | {
      kind: 'move-segment-track';
      sourceTrackVersionId: string;
      targetTrackVersionId: string;
      segmentId: string;
      previousSourceSegments: TrackTimelineSegment[];
      previousTargetSegments: TrackTimelineSegment[];
      nextSourceSegments: TrackTimelineSegment[];
      nextTargetSegments: TrackTimelineSegment[];
      previousSelectedTrackVersionId: string | null;
      previousSelectedSegmentId: string | null;
    }
  | {
      kind: 'cut';
      trackVersionId: string;
      previousSegments: TrackTimelineSegment[];
      nextSegments: TrackTimelineSegment[];
      previousSelectedSegmentId: string | null;
    }
  | {
      kind: 'delete-segment';
      trackVersionId: string;
      previousSegments: TrackTimelineSegment[];
      nextSegments: TrackTimelineSegment[];
      previousSelectedSegmentId: string | null;
    }
  | {
      kind: 'recording-takes';
      trackId: string;
      previousTakes: TrackRecordingTake[];
      nextTakes: TrackRecordingTake[];
      previousSelectedTrackVersionId: string | null;
      previousSelectedSegmentId: string | null;
      targetTrackId?: string;
      targetPreviousTakes?: TrackRecordingTake[];
      targetNextTakes?: TrackRecordingTake[];
      deletedTake?: TrackRecordingTake;
    };

type CommentLike = {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

type AnnotationLike = {
  id: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

type NestedAuthorLike = {
  id?: string;
  name?: string | null;
  avatarUrl?: string | null;
};

type CommentOrAnnotationLike = {
  trackId?: string | null;
  segmentId?: string | null;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
  body?: string;
  createdBy?: string;
  resolved?: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: NestedAuthorLike;
};

function updateSegments(
  track: DawTrack,
  updater: (segments: TrackTimelineSegment[]) => TrackTimelineSegment[],
) {
  return {
    ...track,
    segments: updater(track.segments),
  };
}

function upsertVersionTrack(versions: DawVersion[], versionId: string, track: DawTrack) {
  return versions.map((version) => {
    if (version.id !== versionId) return version;
    const existingIndex = version.tracks.findIndex((entry) => entry.trackVersionId === track.trackVersionId);
    if (existingIndex === -1) {
      return {
        ...version,
        tracks: [...version.tracks, track],
      };
    }

    return {
      ...version,
      tracks: version.tracks.map((entry) => (entry.trackVersionId === track.trackVersionId ? { ...entry, ...track } : entry)),
    };
  });
}

function touchVersionTree(state: LocalProjectState, operation: DawProjectOperationRecord) {
  return {
    versionTreeUpdatedAt: operation.createdAt,
    lastVersionOperationSeq: operation.operationSeq,
  };
}

type VersionTreeNodeLike = {
  id: string;
  label?: string | null;
  name?: string | null;
  branchName?: string | null;
  operationSummary?: string | null;
  description?: string | null;
  parentId?: string | null;
  parentVersionId?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  operationSeq?: number;
  isCurrent?: boolean;
  tempoBpm?: number | null;
  timeSignatureNum?: number;
  timeSignatureDen?: number;
  musicalKey?: string | null;
  tempoSource?: DawVersion['tempoSource'];
  keySource?: DawVersion['keySource'];
  tracks?: DawTrack[];
};

function normalizeVersionNode(
  node: VersionTreeNodeLike,
  currentVersionId: string,
  existing?: DawVersion,
): DawVersion {
  const label = node.label ?? node.name ?? node.branchName ?? existing?.label ?? '';
  const parentVersionId = node.parentVersionId ?? node.parentId ?? existing?.parentVersionId ?? existing?.parentId ?? null;
  const createdAt = node.createdAt ?? existing?.createdAt ?? new Date().toISOString();
  const tracks = node.tracks && node.tracks.length > 0 ? node.tracks : existing?.tracks ?? [];
  const isCurrent = node.isCurrent ?? Boolean(node.id === currentVersionId || existing?.isCurrent);
  return {
    id: node.id,
    label,
    name: node.name ?? label,
    branchName: node.branchName ?? label,
    operationSummary: node.operationSummary ?? node.description ?? existing?.operationSummary ?? existing?.description ?? null,
    createdBy: node.createdBy ?? existing?.createdBy ?? null,
    description: node.description ?? existing?.description ?? null,
    parentId: parentVersionId,
    parentVersionId,
    createdAt,
    operationSeq: node.operationSeq ?? existing?.operationSeq,
    isCurrent,
    tempoBpm: node.tempoBpm ?? existing?.tempoBpm ?? null,
    timeSignatureNum: node.timeSignatureNum ?? existing?.timeSignatureNum ?? 4,
    timeSignatureDen: node.timeSignatureDen ?? existing?.timeSignatureDen ?? 4,
    musicalKey: node.musicalKey ?? existing?.musicalKey ?? null,
    tempoSource: node.tempoSource ?? existing?.tempoSource ?? 'MANUAL',
    keySource: node.keySource ?? existing?.keySource ?? 'MANUAL',
    tracks,
  };
}

function upsertVersionNode(
  versions: DawVersion[],
  node: VersionTreeNodeLike,
  currentVersionId: string,
) {
  const existingIndex = versions.findIndex((version) => version.id === node.id);
  const existing = existingIndex >= 0 ? versions[existingIndex] : undefined;
  const next = normalizeVersionNode(node, currentVersionId, existing);

  if (existingIndex === -1) {
    return [...versions, next];
  }

  return versions.map((version) => (version.id === node.id ? { ...version, ...next } : version));
}

function updateVersionNode(
  versions: DawVersion[],
  versionId: string,
  updater: (version: DawVersion) => DawVersion,
  warnLabel: string,
) {
  const existingIndex = versions.findIndex((version) => version.id === versionId);
  if (existingIndex === -1) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[daw] ${warnLabel}: version ${versionId} not found`);
    }
    return versions;
  }

  return versions.map((version) => (version.id === versionId ? updater(version) : version));
}

function normalizeComments(input: unknown): DemoComment[] {
  if (!Array.isArray(input)) return [];
  return input.map((comment) => {
    const value = comment as CommentOrAnnotationLike;
    return {
      ...value,
      trackId: value.trackId ?? null,
      segmentId: value.segmentId ?? null,
      startTimeMs: value.startTimeMs ?? null,
      endTimeMs: value.endTimeMs ?? null,
      createdBy: value.createdBy ?? value.author?.id ?? '',
      resolved: value.resolved ?? false,
      createdAt: value.createdAt ?? new Date().toISOString(),
      updatedAt: value.updatedAt ?? new Date().toISOString(),
      author: value.author ?? {
        id: value.createdBy ?? '',
        name: null,
        avatarUrl: null,
      },
    };
  }) as DemoComment[];
}

function normalizeAnnotations(input: unknown): DemoAnnotation[] {
  if (!Array.isArray(input)) return [];
  return input.map((annotation) => {
    const value = annotation as CommentOrAnnotationLike;
    return {
      ...value,
      trackId: value.trackId ?? null,
      segmentId: value.segmentId ?? null,
      startTimeMs: value.startTimeMs ?? null,
      endTimeMs: value.endTimeMs ?? null,
      createdBy: value.createdBy ?? value.author?.id ?? '',
      resolved: value.resolved ?? false,
      createdAt: value.createdAt ?? new Date().toISOString(),
      updatedAt: value.updatedAt ?? new Date().toISOString(),
      author: value.author ?? {
        id: value.createdBy ?? '',
        name: null,
        avatarUrl: null,
      },
    };
  }) as DemoAnnotation[];
}

function upsertComment(comments: DemoComment[], nextComment: CommentLike, deleted = false) {
  if (deleted) {
    return comments.filter((comment) => comment.id !== nextComment.id);
  }

  const now = new Date().toISOString();
  const updated: DemoComment = {
    id: nextComment.id,
    demoId: nextComment.demoId,
    trackId: nextComment.trackId,
    segmentId: nextComment.segmentId,
    startTimeMs: nextComment.startTimeMs,
    endTimeMs: nextComment.endTimeMs,
    body: nextComment.body,
    createdBy: nextComment.createdBy,
    resolved: nextComment.resolved,
    createdAt: nextComment.createdAt ?? now,
    updatedAt: nextComment.updatedAt ?? now,
    author:
      nextComment.author ?? {
        id: nextComment.createdBy,
        name: null,
        avatarUrl: null,
      },
  };

  const existingIndex = comments.findIndex((comment) => comment.id === nextComment.id);
  if (existingIndex === -1) {
    return [...comments, updated];
  }
  const existing = comments[existingIndex]!;
  return comments.map((comment) =>
    comment.id === nextComment.id
      ? {
          ...existing,
          ...updated,
          createdAt: existing.createdAt ?? updated.createdAt,
        }
      : comment,
  );
}

function upsertAnnotation(annotations: DemoAnnotation[], nextAnnotation: AnnotationLike, deleted = false) {
  if (deleted) {
    return annotations.filter((annotation) => annotation.id !== nextAnnotation.id);
  }

  const now = new Date().toISOString();
  const updated: DemoAnnotation = {
    id: nextAnnotation.id,
    demoId: nextAnnotation.demoId,
    trackId: nextAnnotation.trackId,
    segmentId: nextAnnotation.segmentId,
    startTimeMs: nextAnnotation.startTimeMs,
    endTimeMs: nextAnnotation.endTimeMs,
    body: nextAnnotation.body,
    createdBy: nextAnnotation.createdBy,
    resolved: nextAnnotation.resolved,
    createdAt: nextAnnotation.createdAt ?? now,
    updatedAt: nextAnnotation.updatedAt ?? now,
    author:
      nextAnnotation.author ?? {
        id: nextAnnotation.createdBy,
        name: null,
        avatarUrl: null,
      },
  };

  const existingIndex = annotations.findIndex((annotation) => annotation.id === nextAnnotation.id);
  if (existingIndex === -1) {
    return [...annotations, updated];
  }
  const existing = annotations[existingIndex]!;
  return annotations.map((annotation) =>
    annotation.id === nextAnnotation.id
      ? {
          ...existing,
          ...updated,
          createdAt: existing.createdAt ?? updated.createdAt,
        }
      : annotation,
  );
}

type RecordingTakeLike = {
  id?: string;
  takeId?: string;
  trackId?: string;
  trackVersionId?: string | null;
  name?: string;
  startOffsetMs?: number;
  durationMs?: number;
  sourceStartMs?: number;
  sourceEndMs?: number;
  timelineStartMs?: number;
  timelineEndMs?: number;
  gainDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  isMuted?: boolean;
  position?: number;
  storageKey?: string;
  assetId?: string | null;
  previewUrl?: string | null;
  recordedTempoBpm?: number | null;
  sourceTempoBpm?: number | null;
  status?: TrackRecordingTake['status'];
  syncStatus?: TrackRecordingTake['syncStatus'];
  error?: string;
  createdAt?: string;
};

function normalizeRecordingTake(
  take: RecordingTakeLike,
  defaults: Partial<TrackRecordingTake> = {},
): TrackRecordingTake {
  const id = take.id ?? take.takeId ?? defaults.id ?? '';
  const trackId = take.trackId ?? defaults.trackId ?? '';
  const startOffsetMs = take.startOffsetMs ?? defaults.startOffsetMs ?? 0;
  const durationMs = take.durationMs ?? defaults.durationMs ?? 0;
  const sourceStartMs = take.sourceStartMs ?? defaults.sourceStartMs ?? 0;
  const sourceEndMs = take.sourceEndMs ?? defaults.sourceEndMs ?? sourceStartMs + durationMs;
  const timelineStartMs = take.timelineStartMs ?? defaults.timelineStartMs ?? startOffsetMs;
  const timelineEndMs = take.timelineEndMs ?? defaults.timelineEndMs ?? timelineStartMs + durationMs;
  return {
    id,
    trackId,
    trackVersionId: take.trackVersionId ?? defaults.trackVersionId ?? null,
    name: take.name ?? defaults.name ?? '',
    startOffsetMs,
    durationMs,
    sourceStartMs,
    sourceEndMs,
    timelineStartMs,
    timelineEndMs,
    gainDb: take.gainDb ?? defaults.gainDb ?? 0,
    fadeInMs: take.fadeInMs ?? defaults.fadeInMs ?? 0,
    fadeOutMs: take.fadeOutMs ?? defaults.fadeOutMs ?? 0,
    isMuted: take.isMuted ?? defaults.isMuted ?? false,
    position: take.position ?? defaults.position ?? 0,
    storageKey: take.storageKey ?? defaults.storageKey ?? '',
    assetId: take.assetId ?? defaults.assetId ?? null,
    previewUrl: take.previewUrl ?? defaults.previewUrl ?? null,
    recordedTempoBpm: take.recordedTempoBpm ?? defaults.recordedTempoBpm ?? null,
    sourceTempoBpm: take.sourceTempoBpm ?? defaults.sourceTempoBpm ?? null,
    status: take.status ?? defaults.status ?? 'complete',
    syncStatus: take.syncStatus ?? defaults.syncStatus ?? 'complete',
    error: take.error ?? defaults.error,
    createdAt: take.createdAt ?? defaults.createdAt ?? new Date().toISOString(),
  };
}

function normalizeRecordingTakesByTrackId(
  input: unknown,
): Record<string, TrackRecordingTake[]> {
  if (!input || typeof input !== 'object') return {};

  const entries = Object.entries(input as Record<string, unknown>).map(([trackId, takes]) => {
    if (!Array.isArray(takes)) {
      return [trackId, [] as TrackRecordingTake[]] as const;
    }

    return [
      trackId,
      takes.map((take) =>
        normalizeRecordingTake(take as RecordingTakeLike, {
          trackId,
          status: 'complete',
          syncStatus: 'complete',
          previewUrl: null,
        }),
      ),
    ] as const;
  });

  return Object.fromEntries(entries);
}

function upsertRecordingTake(
  takesByTrackId: Record<string, TrackRecordingTake[]>,
  trackId: string,
  take: RecordingTakeLike,
) {
  const currentTakes = takesByTrackId[trackId] ?? [];
  const nextTake = normalizeRecordingTake(take, {
    trackId,
    status: 'complete',
    syncStatus: 'complete',
    previewUrl: null,
  });
  const existingIndex = currentTakes.findIndex((entry) => entry.id === nextTake.id);
  if (existingIndex === -1) {
    return {
      ...takesByTrackId,
      [trackId]: [...currentTakes, nextTake],
    };
  }

  return {
    ...takesByTrackId,
    [trackId]: currentTakes.map((entry) => (entry.id === nextTake.id ? { ...entry, ...nextTake } : entry)),
  };
}

function ensureOperationHistory(state: LocalProjectState) {
  state.operationHistory ??= [];
  return state.operationHistory;
}

function upsertOperationHistory(
  state: LocalProjectState,
  entry: ProjectOperationHistoryEntry | null,
) {
  if (!entry) return state.operationHistory ?? [];
  const history = ensureOperationHistory(state);
  const existingIndex = history.findIndex((item) => item.operationId === entry.operationId);
  const nextHistory =
    existingIndex === -1
      ? [...history, entry]
      : history.map((item) => (item.operationId === entry.operationId ? { ...item, ...entry } : item));
  const trimmed = nextHistory.slice(-100);
  state.operationHistory = trimmed;
  return trimmed;
}

function findTrackNameByTrackId(state: LocalProjectState, trackId: string) {
  return findTrackByTrackId(state, trackId)?.trackName ?? null;
}

function findTrackByTrackId(state: LocalProjectState, trackId: string) {
  for (const version of state.versions) {
    const track = version.tracks.find((entry) => entry.trackId === trackId);
    if (track) return track;
  }
  return null;
}

function findTrackByTrackVersionId(state: LocalProjectState, trackVersionId: string) {
  for (const version of state.versions) {
    const track = version.tracks.find((entry) => entry.trackVersionId === trackVersionId);
    if (track) return track;
  }
  return null;
}

function appendOperationHistory(
  state: LocalProjectState,
  operation: DawProjectOperationRecord,
): LocalProjectState {
  const entry = buildOperationHistoryEntry(state, operation);
  if (!entry) return state;

  const nextState = {
    ...state,
    operationHistory: [...(state.operationHistory ?? [])],
  };
  upsertOperationHistory(nextState, entry);
  return nextState;
}

function buildOperationHistoryEntry(
  state: LocalProjectState,
  operation: DawProjectOperationRecord,
): ProjectOperationHistoryEntry | null {
  const currentVersionId = state.currentVersionId ?? null;
  const baseEntry = {
    operationId: operation.id,
    operationType: operation.type,
    versionId: currentVersionId,
    currentVersionId,
    trackId: null,
    takeId: null,
    segmentId: null,
    actorUserId: operation.actorUserId,
    createdAt: operation.createdAt,
  } satisfies Omit<ProjectOperationHistoryEntry, 'summary'>;

  switch (operation.type) {
    case 'TRACK_RENAMED': {
      const payload = operation.payload as { trackId: string; trackName: string };
      return {
        ...baseEntry,
        trackId: payload.trackId,
        summary: `Renamed track to ${payload.trackName.trim()}`,
      };
    }
    case 'TRACK_VERSION_CREATED': {
      const payload = operation.payload as { trackId?: string; track?: { trackId: string; trackName: string } };
      const track = payload.trackId ? findTrackByTrackId(state, payload.trackId) : null;
      return {
        ...baseEntry,
        trackId: payload.trackId ?? payload.track?.trackId ?? null,
        summary: track ? `Created track version for ${track.trackName}` : 'Created track version',
      };
    }
    case 'SEGMENT_SPLIT': {
      const payload = operation.payload as { trackVersionId: string; segmentId?: string };
      const track = findTrackByTrackVersionId(state, payload.trackVersionId);
      return {
        ...baseEntry,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId ?? null,
        summary: track ? `Split clip on ${track.trackName}` : 'Split clip',
      };
    }
    case 'SEGMENT_MOVED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string };
      const track = findTrackByTrackVersionId(state, payload.trackVersionId);
      return {
        ...baseEntry,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId,
        summary: track ? `Moved clip on ${track.trackName}` : 'Moved clip',
      };
    }
    case 'SEGMENT_TRIMMED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string };
      const track = findTrackByTrackVersionId(state, payload.trackVersionId);
      return {
        ...baseEntry,
        trackId: track?.trackId ?? null,
        segmentId: payload.segmentId,
        summary: track ? `Trimmed clip on ${track.trackName}` : 'Trimmed clip',
      };
    }
    case 'CROSSFADE_SET': {
      const payload = operation.payload as { trackVersionId: string; leftSegmentId: string };
      const track = findTrackByTrackVersionId(state, payload.trackVersionId);
      return {
        ...baseEntry,
        trackId: track?.trackId ?? null,
        segmentId: payload.leftSegmentId,
        summary: track ? `Adjusted crossfade on ${track.trackName}` : 'Adjusted crossfade',
      };
    }
    case 'TAKE_ADDED': {
      const payload = operation.payload as { trackId: string; takeId: string; name: string };
      const trackName = findTrackNameByTrackId(state, payload.trackId);
      return {
        ...baseEntry,
        trackId: payload.trackId,
        takeId: payload.takeId,
        summary: trackName ? `Added recording to ${trackName}` : `Added take: ${payload.name}`,
      };
    }
    case 'TAKE_RESTORED': {
      const payload = operation.payload as { trackId: string; takeId: string; operationSummary?: string };
      const trackName = findTrackNameByTrackId(state, payload.trackId);
      return {
        ...baseEntry,
        trackId: payload.trackId,
        takeId: payload.takeId,
        summary:
          trackName ? `Restored recording on ${trackName}` : payload.operationSummary ?? 'Restored recording',
      };
    }
    case 'TAKE_DELETED': {
      const payload = operation.payload as { trackId: string; takeId: string; operationSummary?: string };
      const trackName = findTrackNameByTrackId(state, payload.trackId);
      return {
        ...baseEntry,
        trackId: payload.trackId,
        takeId: payload.takeId,
        summary: trackName ? `Deleted recording from ${trackName}` : payload.operationSummary ?? 'Deleted recording',
      };
    }
    default:
      return null;
  }
}

function removeRecordingTake(
  takesByTrackId: Record<string, TrackRecordingTake[]>,
  trackId: string,
  takeId: string,
) {
  const currentTakes = takesByTrackId[trackId] ?? [];
  const nextTakes = currentTakes.filter((entry) => entry.id !== takeId);
  if (nextTakes.length === currentTakes.length) {
    return takesByTrackId;
  }

  return {
    ...takesByTrackId,
    [trackId]: nextTakes,
  };
}

export function applyTrackOffsetUpdate(
  tracks: DawTrack[],
  trackVersionId: string,
  startOffsetMs: number,
) {
  return tracks.map((track) =>
    track.trackVersionId === trackVersionId ? { ...track, startOffsetMs } : track,
  );
}

export function applyTrackRename(tracks: DawTrack[], trackId: string, trackName: string) {
  return tracks.map((track) => (track.trackId === trackId ? { ...track, trackName } : track));
}

export function applySegmentMove(
  tracks: DawTrack[],
  trackVersionId: string,
  segmentId: string,
  timelineStartMs: number,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              timelineStartMs,
              timelineEndMs: timelineStartMs + segment.durationMs,
            }
          : segment,
      ),
    );
  });
}

function normalizeOperationHistory(input: unknown): ProjectOperationHistoryEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Partial<ProjectOperationHistoryEntry>;
      if (
        typeof value.operationId !== 'string' ||
        typeof value.operationType !== 'string' ||
        typeof value.summary !== 'string' ||
        typeof value.actorUserId !== 'string' ||
        typeof value.createdAt !== 'string'
      ) {
        return null;
      }

      return {
        operationId: value.operationId,
        operationType: value.operationType as ProjectOperationHistoryEntry['operationType'],
        versionId: typeof value.versionId === 'string' ? value.versionId : null,
        currentVersionId: typeof value.currentVersionId === 'string' ? value.currentVersionId : null,
        trackId: typeof value.trackId === 'string' ? value.trackId : null,
        takeId: typeof value.takeId === 'string' ? value.takeId : null,
        segmentId: typeof value.segmentId === 'string' ? value.segmentId : null,
        summary: value.summary,
        actorUserId: value.actorUserId,
        createdAt: value.createdAt,
      } satisfies ProjectOperationHistoryEntry;
    })
    .filter((entry): entry is ProjectOperationHistoryEntry => Boolean(entry));
}

export function applySegmentDelete(tracks: DawTrack[], trackVersionId: string, segmentId: string) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments
        .filter((segment) => segment.id !== segmentId)
        .map((segment, index) => ({
          ...segment,
          position: index,
        })),
    );
  });
}

export function applySegmentTrim(
  tracks: DawTrack[],
  trackVersionId: string,
  segmentId: string,
  nextStartMs: number,
  nextEndMs: number,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              startMs: nextStartMs,
              endMs: nextEndMs,
              sourceStartMs: nextStartMs,
              sourceEndMs: nextEndMs,
              durationMs: nextEndMs - nextStartMs,
              timelineEndMs: segment.timelineStartMs + (nextEndMs - nextStartMs),
            }
          : segment,
      ),
    );
  });
}

export function applySegmentMerge(
  tracks: DawTrack[],
  trackVersionId: string,
  segmentIds: string[],
  mergedSegment: TrackTimelineSegment,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments
        .filter((segment) => !segmentIds.includes(segment.id))
        .concat(mergedSegment)
        .sort((left, right) => left.position - right.position),
    );
  });
}

export function applyCrossfadeSet(
  tracks: DawTrack[],
  trackVersionId: string,
  leftSegmentId: string,
  rightSegmentId: string,
  crossfadeInMs: number,
  crossfadeOutMs: number,
  curve: string | null,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments.map((segment) => {
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
      }),
    );
  });
}

function replaceOrAppendSegment(
  segments: TrackTimelineSegment[],
  nextSegments: TrackTimelineSegment[],
) {
  const ids = new Set(nextSegments.map((segment) => segment.id));
  return segments.filter((segment) => !ids.has(segment.id)).concat(nextSegments);
}

export function createLocalProjectStateFromBootstrap(
  bootstrap: DawProjectBootstrapResponse | null | undefined,
): LocalProjectState {
  const snapshot = (bootstrap?.projectState ?? bootstrap?.latestSnapshot?.snapshot) as
    | {
        versions?: DawVersion[];
        currentVersionId?: string;
        comments?: DemoComment[];
        annotations?: DemoAnnotation[];
        tempoMetadataByTrackVersionId?: Record<string, { recordedTempoBpm?: number | null; sourceTempoBpm?: number | null }>;
        recordingTakesByTrackId?: Record<string, unknown>;
        operationHistory?: ProjectOperationHistoryEntry[];
      }
    | undefined;

  const rawVersions = Array.isArray(snapshot?.versions) ? snapshot?.versions : [];
  const currentVersionId =
    snapshot?.currentVersionId ?? bootstrap?.project.currentVersionId ?? rawVersions[0]?.id ?? '';
  const versions = rawVersions.map((version) => ({
    ...version,
    name: version.name ?? version.label,
    branchName: version.branchName ?? version.name ?? version.label,
    operationSummary: version.operationSummary ?? version.description ?? null,
    parentVersionId: version.parentVersionId ?? version.parentId ?? null,
    isCurrent: version.id === currentVersionId,
  }));
  const tempoMetadataByTrackVersionId = Object.fromEntries(
    Object.entries(snapshot?.tempoMetadataByTrackVersionId ?? {}).map(([trackVersionId, value]) => [
      trackVersionId,
      {
        recordedTempoBpm:
          typeof value?.recordedTempoBpm === 'number' && Number.isFinite(value.recordedTempoBpm)
            ? value.recordedTempoBpm
            : value?.recordedTempoBpm ?? null,
        sourceTempoBpm:
          typeof value?.sourceTempoBpm === 'number' && Number.isFinite(value.sourceTempoBpm)
            ? value.sourceTempoBpm
            : value?.sourceTempoBpm ?? null,
      },
    ]),
  );
  return {
    versions,
    currentVersionId,
    versionTreeUpdatedAt: bootstrap?.latestSnapshot?.createdAt ?? null,
    lastVersionOperationSeq: bootstrap?.latestSnapshot?.operationSeq ?? 0,
    lastSeenOperationSeq: bootstrap?.latestSnapshot?.operationSeq ?? 0,
    comments: normalizeComments(snapshot?.comments),
    annotations: normalizeAnnotations(snapshot?.annotations),
    tempoMetadataByTrackVersionId,
    recordingTakesByTrackId: normalizeRecordingTakesByTrackId(snapshot?.recordingTakesByTrackId),
    operationHistory: normalizeOperationHistory(snapshot?.operationHistory),
  };
}

export function applyAcceptedProjectOperation(
  state: LocalProjectState,
  operation: DawProjectOperationRecord,
): LocalProjectState {
  switch (operation.type) {
    case 'TRACK_RENAMED': {
      const payload = operation.payload as { trackId: string; trackName: string };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackId === payload.trackId ? { ...track, trackName: payload.trackName } : track,
          ),
        })),
      }, operation);
    }
    case 'TRACK_OFFSET_UPDATED': {
      const payload = operation.payload as { trackVersionId: string; startOffsetMs: number };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId === payload.trackVersionId
              ? { ...track, startOffsetMs: payload.startOffsetMs }
              : track,
          ),
        })),
      }, operation);
    }
    case 'SEGMENT_MOVED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string; timelineStartMs: number };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: track.segments.map((segment) =>
                    segment.id === payload.segmentId
                      ? {
                          ...segment,
                          timelineStartMs: payload.timelineStartMs,
                          timelineEndMs: payload.timelineStartMs + segment.durationMs,
                        }
                      : segment,
                  ),
                  },
          ),
        })),
      }, operation);
    }
    case 'SEGMENT_DELETED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: track.segments
                    .filter((segment) => segment.id !== payload.segmentId)
                  .map((segment, index) => ({ ...segment, position: index })),
                },
          ),
        })),
      }, operation);
    }
    case 'SEGMENT_TRIMMED': {
      const payload = operation.payload as {
        trackVersionId: string;
        segmentId: string;
        to: { startMs: number; endMs: number };
      };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: track.segments.map((segment) =>
                    segment.id === payload.segmentId
                      ? {
                          ...segment,
                          startMs: payload.to.startMs,
                          endMs: payload.to.endMs,
                          sourceStartMs: payload.to.startMs,
                          sourceEndMs: payload.to.endMs,
                          durationMs: payload.to.endMs - payload.to.startMs,
                          timelineEndMs:
                            (segment.timelineStartMs ?? track.startOffsetMs + payload.to.startMs) +
                            (payload.to.endMs - payload.to.startMs),
                        }
                      : segment,
                  ),
                },
          ),
        })),
      }, operation);
    }
    case 'SEGMENT_MERGED': {
      const payload = operation.payload as unknown as {
        trackVersionId: string;
        segmentIds: string[];
        mergedSegment: DawSegmentSnapshot;
      };
      return appendOperationHistory({
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: track.segments
                    .filter((segment) => !payload.segmentIds.includes(segment.id))
                    .concat({
                      ...payload.mergedSegment,
                      trackVersionId: payload.trackVersionId,
                      sourceStartMs: payload.mergedSegment.startMs,
                      sourceEndMs: payload.mergedSegment.endMs,
                      timelineStartMs: payload.mergedSegment.timelineStartMs ?? track.startOffsetMs + payload.mergedSegment.startMs,
                      timelineEndMs:
                        (payload.mergedSegment.timelineStartMs ?? track.startOffsetMs + payload.mergedSegment.startMs) +
                        (payload.mergedSegment.endMs - payload.mergedSegment.startMs),
                      durationMs: payload.mergedSegment.endMs - payload.mergedSegment.startMs,
                      isImplicit: false,
                    })
                  .sort((left, right) => left.position - right.position),
                },
          ),
        })),
      }, operation);
    }
    case 'CROSSFADE_SET': {
      const payload = operation.payload as {
        trackVersionId: string;
        leftSegmentId: string;
        rightSegmentId: string;
        crossfadeInMs: number;
        crossfadeOutMs: number;
        curve: string | null;
      };
      return {
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: track.segments.map((segment) => {
                    if (segment.id === payload.leftSegmentId) {
                      return {
                        ...segment,
                        crossfadeOutMs: payload.crossfadeOutMs,
                        crossfadeCurve: payload.curve,
                      };
                    }
                    if (segment.id === payload.rightSegmentId) {
                      return {
                        ...segment,
                        crossfadeInMs: payload.crossfadeInMs,
                        crossfadeCurve: payload.curve,
                      };
                    }
                    return segment;
                  }),
                },
          ),
        })),
      };
    }
    case 'SEGMENT_SPLIT': {
      const payload = operation.payload as unknown as {
        trackVersionId: string;
        sourceSegmentId: string | null;
        leftSegment: DawSegmentSnapshot;
        rightSegment: DawSegmentSnapshot;
      };
      return {
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId !== payload.trackVersionId
              ? track
              : {
                  ...track,
                  segments: replaceOrAppendSegment(track.segments, [
                    {
                      id: payload.leftSegment.id,
                      trackVersionId: payload.trackVersionId,
                      startMs: payload.leftSegment.startMs,
                      endMs: payload.leftSegment.endMs,
                      timelineStartMs:
                        payload.leftSegment.timelineStartMs ?? track.startOffsetMs + payload.leftSegment.startMs,
                      timelineEndMs:
                        (payload.leftSegment.timelineStartMs ?? track.startOffsetMs + payload.leftSegment.startMs) +
                        (payload.leftSegment.endMs - payload.leftSegment.startMs),
                      durationMs: payload.leftSegment.endMs - payload.leftSegment.startMs,
                      sourceStartMs: payload.leftSegment.startMs,
                      sourceEndMs: payload.leftSegment.endMs,
                      gainDb: payload.leftSegment.gainDb,
                      fadeInMs: payload.leftSegment.fadeInMs,
                      fadeOutMs: payload.leftSegment.fadeOutMs,
                      isMuted: payload.leftSegment.isMuted,
                      position: payload.leftSegment.position,
                      isImplicit: false,
                      crossfadeInMs: payload.leftSegment.crossfadeInMs ?? null,
                      crossfadeOutMs: payload.leftSegment.crossfadeOutMs ?? null,
                      crossfadeCurve: payload.leftSegment.crossfadeCurve ?? null,
                    },
                    {
                      id: payload.rightSegment.id,
                      trackVersionId: payload.trackVersionId,
                      startMs: payload.rightSegment.startMs,
                      endMs: payload.rightSegment.endMs,
                      timelineStartMs:
                        payload.rightSegment.timelineStartMs ?? track.startOffsetMs + payload.rightSegment.startMs,
                      timelineEndMs:
                        (payload.rightSegment.timelineStartMs ?? track.startOffsetMs + payload.rightSegment.startMs) +
                        (payload.rightSegment.endMs - payload.rightSegment.startMs),
                      durationMs: payload.rightSegment.endMs - payload.rightSegment.startMs,
                      sourceStartMs: payload.rightSegment.startMs,
                      sourceEndMs: payload.rightSegment.endMs,
                      gainDb: payload.rightSegment.gainDb,
                      fadeInMs: payload.rightSegment.fadeInMs,
                      fadeOutMs: payload.rightSegment.fadeOutMs,
                      isMuted: payload.rightSegment.isMuted,
                      position: payload.rightSegment.position,
                      isImplicit: false,
                      crossfadeInMs: payload.rightSegment.crossfadeInMs ?? null,
                      crossfadeOutMs: payload.rightSegment.crossfadeOutMs ?? null,
                      crossfadeCurve: payload.rightSegment.crossfadeCurve ?? null,
                    },
                  ]).sort((left, right) => left.position - right.position),
                },
          ),
        })),
      };
    }
    case 'TAKE_ADDED': {
      const payload = operation.payload as RecordingTakeLike & { trackId: string; takeId: string };
      return appendOperationHistory({
        ...state,
        recordingTakesByTrackId: upsertRecordingTake(state.recordingTakesByTrackId ?? {}, payload.trackId, {
          ...payload,
          id: payload.takeId,
          status: 'complete',
          syncStatus: 'complete',
          previewUrl: null,
        }),
      }, operation);
    }
    case 'TAKE_RESTORED': {
      const payload = operation.payload as RecordingTakeLike & {
        trackId: string;
        takeId: string;
        restoredAt: string;
        restoredBy: string;
        operationSummary: string;
      };
      return appendOperationHistory({
        ...state,
        recordingTakesByTrackId: upsertRecordingTake(state.recordingTakesByTrackId ?? {}, payload.trackId, {
          ...payload,
          id: payload.takeId,
          status: 'complete',
          syncStatus: 'complete',
          previewUrl: null,
        }),
      }, operation);
    }
    case 'TAKE_DELETED': {
      const payload = operation.payload as { trackId: string; takeId: string };
      return appendOperationHistory({
        ...state,
        recordingTakesByTrackId: removeRecordingTake(
          state.recordingTakesByTrackId ?? {},
          payload.trackId,
          payload.takeId,
        ),
      }, operation);
    }
    case 'VERSION_CREATED':
    case 'VERSION_BRANCH_CREATED':
    case 'VERSION_NODE_ADDED': {
      const payload = operation.payload as {
        version?: VersionTreeNodeLike;
        versionId?: string;
        parentVersionId?: string | null;
        parentId?: string | null;
        branchName?: string | null;
        label?: string | null;
        name?: string | null;
        createdAt?: string;
        createdBy?: string | null;
        operationSummary?: string | null;
      };
      const version = payload.version;
      const versionId = version?.id ?? payload.versionId;
      if (!versionId) {
        return state;
      }
      const versions = upsertVersionNode(
        state.versions,
        {
          id: versionId,
          label: version?.label ?? payload.label ?? payload.name ?? payload.branchName,
          name: version?.name ?? payload.name,
          branchName: version?.branchName ?? payload.branchName,
          operationSummary: version?.operationSummary ?? payload.operationSummary,
          description: version?.description ?? payload.operationSummary ?? null,
          parentVersionId: version?.parentVersionId ?? payload.parentVersionId ?? payload.parentId ?? null,
          parentId: version?.parentId ?? payload.parentId ?? payload.parentVersionId ?? null,
          createdAt: version?.createdAt ?? payload.createdAt,
          createdBy: version?.createdBy ?? payload.createdBy ?? null,
          operationSeq: operation.operationSeq,
          isCurrent: version?.isCurrent,
          tempoBpm: version?.tempoBpm,
          timeSignatureNum: version?.timeSignatureNum,
          timeSignatureDen: version?.timeSignatureDen,
          musicalKey: version?.musicalKey,
          tempoSource: version?.tempoSource,
          keySource: version?.keySource,
          tracks: version?.tracks,
        },
        state.currentVersionId,
      );
      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions,
        currentVersionId:
          version?.isCurrent || operation.type === 'VERSION_CREATED' || operation.type === 'VERSION_BRANCH_CREATED'
            ? versionId
            : state.currentVersionId,
      };
    }
    case 'VERSION_RENAMED': {
      const payload = operation.payload as {
        versionId?: string;
        label?: string;
        name?: string;
        branchName?: string;
      };
      const versionId = payload.versionId;
      if (!versionId) {
        return state;
      }
      const nextLabel = payload.label ?? payload.name ?? payload.branchName ?? '';
      const nextBranchName = payload.branchName ?? nextLabel;
      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions: updateVersionNode(
          state.versions,
          versionId,
          (version) => ({
            ...version,
            label: nextLabel || version.label,
            name: nextLabel || version.name || version.label,
            branchName: nextBranchName || version.branchName || version.label,
            operationSeq: operation.operationSeq,
          }),
          'VERSION_RENAMED',
        ),
      };
    }
    case 'VERSION_SELECTED':
    case 'CURRENT_VERSION_CHANGED':
    case 'VERSION_REVERTED_FROM': {
      const payload = operation.payload as { currentVersionId?: string; previousVersionId?: string | null };
      const currentVersionId = payload.currentVersionId;
      if (!currentVersionId) {
        return state;
      }
      return {
        ...state,
        ...touchVersionTree(state, operation),
        currentVersionId,
        versions: state.versions.map((version) => ({
          ...version,
          isCurrent: version.id === currentVersionId,
          operationSeq: version.id === currentVersionId ? operation.operationSeq : version.operationSeq,
        })),
      };
    }
    case 'TRACK_VERSION_CREATED': {
      const payload = operation.payload as {
        versionId?: string | null;
        track?: DawTrack;
        operationSummary?: string | null;
        version?: VersionTreeNodeLike;
      };
      const versionId = payload.versionId ?? payload.version?.id;
      if (!versionId) {
        return state;
      }
      const updatedVersions = payload.version
        ? upsertVersionNode(
            state.versions,
            {
              ...payload.version,
              id: versionId,
              operationSummary: payload.operationSummary ?? payload.version.operationSummary ?? payload.version.description ?? null,
              description: payload.version.description ?? payload.operationSummary ?? null,
              operationSeq: operation.operationSeq,
            },
            state.currentVersionId,
          )
        : state.versions;
      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions: payload.track
          ? upsertVersionTrack(updatedVersions, versionId, payload.track)
          : payload.operationSummary !== undefined || payload.version
            ? updatedVersions.map((version) =>
                version.id === versionId
                  ? {
                      ...version,
                      operationSummary:
                        payload.operationSummary ?? version.operationSummary ?? version.description ?? null,
                      description:
                        payload.operationSummary ?? version.description ?? version.operationSummary ?? null,
                    }
                  : version,
              )
            : updatedVersions,
      };
    }
    case 'VERSION_PARENT_SET': {
      const payload = operation.payload as { versionId?: string; parentId?: string | null; parentVersionId?: string | null };
      const versionId = payload.versionId;
      if (!versionId) {
        return state;
      }
      const nextParentId = payload.parentId ?? payload.parentVersionId ?? null;
      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions: updateVersionNode(
          state.versions,
          versionId,
          (version) => ({
            ...version,
            parentId: nextParentId,
            parentVersionId: nextParentId,
            operationSeq: operation.operationSeq,
          }),
          'VERSION_PARENT_SET',
        ),
      };
    }
    case 'VERSION_OPERATION_SUMMARY_SET': {
      const payload = operation.payload as { versionId?: string; description?: string | null; operationSummary?: string | null };
      const versionId = payload.versionId;
      if (!versionId) {
        return state;
      }
      const nextSummary = payload.operationSummary ?? payload.description ?? null;
      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions: updateVersionNode(
          state.versions,
          versionId,
          (version) => ({
            ...version,
            description: payload.description ?? version.description,
            operationSummary: nextSummary ?? version.operationSummary ?? version.description ?? null,
            operationSeq: operation.operationSeq,
          }),
          'VERSION_OPERATION_SUMMARY_SET',
        ),
      };
    }
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED': {
      const payload = operation.payload as unknown as CommentLike;
      return {
        ...state,
        comments: upsertComment(state.comments, payload),
      };
    }
    case 'COMMENT_DELETED': {
      const payload = operation.payload as unknown as CommentLike;
      return {
        ...state,
        comments: upsertComment(state.comments, payload, true),
      };
    }
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED': {
      const payload = operation.payload as unknown as AnnotationLike;
      return {
        ...state,
        annotations: upsertAnnotation(state.annotations, payload),
      };
    }
    case 'ANNOTATION_DELETED': {
      const payload = operation.payload as unknown as AnnotationLike;
      return {
        ...state,
        annotations: upsertAnnotation(state.annotations, payload, true),
      };
    }
    case 'VERSION_TIMING_UPDATED': {
      const payload = operation.payload as {
        versionId: string;
        label?: string;
        tempoBpm?: number | null;
        timeSignatureNum?: number;
        timeSignatureDen?: number;
        musicalKey?: string | null;
        tempoSource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
        keySource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
      };

      return {
        ...state,
        ...touchVersionTree(state, operation),
        versions: state.versions.map((version) =>
          version.id === payload.versionId
            ? {
                ...version,
                ...(payload.label !== undefined ? { label: payload.label } : {}),
                ...(payload.label !== undefined ? { name: payload.label, branchName: payload.label } : {}),
                ...(payload.tempoBpm !== undefined ? { tempoBpm: payload.tempoBpm } : {}),
                ...(payload.timeSignatureNum !== undefined ? { timeSignatureNum: payload.timeSignatureNum } : {}),
                ...(payload.timeSignatureDen !== undefined ? { timeSignatureDen: payload.timeSignatureDen } : {}),
                ...(payload.musicalKey !== undefined ? { musicalKey: payload.musicalKey } : {}),
                ...(payload.tempoSource !== undefined ? { tempoSource: payload.tempoSource } : {}),
                ...(payload.keySource !== undefined ? { keySource: payload.keySource } : {}),
              }
            : version,
        ),
      };
    }
    case 'ASSET_ADDED':
    default:
      return state;
  }
}

export function applyAcceptedProjectOperations(
  state: LocalProjectState,
  operations: DawProjectOperationRecord[],
) {
  return operations.reduce((next, operation) => applyAcceptedProjectOperation(next, operation), state);
}

export function applySegmentSplit(
  tracks: DawTrack[],
  trackVersionId: string,
  leftSegment: TrackTimelineSegment,
  rightSegment: TrackTimelineSegment,
  sourceSegmentId: string | null,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments
        .filter((segment) => segment.id !== sourceSegmentId)
        .filter((segment) => segment.id !== leftSegment.id && segment.id !== rightSegment.id)
        .concat([leftSegment, rightSegment])
        .sort((left, right) => left.position - right.position),
    );
  });
}
