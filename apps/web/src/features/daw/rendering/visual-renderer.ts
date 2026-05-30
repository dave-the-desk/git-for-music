import type { TrackTimelineSegment } from '@/features/daw/state/local-project-state';
import type { TemporaryRecordingTrack } from '@/features/daw/state/ui-state';
import { buildRenderableTrackSegments, EMPTY_TRACK_MIME_TYPE, type SegmentLike } from '@/features/daw/utils/segments';

export const PX_PER_SECOND = 80;
export const PX_PER_MS = PX_PER_SECOND / 1000;

export type WaveformCacheEntry = {
  peaks: Array<{ timeMs: number; min: number; max: number }>;
  durationMs: number;
};

export type WaveformCache = Map<string, WaveformCacheEntry>;

export function msToPx(ms: number) {
  return ms * PX_PER_MS;
}

export function pxToMs(px: number) {
  return px / PX_PER_MS;
}

export type TrackLaneVisualSegment = TrackTimelineSegment & {
  leftPx: number;
  widthPx: number;
  sourceOffsetPx: number;
  sourceWidthPx: number;
  crossfadeInWidthPx: number;
  crossfadeOutWidthPx: number;
  waveform: WaveformCacheEntry | null;
};

export type TrackLaneVisualProjection = {
  trackId: string;
  trackVersionId: string;
  trackName: string;
  startOffsetMs: number;
  leftPx: number;
  widthPx: number;
  isMuted: boolean;
  segments: TrackLaneVisualSegment[];
  recording: RecordingPreviewVisualProjection | null;
};

export type RecordingPreviewVisualProjection = TemporaryRecordingTrack & {
  leftPx: number;
  widthPx: number;
  hitAreaWidthPx: number;
  waveformWidthPx: number;
};

export type DawVisualProjection = {
  pixelsPerSecond: number;
  pixelsPerMs: number;
  totalTimelineWidthPx: number;
  currentTimeLeftPx: number;
  splitHoverLeftPxByTrackVersionId: Record<string, number>;
  recordingTrackEndPx: number | null;
  trackLanesByTrackVersionId: Record<string, TrackLaneVisualProjection>;
};

export type BuildDawVisualProjectionInput = {
  tracks: Array<{
    trackId: string;
    trackName: string;
    trackVersionId: string;
    storageKey: string;
    mimeType?: string | null;
    startOffsetMs: number;
    durationMs: number | null;
    isMuted: boolean;
    segments: TrackTimelineSegment[];
  }>;
  currentTimeMs: number;
  splitHover: { trackVersionId: string; timeMs: number } | null;
  durationByTrackVersionId: Record<string, number>;
  offsetOverrides: Record<string, number>;
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>;
  temporaryRecordingTrack: TemporaryRecordingTrack | null;
  waveformCache?: WaveformCache;
  minimumWidthPx?: number;
};

export function buildDawVisualProjection(input: BuildDawVisualProjectionInput): DawVisualProjection {
  const trackLanesByTrackVersionId: Record<string, TrackLaneVisualProjection> = {};
  const splitHoverLeftPxByTrackVersionId: Record<string, number> = {};
  const recordingTrackEndPx = input.temporaryRecordingTrack
    ? msToPx(input.temporaryRecordingTrack.startOffsetMs + input.temporaryRecordingTrack.durationMs)
    : null;
  const recordingProjection: RecordingPreviewVisualProjection | null = input.temporaryRecordingTrack
    ? {
        ...input.temporaryRecordingTrack,
        leftPx: msToPx(input.temporaryRecordingTrack.startOffsetMs),
        widthPx: Math.max(msToPx(input.temporaryRecordingTrack.durationMs), 8),
        hitAreaWidthPx: Math.max(msToPx(input.temporaryRecordingTrack.durationMs), 120),
        waveformWidthPx: Math.max(msToPx(input.temporaryRecordingTrack.durationMs), 8),
      }
    : null;

  let maxEndPx = input.minimumWidthPx ?? 400;
  const waveformCache = input.waveformCache ?? new Map<string, WaveformCacheEntry>();

  for (const track of input.tracks) {
    const trackStartOffsetMs = input.offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;
    const durationMs =
      input.durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0;
    const displayedSegments =
      input.segmentLayoutOverrides[track.trackVersionId] ?? track.segments;
    const renderableSegments = buildRenderableTrackSegments({
      trackVersionId: track.trackVersionId,
      trackStartOffsetMs,
      segments: displayedSegments as Array<{ id: string } & SegmentLike>,
      fallbackDurationMs: durationMs,
      allowImplicitSegment: track.mimeType !== EMPTY_TRACK_MIME_TYPE,
    });

    const segments: TrackLaneVisualSegment[] = renderableSegments.map((segment) => {
      const leftPx = msToPx(segment.timelineStartMs);
      const widthPx = Math.max(12, msToPx(segment.durationMs));
      const sourceOffsetPx = msToPx(segment.sourceStartMs);
      const sourceWidthPx = Math.max(0, msToPx(segment.sourceEndMs - segment.sourceStartMs));
      const waveform = waveformCache.get(segment.id) ?? waveformCache.get(track.trackVersionId) ?? null;

      return {
        ...segment,
        leftPx,
        widthPx,
        sourceOffsetPx,
        sourceWidthPx,
        crossfadeInWidthPx: msToPx(segment.crossfadeInMs ?? 0),
        crossfadeOutWidthPx: msToPx(segment.crossfadeOutMs ?? 0),
        waveform,
      };
    });

    const leftPx = msToPx(trackStartOffsetMs);
    const lastSegmentEnd = segments.reduce((max, segment) => Math.max(max, segment.leftPx + segment.widthPx), leftPx);
    const widthPx = Math.max(msToPx(durationMs), lastSegmentEnd - leftPx);

    maxEndPx = Math.max(maxEndPx, lastSegmentEnd);

    trackLanesByTrackVersionId[track.trackVersionId] = {
      trackId: track.trackId,
      trackVersionId: track.trackVersionId,
      trackName: track.trackName,
      startOffsetMs: trackStartOffsetMs,
      leftPx,
      widthPx,
      isMuted: track.isMuted,
      segments,
      recording:
        recordingProjection &&
        (track.trackId === recordingProjection.targetTrackId ||
          track.trackVersionId === recordingProjection.targetTrackVersionId)
          ? recordingProjection
          : null,
    };

    if (input.splitHover?.trackVersionId === track.trackVersionId) {
      splitHoverLeftPxByTrackVersionId[track.trackVersionId] = msToPx(input.splitHover.timeMs);
    }
  }

  return {
    pixelsPerSecond: PX_PER_SECOND,
    pixelsPerMs: PX_PER_MS,
    totalTimelineWidthPx: Math.max(maxEndPx, recordingTrackEndPx ?? 0, input.minimumWidthPx ?? 400),
    currentTimeLeftPx: msToPx(input.currentTimeMs),
    splitHoverLeftPxByTrackVersionId,
    recordingTrackEndPx,
    trackLanesByTrackVersionId,
  };
}
