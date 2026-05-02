import type { DemoTimingMetadata, SnapResolution, TimingSource } from '@git-for-music/shared';

export const TRACK_LABEL_WIDTH = 160;
export const TRACK_HEIGHT = 72;
export const TICK_INTERVAL_MS = 16;
export const DEFAULT_SNAP: SnapResolution = 'beat';
export const DEFAULT_TIME_SIGNATURE = { num: 4, den: 4 } as const;

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

export type TrackTimelineSegment = {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  isImplicit: boolean;
};

export type TemporaryRecordingTrack = {
  id: string;
  name: string;
  startOffsetMs: number;
  durationMs: number;
  status: 'recording' | 'preview' | 'uploading' | 'error';
  blob?: Blob;
  previewUrl?: string;
  error?: string;
};

export type RenameState = {
  trackId: string;
  value: string;
  saving: boolean;
  error: string | null;
};

export type CommentComposerState = {
  trackId: string;
  open: boolean;
  value: string;
  submitting: boolean;
  error: string | null;
};

export type TimingFormState = {
  tempoBpm: string;
  timeSignatureNum: string;
  timeSignatureDen: string;
  musicalKey: string;
  saving: boolean;
  error: string | null;
};

export type UploadModalState = {
  open: boolean;
  file: File | null;
  name: string;
  choice: 'keepProjectTempo' | 'updateProjectTempoFromUpload' | 'uploadUnchanged';
};

export type TempoAnalysisPromptState = {
  open: boolean;
  jobId: string;
  trackVersionId: string;
  trackName: string;
  tempoBpm: number;
  confidence: number;
  beatTimes: number[];
  applying: boolean;
  error: string | null;
};

export function formatTimeMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function timingFormFromVersion(version: DawVersion | undefined): TimingFormState {
  return {
    tempoBpm: version?.tempoBpm?.toString() ?? '',
    timeSignatureNum: version?.timeSignatureNum?.toString() ?? DEFAULT_TIME_SIGNATURE.num.toString(),
    timeSignatureDen: version?.timeSignatureDen?.toString() ?? DEFAULT_TIME_SIGNATURE.den.toString(),
    musicalKey: version?.musicalKey ?? '',
    saving: false,
    error: null,
  };
}

export type SelectedTiming = DemoTimingMetadata | null;
