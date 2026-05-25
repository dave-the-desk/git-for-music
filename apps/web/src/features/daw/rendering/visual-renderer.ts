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
  recordingTakes: TrackLaneRecordingTakeProjection[];
  recording: RecordingTakeVisualProjection | null;
};

export type TrackLaneRecordingTakeProjection = {
  id: string;
  trackId: string;
  trackVersionId: string | null;
  name: string;
  storageKey: string;
  status: 'preview' | 'uploading' | 'complete' | 'error';
  syncStatus: 'idle' | 'uploading' | 'complete' | 'error';
  leftPx: number;
  widthPx: number;
  hitAreaWidthPx: number;
  waveformWidthPx: number;
  segment: TrackTimelineSegment;
};

export type RecordingTakeVisualProjection = TemporaryRecordingTrack & {
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
  recordingTakesByTrackId?: Record<string, Array<{
    id: string;
    trackId: string;
    trackVersionId: string | null;
    name: string;
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
    storageKey: string;
    assetId: string | null;
    previewUrl: string | null;
    recordedTempoBpm: number | null;
    sourceTempoBpm: number | null;
    status: 'preview' | 'uploading' | 'complete' | 'error';
    syncStatus: 'idle' | 'uploading' | 'complete' | 'error';
    error?: string;
    createdAt: string;
  }>>;
  waveformCache?: WaveformCache;
  minimumWidthPx?: number;
};

export function buildDawVisualProjection(input: BuildDawVisualProjectionInput): DawVisualProjection {
  const trackLanesByTrackVersionId: Record<string, TrackLaneVisualProjection> = {};
  const splitHoverLeftPxByTrackVersionId: Record<string, number> = {};
  const recordingTrackEndPx = input.temporaryRecordingTrack
    ? msToPx(input.temporaryRecordingTrack.startOffsetMs + input.temporaryRecordingTrack.durationMs)
    : null;
  const recordingProjection: RecordingTakeVisualProjection | null = input.temporaryRecordingTrack
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

    const recordingTakes = [...(input.recordingTakesByTrackId?.[track.trackId] ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((take, index) => {
      const sourceStartMs = Math.max(0, take.sourceStartMs ?? 0);
      const sourceEndMs = Math.max(sourceStartMs, take.sourceEndMs ?? sourceStartMs + Math.max(0, take.durationMs));
      const timelineStartMs = Math.max(0, take.timelineStartMs ?? take.startOffsetMs);
      const timelineEndMs = Math.max(
        timelineStartMs,
        take.timelineEndMs ?? timelineStartMs + Math.max(0, take.durationMs),
      );
      const durationMs = Math.max(0, timelineEndMs - timelineStartMs);
      const segment: TrackTimelineSegment = {
        id: take.id,
        trackVersionId: track.trackVersionId,
        sourceStartMs,
        sourceEndMs,
        timelineStartMs,
        timelineEndMs,
        durationMs,
        startMs: sourceStartMs,
        endMs: sourceEndMs,
        gainDb: take.gainDb ?? 0,
        fadeInMs: take.fadeInMs ?? 0,
        fadeOutMs: take.fadeOutMs ?? 0,
        isMuted: take.isMuted ?? false,
        position: take.position ?? index,
        isImplicit: false,
      };

      maxEndPx = Math.max(maxEndPx, msToPx(timelineEndMs));

        return {
          id: take.id,
          trackId: take.trackId,
          trackVersionId: take.trackVersionId,
          name: take.name,
        storageKey: take.storageKey,
        status: take.status,
        syncStatus: take.syncStatus,
        leftPx: msToPx(timelineStartMs),
        widthPx: Math.max(msToPx(durationMs), 12),
        hitAreaWidthPx: Math.max(msToPx(durationMs), 120),
          waveformWidthPx: Math.max(msToPx(durationMs), 12),
          segment,
        };
      });

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
      recordingTakes,
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
