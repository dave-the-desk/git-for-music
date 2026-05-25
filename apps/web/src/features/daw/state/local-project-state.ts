import type { DemoAnnotation, DemoComment, TimingSource } from '@git-for-music/shared';

export type TrackTimelineSegment = {
  id: string;
  trackVersionId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
  startMs: number;
  endMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  isImplicit: boolean;
  crossfadeInMs?: number | null;
  crossfadeOutMs?: number | null;
  crossfadeCurve?: string | null;
};

export type DawTrack = {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  startOffsetMs: number;
  recordedTempoBpm?: number | null;
  sourceTempoBpm?: number | null;
  isDerived: boolean;
  operationType: 'ORIGINAL' | 'TIME_STRETCH';
  parentTrackVersionId: string | null;
  segments: TrackTimelineSegment[];
};

export type TrackRecordingTake = {
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
};

export type DawVersion = {
  id: string;
  label: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  isCurrent: boolean;
  tempoBpm: number | null;
  timeSignatureNum: number;
  timeSignatureDen: number;
  musicalKey: string | null;
  tempoSource: TimingSource;
  keySource: TimingSource;
  tracks: DawTrack[];
};

export type TempoMetadataEntry = {
  recordedTempoBpm: number | null;
  sourceTempoBpm: number | null;
};

export type LocalProjectState = {
  versions: DawVersion[];
  currentVersionId: string;
  comments: DemoComment[];
  annotations: DemoAnnotation[];
  tempoMetadataByTrackVersionId: Record<string, TempoMetadataEntry>;
  recordingTakesByTrackId: Record<string, TrackRecordingTake[]>;
};
