import type {
  DawOperationCommitRequest,
  DawSegmentSnapshot,
} from '@git-for-music/server/app/lib/daw/protocol';
import { getCrossfadeCandidateError, getMergeCandidateError } from '@/app/lib/daw/utils/segments';
import type { DawTrack, DawVersion, LocalProjectState, TrackTimelineSegment } from './local-project-state';
import { selectLatestVersionOrNull } from './selectors';

export type RebaseableTimelineEditRequest = DawOperationCommitRequest & {
  clientOperationId: string;
};

type TrackLookupResult = {
  version: DawVersion;
  track: DawTrack;
};

type SegmentLookupResult = TrackLookupResult & {
  segment: TrackTimelineSegment;
};

function getCurrentVersion(state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>) {
  return (
    state.versions.find((version) => version.id === state.currentVersionId) ??
    selectLatestVersionOrNull(state.versions) ??
    state.versions[0] ??
    null
  );
}

function findTrackByTrackId(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  trackId: string,
): TrackLookupResult | null {
  const currentVersion = getCurrentVersion(state);
  const currentTrack = currentVersion?.tracks.find((track) => track.trackId === trackId);
  if (currentTrack && currentVersion) {
    return { version: currentVersion, track: currentTrack };
  }

  for (const version of state.versions) {
    const track = version.tracks.find((candidate) => candidate.trackId === trackId);
    if (track) {
      return { version, track };
    }
  }

  return null;
}

function findTrackByTrackVersionId(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  trackVersionId: string,
): TrackLookupResult | null {
  const currentVersion = getCurrentVersion(state);
  const currentTrack = currentVersion?.tracks.find((track) => track.trackVersionId === trackVersionId);
  if (currentTrack && currentVersion) {
    return { version: currentVersion, track: currentTrack };
  }

  for (const version of state.versions) {
    const track = version.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (track) {
      return { version, track };
    }
  }

  return null;
}

function findSegmentById(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  segmentId: string,
): SegmentLookupResult | null {
  const currentVersion = getCurrentVersion(state);
  const currentTrack = currentVersion?.tracks.find((track) =>
    track.segments.some((segment) => segment.id === segmentId),
  );
  const currentSegment = currentTrack?.segments.find((segment) => segment.id === segmentId);
  if (currentSegment && currentTrack && currentVersion) {
    return {
      version: currentVersion,
      track: currentTrack,
      segment: currentSegment,
    };
  }

  for (const version of state.versions) {
    for (const track of version.tracks) {
      const segment = track.segments.find((candidate) => candidate.id === segmentId);
      if (segment) {
        return {
          version,
          track,
          segment,
        };
      }
    }
  }

  return null;
}

function materializeMergedSegment(
  left: TrackTimelineSegment,
  right: TrackTimelineSegment,
  id: string,
): DawSegmentSnapshot {
  const [first, second] =
    left.timelineStartMs < right.timelineStartMs ||
    (left.timelineStartMs === right.timelineStartMs && left.position <= right.position)
      ? [left, right]
      : [right, left];
  const timelineStartMs = first.timelineStartMs;
  const timelineEndMs = second.timelineEndMs;

  return {
    id,
    trackVersionId: first.trackVersionId,
    startMs: first.startMs,
    endMs: second.endMs,
    timelineStartMs,
    timelineEndMs,
    gainDb: first.gainDb,
    fadeInMs: first.fadeInMs,
    fadeOutMs: first.fadeOutMs,
    isMuted: first.isMuted,
    position: Math.min(first.position, second.position),
    crossfadeInMs: null,
    crossfadeOutMs: null,
    crossfadeCurve: null,
  };
}

function rebaseMoveRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'SEGMENT_MOVED') return request;

  const lookup = findSegmentById(state, request.payload.segmentId);
  if (!lookup) return null;

  return {
    ...request,
    payload: {
      ...request.payload,
      fromTrackVersionId: lookup.track.trackVersionId,
      fromTimelineStartMs: lookup.segment.timelineStartMs,
      fromTimelineEndMs: lookup.segment.timelineEndMs,
    },
  };
}

function rebaseTrimRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'SEGMENT_TRIMMED') return request;

  const lookup = findSegmentById(state, request.payload.segmentId);
  if (!lookup) return null;

  const deltaStart = request.payload.to.startMs - request.payload.from.startMs;
  const deltaEnd = request.payload.to.endMs - request.payload.from.endMs;
  const nextFrom = {
    startMs: lookup.segment.startMs,
    endMs: lookup.segment.endMs,
  };
  const nextTo = {
    startMs: nextFrom.startMs + deltaStart,
    endMs: nextFrom.endMs + deltaEnd,
  };

  if (nextTo.endMs <= nextTo.startMs) return null;

  return {
    ...request,
    payload: {
      ...request.payload,
      trackVersionId: lookup.track.trackVersionId,
      from: nextFrom,
      to: nextTo,
    },
  };
}

function rebaseSplitRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'SEGMENT_SPLIT') return request;

  const lookup = findSegmentById(state, request.payload.segmentId ?? '');
  if (!lookup) return null;

  const splitOffsetMs = request.payload.splitTimeMs - request.payload.segmentStartMs;
  const nextSegmentStartMs = lookup.segment.startMs;
  const nextSegmentEndMs = lookup.segment.endMs;
  const nextSplitTimeMs = nextSegmentStartMs + splitOffsetMs;
  if (nextSplitTimeMs <= nextSegmentStartMs || nextSplitTimeMs >= nextSegmentEndMs) {
    return null;
  }

  return {
    ...request,
    payload: {
      ...request.payload,
      trackVersionId: lookup.track.trackVersionId,
      segmentId: lookup.segment.id,
      segmentStartMs: nextSegmentStartMs,
      segmentEndMs: nextSegmentEndMs,
      splitTimeMs: nextSplitTimeMs,
    },
  };
}

function rebaseFadeRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'SEGMENT_FADE_SET') return request;
  const lookup = findSegmentById(state, request.payload.segmentId);
  if (!lookup) return null;

  return {
    ...request,
    payload: {
      ...request.payload,
      trackVersionId: lookup.track.trackVersionId,
    },
  };
}

function rebaseCrossfadeRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'CROSSFADE_SET') return request;

  const leftLookup = findSegmentById(state, request.payload.leftSegmentId);
  const rightLookup = findSegmentById(state, request.payload.rightSegmentId);
  if (!leftLookup || !rightLookup) return null;
  if (leftLookup.track.trackVersionId !== rightLookup.track.trackVersionId) return null;

  const candidateError = getCrossfadeCandidateError(leftLookup.segment, rightLookup.segment);
  if (candidateError) {
    return null;
  }

  return {
    ...request,
    payload: {
      ...request.payload,
      trackVersionId: leftLookup.track.trackVersionId,
    },
  };
}

function rebaseMergeRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
) {
  if (request.operationType !== 'SEGMENT_MERGED') return request;
  if (!Array.isArray(request.payload.segmentIds) || request.payload.segmentIds.length !== 2) {
    return null;
  }

  const firstLookup = findSegmentById(state, request.payload.segmentIds[0] ?? '');
  const secondLookup = findSegmentById(state, request.payload.segmentIds[1] ?? '');
  if (!firstLookup || !secondLookup) return null;
  if (firstLookup.track.trackVersionId !== secondLookup.track.trackVersionId) return null;

  const candidateError = getMergeCandidateError(firstLookup.segment, secondLookup.segment);
  if (candidateError) {
    return null;
  }

  return {
    ...request,
    payload: {
      ...request.payload,
      trackVersionId: firstLookup.track.trackVersionId,
      mergedSegment: materializeMergedSegment(
        firstLookup.segment,
        secondLookup.segment,
        request.payload.mergedSegment.id,
      ),
    },
  };
}

export function rebaseTimelineEditRequest(
  state: Pick<LocalProjectState, 'versions' | 'currentVersionId'>,
  request: RebaseableTimelineEditRequest,
): RebaseableTimelineEditRequest | null {
  switch (request.operationType) {
    case 'TRACK_RENAMED': {
      const lookup = findTrackByTrackId(state, request.payload.trackId);
      return lookup ? request : null;
    }
    case 'TRACK_REMOVED': {
      const lookup = findTrackByTrackId(state, request.payload.trackId);
      return lookup ? request : null;
    }
    case 'TRACK_OFFSET_UPDATED': {
      const lookup = findTrackByTrackVersionId(state, request.payload.trackVersionId);
      return lookup ? request : null;
    }
    case 'SEGMENT_MOVED':
      return rebaseMoveRequest(state, request);
    case 'SEGMENT_TRIMMED':
      return rebaseTrimRequest(state, request);
    case 'SEGMENT_SPLIT':
      return rebaseSplitRequest(state, request);
    case 'SEGMENT_DELETED': {
      const lookup = findSegmentById(state, request.payload.segmentId);
      return lookup ? request : null;
    }
    case 'SEGMENT_FADE_SET':
      return rebaseFadeRequest(state, request);
    case 'SEGMENT_MERGED':
      return rebaseMergeRequest(state, request);
    case 'CROSSFADE_SET':
      return rebaseCrossfadeRequest(state, request);
    default:
      return request;
  }
}
