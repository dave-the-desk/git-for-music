import type { DemoComment as SharedDemoComment } from '@git-for-music/shared';
import {
  EMPTY_TRACK_MIME_TYPE,
  buildRenderableTrackSegments,
  type TrackTimelineSegment,
} from '@/features/daw/utils/segments';
import type { DawTrack, DawVersion } from './local-project-state';
import type { TemporaryRecordingTrack } from './ui-state';

export function selectVersionOrNull(versions: DawVersion[], versionId: string | null | undefined) {
  if (!versionId) return null;
  return versions.find((version) => version.id === versionId) ?? null;
}

export function selectLatestVersionOrNull(versions: DawVersion[]) {
  if (versions.length === 0) {
    return null;
  }

  return versions.reduce<DawVersion | null>((latest, version) => {
    if (!latest) return version;

    const latestCreatedAt = Date.parse(latest.createdAt);
    const nextCreatedAt = Date.parse(version.createdAt);
    if (Number.isFinite(latestCreatedAt) && Number.isFinite(nextCreatedAt) && nextCreatedAt !== latestCreatedAt) {
      return nextCreatedAt > latestCreatedAt ? version : latest;
    }

    const latestOperationSeq = latest.operationSeq ?? 0;
    const nextOperationSeq = version.operationSeq ?? 0;
    if (nextOperationSeq !== latestOperationSeq) {
      return nextOperationSeq > latestOperationSeq ? version : latest;
    }

    return version.id.localeCompare(latest.id) > 0 ? version : latest;
  }, null);
}

export function selectVersionById(versions: DawVersion[], selectedVersionId: string | null | undefined) {
  return selectVersionOrNull(versions, selectedVersionId) ?? versions.find((version) => version.isCurrent) ?? selectLatestVersionOrNull(versions);
}

export function selectTracks(version: DawVersion | null | undefined) {
  if (!version) return [];
  return [...version.tracks].sort((a, b) => a.trackPosition - b.trackPosition);
}

export function isTrackAudioOccupied(track: DawTrack | null | undefined) {
  if (!track) return false;
  if (track.durationMs !== null && track.durationMs > 0) return true;
  if (typeof track.storageKey === 'string' && track.storageKey.length > 0) return true;
  return track.segments.length > 0;
}

export function isBlankTrack(track: DawTrack | null | undefined) {
  return track?.mimeType === EMPTY_TRACK_MIME_TYPE;
}

export function getTrackDurationMs(
  track: DawTrack,
  durationByTrackVersionId: Record<string, number>,
) {
  return durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0;
}

export function getTrackStartOffsetMs(
  track: DawTrack,
  offsetOverrides: Record<string, number>,
) {
  return offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;
}

export function getDisplayedTrackSegments(
  track: DawTrack,
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>,
) {
  return segmentLayoutOverrides[track.trackVersionId] ?? track.segments;
}

export function getRenderableTrackSegments(input: {
  track: DawTrack;
  offsetOverrides: Record<string, number>;
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>;
  durationByTrackVersionId: Record<string, number>;
}) {
  const displayedSegments = getDisplayedTrackSegments(input.track, input.segmentLayoutOverrides);
  const hasLocalBlankOverride =
    Object.prototype.hasOwnProperty.call(input.segmentLayoutOverrides, input.track.trackVersionId) &&
    displayedSegments.length === 0;

  return buildRenderableTrackSegments({
    trackVersionId: input.track.trackVersionId,
    trackStartOffsetMs: getTrackStartOffsetMs(input.track, input.offsetOverrides),
    segments: displayedSegments,
    fallbackDurationMs: getTrackDurationMs(input.track, input.durationByTrackVersionId),
    allowImplicitSegment: !isBlankTrack(input.track) && !hasLocalBlankOverride,
  });
}

export function selectTotalDurationMs(input: {
  tracks: DawTrack[];
  durationByTrackVersionId: Record<string, number>;
  offsetOverrides: Record<string, number>;
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>;
  temporaryRecordingTrack: TemporaryRecordingTrack | null;
}) {
  const ends = input.tracks.flatMap((track) =>
    getRenderableTrackSegments({
      track,
      offsetOverrides: input.offsetOverrides,
      segmentLayoutOverrides: input.segmentLayoutOverrides,
      durationByTrackVersionId: input.durationByTrackVersionId,
    }).map((segment) => segment.timelineEndMs),
  );
  if (input.temporaryRecordingTrack) {
    ends.push(input.temporaryRecordingTrack.startOffsetMs + input.temporaryRecordingTrack.durationMs);
  }
  return ends.length ? Math.max(...ends) : 0;
}

export function groupCommentsByTrackId(comments: SharedDemoComment[]) {
  return comments.reduce<Record<string, SharedDemoComment[]>>((acc, comment) => {
    if (!comment.trackId) return acc;
    if (!acc[comment.trackId]) acc[comment.trackId] = [];
    acc[comment.trackId]!.push(comment);
    return acc;
  }, {});
}
