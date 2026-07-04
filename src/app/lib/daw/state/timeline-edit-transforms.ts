import type { AcceptedDawProjectOperation, DawSegmentSnapshot } from '@git-for-music/server/app/lib/daw/protocol';
import type { DawTrack, TrackTimelineSegment } from './local-project-state';

type TimelineSegmentSnapshot = Pick<
  DawSegmentSnapshot,
  | 'id'
  | 'startMs'
  | 'endMs'
  | 'timelineStartMs'
  | 'timelineEndMs'
  | 'gainDb'
  | 'fadeInMs'
  | 'fadeOutMs'
  | 'isMuted'
  | 'position'
  | 'crossfadeInMs'
  | 'crossfadeOutMs'
  | 'crossfadeCurve'
>;

export type TimelineEditOperation = Extract<
  AcceptedDawProjectOperation,
  | { type: 'TRACK_RENAMED' }
  | { type: 'TRACK_OFFSET_UPDATED' }
  | { type: 'SEGMENT_SPLIT' }
  | { type: 'SEGMENT_MOVED' }
  | { type: 'SEGMENT_DELETED' }
  | { type: 'SEGMENT_TRIMMED' }
  | { type: 'SEGMENT_MERGED' }
  | { type: 'SEGMENT_FADE_SET' }
  | { type: 'CROSSFADE_SET' }
>;

function updateSegments(
  track: DawTrack,
  updater: (segments: TrackTimelineSegment[]) => TrackTimelineSegment[],
) {
  return {
    ...track,
    segments: updater(track.segments),
  };
}

function normalizeTrackSegments(segments: TrackTimelineSegment[]) {
  return segments.map((segment, index) => ({
    ...segment,
    position: index,
  }));
}

function applyToTrackSegments(
  tracks: DawTrack[],
  trackVersionId: string,
  updater: (track: DawTrack) => DawTrack,
) {
  return tracks.map((track) => (track.trackVersionId === trackVersionId ? updater(track) : track));
}

