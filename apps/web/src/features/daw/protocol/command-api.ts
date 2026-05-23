import type { JsonValue, TimingSource } from '@git-for-music/shared';

export type DawOperationType =
  | 'TRACK_RENAMED'
  | 'TRACK_OFFSET_UPDATED'
  | 'SEGMENT_SPLIT'
  | 'SEGMENT_MOVED'
  | 'SEGMENT_DELETED'
  | 'SEGMENT_TRIMMED'
  | 'SEGMENT_MERGED'
  | 'CROSSFADE_SET'
  | 'VERSION_TIMING_UPDATED'
  | 'ASSET_ADDED'
  | 'COMMENT_ADDED'
  | 'COMMENT_UPDATED'
  | 'COMMENT_DELETED'
  | 'ANNOTATION_ADDED'
  | 'ANNOTATION_UPDATED'
  | 'ANNOTATION_DELETED';

export interface DawSegmentSnapshot {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  crossfadeInMs?: number | null;
  crossfadeOutMs?: number | null;
  crossfadeCurve?: string | null;
}

export interface DawOperationPayloadTrackRenamed {
  trackId: string;
  trackName: string;
}

export interface DawOperationPayloadTrackOffsetUpdated {
  trackVersionId: string;
  startOffsetMs: number;
}

export interface DawOperationPayloadSegmentSplit {
  trackVersionId: string;
  segmentId?: string;
  segmentStartMs: number;
  segmentEndMs: number;
  splitTimeMs: number;
}

export interface DawOperationPayloadSegmentMoved {
  trackVersionId: string;
  segmentId: string;
  timelineStartMs: number;
}

export interface DawOperationPayloadSegmentDeleted {
  trackVersionId: string;
  segmentId: string;
}

export interface DawOperationPayloadSegmentTrimmed {
  trackVersionId: string;
  segmentId: string;
  from: {
    startMs: number;
    endMs: number;
  };
  to: {
    startMs: number;
    endMs: number;
  };
}

export interface DawOperationPayloadSegmentMerged {
  trackVersionId: string;
  segmentIds: string[];
  mergedSegment: DawSegmentSnapshot;
}

export interface DawOperationPayloadCrossfadeSet {
  trackVersionId: string;
  leftSegmentId: string;
  rightSegmentId: string;
  crossfadeInMs: number;
  crossfadeOutMs: number;
  curve: string | null;
}

export interface DawOperationPayloadVersionTimingUpdated {
  versionId: string;
  label?: string;
  tempoBpm?: number | null;
  timeSignatureNum?: number;
  timeSignatureDen?: number;
  musicalKey?: string | null;
  tempoSource?: TimingSource;
  keySource?: TimingSource;
}

export interface DawOperationPayloadCommentBase {
  commentId: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
}

export type DawOperationPayloadCommentAdded = DawOperationPayloadCommentBase;

export type DawOperationPayloadCommentUpdated = DawOperationPayloadCommentBase;

export type DawOperationPayloadCommentDeleted = DawOperationPayloadCommentBase;

export interface DawOperationPayloadAnnotationBase {
  annotationId: string;
  demoId: string;
  trackId: string | null;
  segmentId: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  body: string;
  createdBy: string;
  resolved: boolean;
}

export type DawOperationPayloadAnnotationAdded = DawOperationPayloadAnnotationBase;

export type DawOperationPayloadAnnotationUpdated = DawOperationPayloadAnnotationBase;

export type DawOperationPayloadAnnotationDeleted = DawOperationPayloadAnnotationBase;

export interface DawOperationAffectedTimeRange {
  startMs: number;
  endMs: number;
}

export interface DawOperationCommitMetadata {
  baseSnapshotId?: string | null;
  baseOperationSeq?: number;
  targetTrackId?: string | null;
  targetSegmentId?: string | null;
  affectedTimeRange?: DawOperationAffectedTimeRange | null;
  idempotencyKey?: string;
  clientOperationId?: string;
  checkpointTailOperations?: number;
}

export type DawCommandPayload =
  | DawOperationPayloadTrackRenamed
  | DawOperationPayloadTrackOffsetUpdated
  | DawOperationPayloadSegmentSplit
  | DawOperationPayloadSegmentMoved
  | DawOperationPayloadSegmentDeleted
  | DawOperationPayloadSegmentTrimmed
  | DawOperationPayloadSegmentMerged
  | DawOperationPayloadCrossfadeSet
  | DawOperationPayloadVersionTimingUpdated
  | DawOperationPayloadCommentAdded
  | DawOperationPayloadCommentUpdated
  | DawOperationPayloadCommentDeleted
  | DawOperationPayloadAnnotationAdded
  | DawOperationPayloadAnnotationUpdated
  | DawOperationPayloadAnnotationDeleted;

