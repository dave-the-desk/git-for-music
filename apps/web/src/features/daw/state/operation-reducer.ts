import type { DemoAnnotation, DemoComment } from '@git-for-music/shared';
import type {
  DawTrack,
  DawVersion,
  LocalProjectState,
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
): LocalProjectState | null {
  const snapshot = (bootstrap?.projectState ?? bootstrap?.latestSnapshot?.snapshot) as
    | {
        versions?: DawVersion[];
        currentVersionId?: string;
        comments?: DemoComment[];
        annotations?: DemoAnnotation[];
        tempoMetadataByTrackVersionId?: Record<string, { recordedTempoBpm?: number | null; sourceTempoBpm?: number | null }>;
      }
    | undefined;

  if (!snapshot?.versions || !snapshot.currentVersionId) return null;
  const tempoMetadataByTrackVersionId = Object.fromEntries(
    Object.entries(snapshot.tempoMetadataByTrackVersionId ?? {}).map(([trackVersionId, value]) => [
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
    versions: snapshot.versions,
    currentVersionId: snapshot.currentVersionId,
    comments: normalizeComments(snapshot.comments),
    annotations: normalizeAnnotations(snapshot.annotations),
    tempoMetadataByTrackVersionId,
    recordingTakesByTrackId: {},
  };
}

export function applyAcceptedProjectOperation(
  state: LocalProjectState,
  operation: DawProjectOperationRecord,
): LocalProjectState {
  switch (operation.type) {
    case 'TRACK_RENAMED': {
      const payload = operation.payload as { trackId: string; trackName: string };
      return {
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackId === payload.trackId ? { ...track, trackName: payload.trackName } : track,
          ),
        })),
      };
    }
    case 'TRACK_OFFSET_UPDATED': {
      const payload = operation.payload as { trackVersionId: string; startOffsetMs: number };
      return {
        ...state,
        versions: state.versions.map((version) => ({
          ...version,
          tracks: version.tracks.map((track) =>
            track.trackVersionId === payload.trackVersionId
              ? { ...track, startOffsetMs: payload.startOffsetMs }
              : track,
          ),
        })),
      };
    }
    case 'SEGMENT_MOVED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string; timelineStartMs: number };
      return {
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
      };
    }
    case 'SEGMENT_DELETED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string };
      return {
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
      };
    }
    case 'SEGMENT_TRIMMED': {
      const payload = operation.payload as {
        trackVersionId: string;
        segmentId: string;
        to: { startMs: number; endMs: number };
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
      };
    }
    case 'SEGMENT_MERGED': {
      const payload = operation.payload as unknown as {
        trackVersionId: string;
        segmentIds: string[];
        mergedSegment: DawSegmentSnapshot;
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
      };
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
    case 'ASSET_ADDED':
    case 'VERSION_TIMING_UPDATED':
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