function materializeTimelineSegment(
  trackVersionId: string,
  trackStartOffsetMs: number,
  segment: TimelineSegmentSnapshot,
): TrackTimelineSegment {
  const timelineStartMs = segment.timelineStartMs ?? trackStartOffsetMs + segment.startMs;
  const durationMs = segment.endMs - segment.startMs;

  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
    timelineEndMs: segment.timelineEndMs ?? timelineStartMs + durationMs,
    durationMs,
    sourceStartMs: segment.startMs,
    sourceEndMs: segment.endMs,
    gainDb: segment.gainDb,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    isMuted: segment.isMuted,
    position: segment.position,
    isImplicit: false,
    crossfadeInMs: segment.crossfadeInMs ?? null,
    crossfadeOutMs: segment.crossfadeOutMs ?? null,
    crossfadeCurve: segment.crossfadeCurve ?? null,
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
  const sourceTrackIndex = tracks.findIndex((track) => track.trackVersionId === payload.fromTrackVersionId);
  const targetTrackIndex = tracks.findIndex((track) => track.trackVersionId === payload.toTrackVersionId);

  if (targetTrackIndex === -1) {
    return tracks;
  }

  const sourceTrack = sourceTrackIndex >= 0 ? tracks[sourceTrackIndex] : null;
  const targetTrack = tracks[targetTrackIndex] ?? null;
  if (!targetTrack) {
    return tracks;
  }

  const occurrences = tracks.flatMap((track) =>
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

  if (!existingSegment) {
    return tracks;
  }

  if (
    occurrences.length === 1 &&
    targetSegment &&
    targetSegment.trackVersionId === payload.toTrackVersionId &&
    targetSegment.timelineStartMs === payload.toTimelineStartMs &&
    targetSegment.timelineEndMs === payload.toTimelineEndMs
  ) {
    return tracks;
  }

  const cleanedTracks = tracks.map((track) => ({
    ...track,
    segments: normalizeTrackSegments(track.segments.filter((segment) => segment.id !== payload.segmentId)),
  }));
  const cleanedTargetTrack = cleanedTracks.find((track) => track.trackVersionId === payload.toTrackVersionId);
  if (!cleanedTargetTrack) {
    return tracks;
  }

  const insertionIndex =
    payload.fromTrackVersionId === payload.toTrackVersionId
      ? Math.min(existingSegment.position, cleanedTargetTrack.segments.length)
      : cleanedTargetTrack.segments.length;

  const movedSegment: TrackTimelineSegment = {
    ...existingSegment,
    trackVersionId: payload.toTrackVersionId,
    timelineStartMs: payload.toTimelineStartMs,
    timelineEndMs: payload.toTimelineEndMs,
    position: insertionIndex,
  };

  const nextTargetSegments = normalizeTrackSegments(
    [
      ...cleanedTargetTrack.segments.slice(0, insertionIndex),
      movedSegment,
      ...cleanedTargetTrack.segments.slice(insertionIndex),
    ].map((segment) => ({
      ...segment,
      trackVersionId: payload.toTrackVersionId,
    })),
  );

  return cleanedTracks.map((track) =>
    track.trackVersionId === payload.toTrackVersionId
      ? {
          ...track,
          segments: nextTargetSegments,
        }
      : track,
  );
}

export function applySegmentMoveLegacy(
  tracks: DawTrack[],
  trackVersionId: string,
  segmentId: string,
  timelineStartMs: number,
) {
  const track = tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
  const segment = track?.segments.find((candidate) => candidate.id === segmentId);
  if (!track || !segment) return tracks;

  return applySegmentMove(tracks, {
    segmentId,
    fromTrackVersionId: trackVersionId,
    toTrackVersionId: trackVersionId,
    fromTimelineStartMs: segment.timelineStartMs,
    fromTimelineEndMs: segment.timelineEndMs,
    toTimelineStartMs: timelineStartMs,
    toTimelineEndMs: timelineStartMs + (segment.timelineEndMs - segment.timelineStartMs),
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
  mergedSegment: TimelineSegmentSnapshot,
) {
  return applyToTrackSegments(tracks, trackVersionId, (track) =>
    updateSegments(track, (segments) =>
      segments
        .filter((segment) => segment.id !== mergedSegment.id)
        .filter((segment) => !segmentIds.includes(segment.id))
        .concat({
          ...materializeTimelineSegment(trackVersionId, track.startOffsetMs, mergedSegment),
          id: mergedSegment.id,
        })
        .sort((left, right) => left.position - right.position),
    ),
  );
}

export function applySegmentFadeSet(
  tracks: DawTrack[],
  trackVersionId: string,
  segmentId: string,
  fadeInMs: number,
  fadeOutMs: number,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              fadeInMs,
              fadeOutMs,
            }
          : segment,
      ),
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

export function applySegmentSplit(
  tracks: DawTrack[],
  trackVersionId: string,
  leftSegment: TimelineSegmentSnapshot,
  rightSegment: TimelineSegmentSnapshot,
  sourceSegmentId: string | null,
) {
  return tracks.map((track) => {
    if (track.trackVersionId !== trackVersionId) return track;
    return updateSegments(track, (segments) =>
      segments
        .filter((segment) => segment.id !== sourceSegmentId)
        .filter((segment) => segment.id !== leftSegment.id && segment.id !== rightSegment.id)
        .concat([
          materializeTimelineSegment(trackVersionId, track.startOffsetMs, leftSegment),
          materializeTimelineSegment(trackVersionId, track.startOffsetMs, rightSegment),
        ])
        .sort((left, right) => left.position - right.position),
    );
  });
}

export function applyTimelineEditOperation(tracks: DawTrack[], operation: TimelineEditOperation) {
  switch (operation.type) {
    case 'TRACK_RENAMED':
      return applyTrackRename(tracks, operation.payload.trackId, operation.payload.trackName);
    case 'TRACK_OFFSET_UPDATED':
      return applyTrackOffsetUpdate(tracks, operation.payload.trackVersionId, operation.payload.startOffsetMs);
    case 'SEGMENT_SPLIT':
      return applySegmentSplit(
        tracks,
        operation.payload.trackVersionId,
        operation.payload.leftSegment,
        operation.payload.rightSegment,
        operation.payload.sourceSegmentId ?? null,
      );
    case 'SEGMENT_MOVED':
      return applySegmentMove(tracks, operation.payload);
    case 'SEGMENT_DELETED':
      return applySegmentDelete(tracks, operation.payload.trackVersionId, operation.payload.segmentId);
    case 'SEGMENT_TRIMMED':
      return applySegmentTrim(
        tracks,
        operation.payload.trackVersionId,
        operation.payload.segmentId,
        operation.payload.to.startMs,
        operation.payload.to.endMs,
      );
    case 'SEGMENT_MERGED':
      return applySegmentMerge(
        tracks,
        operation.payload.trackVersionId,
        operation.payload.segmentIds,
        operation.payload.mergedSegment,
      );
    case 'SEGMENT_FADE_SET':
      return applySegmentFadeSet(
        tracks,
        operation.payload.trackVersionId,
        operation.payload.segmentId,
        operation.payload.fadeInMs,
        operation.payload.fadeOutMs,
      );
    case 'CROSSFADE_SET':
      return applyCrossfadeSet(
        tracks,
        operation.payload.trackVersionId,
        operation.payload.leftSegmentId,
        operation.payload.rightSegmentId,
        operation.payload.crossfadeInMs,
        operation.payload.crossfadeOutMs,
        operation.payload.curve,
      );
  }
}
