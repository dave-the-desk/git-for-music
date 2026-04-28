// Enums mirroring Prisma schema — kept in sync manually until codegen is wired up.

export type GroupMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type ProcessingJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export type ProcessingJobType = 'WAVEFORM' | 'TRANSCODE' | 'NORMALIZE' | 'STEM_SPLIT';

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

export interface CreateCommentRequest {
  demoId: string;
  body: string;
  parentId?: string;
}

export interface UploadTrackRequest {
  demoId: string;
  trackId?: string;
  name?: string;
  sourceVersionId?: string;
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