export type DawOperationLogPayload =
  | DawOperationPayloadTrackRenamed
  | DawOperationPayloadTrackOffsetUpdated
  | {
      assetId: string;
      projectId: string;
      demoId: string;
      trackId: string | null;
      trackVersionId: string | null;
      assetKind: 'ORIGINAL' | 'DERIVED' | 'PEAKS' | 'ANALYSIS';
      storageKey: string;
    }
  | {
      trackVersionId: string;
      sourceSegmentId: string | null;
      leftSegment: DawSegmentSnapshot;
      rightSegment: DawSegmentSnapshot;
    }
  | DawOperationPayloadSegmentMoved
  | DawOperationPayloadSegmentDeleted
  | DawOperationPayloadSegmentTrimmed
  | DawOperationPayloadSegmentMerged
  | DawOperationPayloadCrossfadeSet
  | {
      versionId: string;
      label: string;
      tempoBpm: number | null;
      timeSignatureNum: number;
      timeSignatureDen: number;
      musicalKey: string | null;
      tempoSource: TimingSource;
      keySource: TimingSource;
    }
  | DawOperationPayloadCommentAdded
  | DawOperationPayloadCommentUpdated
  | DawOperationPayloadCommentDeleted
  | DawOperationPayloadAnnotationAdded
  | DawOperationPayloadAnnotationUpdated
  | DawOperationPayloadAnnotationDeleted;

export interface DawProjectOperationRecord {
  id: string;
  projectId: string;
  demoId: string;
  type: DawOperationType;
  createdAt: string;
  actorUserId: string;
  baseSnapshotId: string | null;
  baseOperationSeq: number;
  operationSeq: number;
  payload: JsonValue;
  idempotencyKey: string;
  clientOperationId: string;
}

export interface DawProjectSnapshotRecord {
  id: string;
  projectId: string;
  demoId: string;
  operationSeq: number;
  snapshot: JsonValue;
  createdById: string;
  createdAt: string;
}

export type DawProjectRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface DawProjectPermissions {
  role: DawProjectRole;
  canRead: boolean;
  canWrite: boolean;
  canManageProject: boolean;
}

export interface DawProjectBootstrapProject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  group: {
    id: string;
    slug: string;
  };
  demoId: string;
  currentVersionId: string | null;
}

export interface DawProjectBootstrapAsset {
  id: string;
  projectId: string;
  demoId: string;
  trackId: string | null;
  trackVersionId: string | null;
  assetKind: 'ORIGINAL' | 'DERIVED' | 'PEAKS' | 'ANALYSIS';
  storageKey: string;
  mimeType: string;
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
  durationMs: number;
  sizeBytes: string;
  checksum: string;
  parentAssetId: string | null;
  createdAt: string;
}

export interface DawProjectBootstrapPluginDefinition {
  id: string;
  pluginKey: string;
  name: string;
  version: string;
  manufacturer: string | null;
  parameterSchema: JsonValue;
  createdAt: string;
}

export interface DawProjectBootstrapSnapshot {
  id: string;
  projectId: string;
  demoId: string;
  operationSeq: number;
  snapshot: JsonValue;
  createdById: string;
  createdAt: string;
}

export interface DawProjectBootstrapResponse {
  project: DawProjectBootstrapProject;
  latestSnapshot: DawProjectBootstrapSnapshot | null;
  projectState?: JsonValue;
  operationTail: DawProjectOperationRecord[];
  assets: DawProjectBootstrapAsset[];
  pluginDefinitions: DawProjectBootstrapPluginDefinition[];
  comments?: JsonValue;
  annotations?: JsonValue;
  presenceSeed?: string;
  permissions: DawProjectPermissions;
}

export type DawOperationCommitRequest =
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'TRACK_RENAMED';
      payload: DawOperationPayloadTrackRenamed;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'TRACK_OFFSET_UPDATED';
      payload: DawOperationPayloadTrackOffsetUpdated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'SEGMENT_SPLIT';
      payload: DawOperationPayloadSegmentSplit;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'SEGMENT_MOVED';
      payload: DawOperationPayloadSegmentMoved;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'SEGMENT_DELETED';
      payload: DawOperationPayloadSegmentDeleted;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'SEGMENT_TRIMMED';
      payload: DawOperationPayloadSegmentTrimmed;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'SEGMENT_MERGED';
      payload: DawOperationPayloadSegmentMerged;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'CROSSFADE_SET';
      payload: DawOperationPayloadCrossfadeSet;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_TIMING_UPDATED';
      payload: DawOperationPayloadVersionTimingUpdated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'COMMENT_ADDED';
      payload: DawOperationPayloadCommentAdded;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'COMMENT_UPDATED';
      payload: DawOperationPayloadCommentUpdated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'COMMENT_DELETED';
      payload: DawOperationPayloadCommentDeleted;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'ANNOTATION_ADDED';
      payload: DawOperationPayloadAnnotationAdded;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'ANNOTATION_UPDATED';
      payload: DawOperationPayloadAnnotationUpdated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'ANNOTATION_DELETED';
      payload: DawOperationPayloadAnnotationDeleted;
    });

export interface DawOperationsResponse {
  operations: DawProjectOperationRecord[];
}
