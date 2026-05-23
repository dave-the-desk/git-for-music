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
  isDerived: boolean;
  operationType: 'ORIGINAL' | 'TIME_STRETCH';
  parentTrackVersionId: string | null;
  segments: TrackTimelineSegment[];
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

export type LocalProjectState = {
  versions: DawVersion[];
  currentVersionId: string;
  comments: DemoComment[];
  annotations: DemoAnnotation[];
};
