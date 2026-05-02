// Enums mirroring Prisma schema — kept in sync manually until codegen is wired up.

export type GroupMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type ProcessingJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export type ProcessingJobType =
  | 'WAVEFORM'
  | 'TRANSCODE'
  | 'NORMALIZE'
  | 'STEM_SPLIT'
  | 'TEMPO_ANALYSIS'
  | 'KEY_ANALYSIS'
  | 'TIME_STRETCH_TO_PROJECT'
  | 'PROJECT_RETEMPO_FROM_TRACK';

export type TimingSource = 'MANUAL' | 'ANALYZED' | 'IMPORTED';

export interface TimeSignature {
  num: number;
  den: number;
}

export interface DemoTimingMetadata {
  tempoBpm: number | null;
  timeSignature: TimeSignature;
  musicalKey: string | null;
  tempoSource: TimingSource;
  keySource: TimingSource;
}

export type SnapResolution = 'off' | 'bar' | 'beat' | 'halfBeat' | 'quarterBeat';

export type UploadTimingChoice =
  | 'keepProjectTempo'
  | 'updateProjectTempoFromUpload'
  | 'uploadUnchanged';

export interface TempoAnalysisJobPayload {
  demoId: string;
  demoVersionId?: string;
  trackVersionId: string;
  updateDemoTiming?: boolean;
}

export interface KeyAnalysisJobPayload {
  demoId: string;
  demoVersionId?: string;
  trackVersionId: string;
  updateDemoTiming?: boolean;
}

export interface TimeStretchToProjectJobPayload {
  demoId: string;
  demoVersionId: string;
  trackVersionId: string;
  sourceTempoBpm?: number | null;
  targetTempoBpm?: number | null;
}

export interface ProjectRetimeFromTrackJobPayload {
  demoId: string;
  demoVersionId: string;
  trackVersionId: string;
}

export type ProcessingJobPayload =
  | TempoAnalysisJobPayload
  | KeyAnalysisJobPayload
  | TimeStretchToProjectJobPayload
  | ProjectRetimeFromTrackJobPayload
  | Record<string, unknown>;

export * from './storage';
export * from './queue';

// ─── API request shapes ───────────────────────────────────────────────────────

export interface CreateDemoRequest {
  projectId: string;
  name: string;
  description?: string;
}

export interface CreateVersionRequest {
  demoId: string;
  label: string;
  description?: string;
  parentId?: string;
  sourceVersionId?: string;
}

export interface UpdateDemoVersionTimingRequest {
  label?: string;
  tempoBpm?: number | null;
  timeSignatureNum?: number;
  timeSignatureDen?: number;
  musicalKey?: string | null;
  tempoSource?: TimingSource;
  keySource?: TimingSource;
}

export interface SplitSegmentRequest {
  segmentId?: string;
  segmentStartMs: number;
  segmentEndMs: number;
  splitTimeMs: number;
}

export interface SegmentTimelineData {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
}

export interface SplitSegmentResponse {
  trackVersionId: string;
  leftSegmentId: string;
  rightSegmentId: string;
  leftSegment: SegmentTimelineData;
  rightSegment: SegmentTimelineData;
}

export interface MoveSegmentResponse {
  trackVersionId: string;
  segment: SegmentTimelineData;
}

export interface CreateCommentRequest {
  demoId: string;
  body: string;
  parentId?: string;
}

export interface CreateDemoCommentRequest {
  body: string;
  trackId?: string;
  timestampMs?: number;
}

export interface UpdateCommentRequest {
  body?: string;
  isResolved?: boolean;
}

export interface CommentAuthor {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface DemoComment {
  id: string;
  demoId: string;
  trackId: string | null;
  body: string;
  isResolved: boolean;
  timestampMs: number | null;
  createdAt: string;
  updatedAt: string;
  author: CommentAuthor;
}

export interface DemoVersionTiming extends DemoTimingMetadata {
  id: string;
}

export interface UploadTrackRequest {
  demoId: string;
  trackId?: string;
  name?: string;
  sourceVersionId?: string;
}

export interface UploadTrackResponse {
  trackVersionId: string;
  demoVersionId: string;
  status: 'ready';
  processingJobIds: string[];
}

// ─── API response shapes ─────────────────────────────────────────────────────

export interface JobStatusResponse {
  id: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  progress: number;
  error?: string;
  result?: unknown;
}

export interface ApiError {
  error: string;
  code?: string;
}
