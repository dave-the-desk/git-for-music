import type { DemoTimingMetadata, SnapResolution } from '@git-for-music/shared';
import { DEFAULT_DEMO_TEMPO_BPM, normalizeTempoBpm } from '@/app/lib/daw/utils/timing';

export const TRACK_LABEL_WIDTH = 160;
export const TRACK_HEIGHT = 72;
export const TICK_INTERVAL_MS = 16;
export const DEFAULT_SNAP: SnapResolution = 'beat';
export const DEFAULT_TIME_SIGNATURE = { num: 4, den: 4 } as const;

export type WaveformPeak = {
  timeMs: number;
  min: number;
  max: number;
};

export type TemporaryRecordingTrack = {
  id: string;
  name: string;
  targetTrackId: string;
  targetTrackVersionId: string;
  targetTrackName: string;
  startOffsetMs: number;
  startedAtPlayheadMs: number;
  durationMs: number;
  recordedTempoBpm: number;
  sourceTempoBpm: number;
  status: 'recording' | 'preview' | 'uploading' | 'error';
  syncStatus: 'idle' | 'uploading' | 'complete' | 'error';
  blob?: Blob;
  previewUrl?: string;
  peaks?: WaveformPeak[];
  error?: string;
  serverAssetId?: string | null;
  serverTrackVersionId?: string | null;
  serverDemoVersionId?: string | null;
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

export type LocalTempoState = {
  localTempoBpm: string;
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

export type SelectedTiming = DemoTimingMetadata | null;

export function localTempoStateFromTempo(tempoBpm?: number | null): LocalTempoState {
  return {
    localTempoBpm: normalizeTempoBpm(tempoBpm, DEFAULT_DEMO_TEMPO_BPM).toString(),
  };
}

export function timingFormFromVersion(version: {
  tempoBpm?: number | null;
  timeSignatureNum?: number;
  timeSignatureDen?: number;
  musicalKey?: string | null;
} | undefined) {
  return {
    tempoBpm: version?.tempoBpm?.toString() ?? '',
    timeSignatureNum: version?.timeSignatureNum?.toString() ?? DEFAULT_TIME_SIGNATURE.num.toString(),
    timeSignatureDen: version?.timeSignatureDen?.toString() ?? DEFAULT_TIME_SIGNATURE.den.toString(),
    musicalKey: version?.musicalKey ?? '',
    saving: false,
    error: null,
  } satisfies TimingFormState;
}
