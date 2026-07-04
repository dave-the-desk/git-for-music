import type { JsonValue, TimingSource } from '@git-for-music/shared';

export type DawOperationType =
  | 'TRACK_RENAMED'
  | 'TRACK_OFFSET_UPDATED'
  | 'SEGMENT_SPLIT'
  | 'SEGMENT_MOVED'
  | 'SEGMENT_DELETED'
  | 'SEGMENT_TRIMMED'
  | 'SEGMENT_MERGED'
  | 'SEGMENT_FADE_SET'
  | 'CROSSFADE_SET'
  | 'VERSION_CREATED'
  | 'VERSION_RENAMED'
  | 'VERSION_SELECTED'
  | 'VERSION_BRANCH_CREATED'
  | 'VERSION_REVERTED_FROM'
  | 'CURRENT_VERSION_CHANGED'
  | 'TRACK_VERSION_CREATED'
  | 'VERSION_PARENT_SET'
  | 'VERSION_OPERATION_SUMMARY_SET'
  | 'VERSION_NODE_ADDED'
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
  timelineEndMs: number | null;
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
  fromTrackVersionId: string;
  toTrackVersionId: string;
  segmentId: string;
  fromTimelineStartMs: number;
  fromTimelineEndMs: number;
  toTimelineStartMs: number;
  toTimelineEndMs: number;
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

export interface DawOperationPayloadSegmentFadeSet {
  trackVersionId: string;
  segmentId: string;
  fadeInMs: number;
  fadeOutMs: number;
  previousFadeInMs?: number | null;
  previousFadeOutMs?: number | null;
}

export interface DawOperationPayloadCrossfadeSet {
  trackVersionId: string;
  leftSegmentId: string;
  rightSegmentId: string;
  crossfadeInMs: number;
  crossfadeOutMs: number;
  curve: string | null;
}

export interface DawVersionTreeTrackSnapshot {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  startOffsetMs: number;
  createdAt: string;
  isDerived: boolean;
  operationType: 'ORIGINAL' | 'TIME_STRETCH';
  parentTrackVersionId: string | null;
  segments: DawSegmentSnapshot[];
}

export interface DawVersionTreeNodeSnapshot {
  id: string;
  label: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  isCurrent: boolean;
  branchMode?: 'continue' | 'fork';
  kind?: 'AUTO' | 'SEMANTIC' | 'EXPLICIT' | 'REVERT' | 'BRANCH' | 'MERGE';
  operationSeq?: number | null;
  tempoBpm: number | null;
  timeSignatureNum: number;
  timeSignatureDen: number;
  musicalKey: string | null;
  tempoSource: TimingSource;
  keySource: TimingSource;
  isMerge?: boolean;
  tracks: DawVersionTreeTrackSnapshot[];
}

export interface DawOperationPayloadVersionCreated {
  versionId?: string;
  parentVersionId?: string | null;
  branchName?: string | null;
  branchMode?: 'continue' | 'fork';
  label?: string | null;
  createdAt?: string;
  createdBy?: string;
  operationSummary?: string | null;
  version: DawVersionTreeNodeSnapshot;
}

export interface DawOperationPayloadVersionRenamed {
  versionId: string;
  label?: string;
  name?: string;
  branchName?: string | null;
}

/** @deprecated Legacy compatibility only. Use the per-user active-version API instead. */
export interface DawOperationPayloadVersionSelected {
  currentVersionId: string;
  previousVersionId: string | null;
}

export interface DawOperationPayloadVersionBranchCreated {
  versionId?: string;
  parentVersionId?: string | null;
  branchName?: string | null;
  branchMode?: 'continue' | 'fork';
  label?: string | null;
  createdAt?: string;
  createdBy?: string;
  operationSummary?: string | null;
  version: DawVersionTreeNodeSnapshot;
  sourceVersionId: string;
}

export interface DawOperationPayloadVersionRevertedFrom {
  versionId?: string;
  revertedFromVersionId: string;
  currentVersionId: string;
  branchMode?: 'continue' | 'fork';
  branchName?: string | null;
  label?: string | null;
  createdAt?: string;
  createdBy?: string;
  operationSummary?: string | null;
  version: DawVersionTreeNodeSnapshot;
}

/** @deprecated Legacy compatibility only. Use the per-user active-version API instead. */
export interface DawOperationPayloadCurrentVersionChanged {
  previousVersionId: string | null;
  currentVersionId: string;
}

export interface DawOperationPayloadTrackVersionCreated {
  versionId?: string | null;
  trackId?: string;
  trackVersionId?: string;
  operationSummary?: string | null;
  track: DawVersionTreeTrackSnapshot;
}

export interface DawOperationPayloadVersionParentSet {
  versionId: string;
  parentId: string | null;
}

export interface DawOperationPayloadVersionOperationSummarySet {
  versionId: string;
  description: string | null;
}

export interface DawOperationPayloadVersionNodeAdded {
  branchMode?: 'continue' | 'fork';
  version: DawVersionTreeNodeSnapshot;
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
  | DawOperationPayloadSegmentFadeSet
  | DawOperationPayloadCrossfadeSet
  | DawOperationPayloadVersionCreated
  | DawOperationPayloadVersionRenamed
  | DawOperationPayloadVersionSelected
  | DawOperationPayloadVersionBranchCreated
  | DawOperationPayloadVersionRevertedFrom
  | DawOperationPayloadCurrentVersionChanged
  | DawOperationPayloadTrackVersionCreated
  | DawOperationPayloadVersionParentSet
  | DawOperationPayloadVersionOperationSummarySet
  | DawOperationPayloadVersionNodeAdded
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
  | DawOperationPayloadSegmentFadeSet
  | DawOperationPayloadCrossfadeSet
  | DawOperationPayloadVersionCreated
  | DawOperationPayloadVersionRenamed
  | DawOperationPayloadVersionSelected
  | DawOperationPayloadVersionBranchCreated
  | DawOperationPayloadVersionRevertedFrom
  | DawOperationPayloadCurrentVersionChanged
  | DawOperationPayloadTrackVersionCreated
  | DawOperationPayloadVersionParentSet
  | DawOperationPayloadVersionOperationSummarySet
  | DawOperationPayloadVersionNodeAdded
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

export type DawAcceptedOperationPayload = DawOperationLogPayload;

export interface AcceptedDawProjectOperation {
  id: string;
  projectId: string;
  demoId: string;
  type: DawOperationType;
  createdAt: string;
  actorUserId: string;
  baseSnapshotId: string | null;
  baseOperationSeq: number;
  operationSeq: number;
  payload: DawAcceptedOperationPayload;
  idempotencyKey: string;
  clientOperationId: string;
}

export type DawProjectOperationRecord = AcceptedDawProjectOperation;

export interface DawRealtimeAcceptedOperationPayload {
  projectId: string;
  demoId: string;
  operationId: string;
  operationSeq: number;
  actorUserId: string;
  operationType: DawOperationType;
  payload: DawAcceptedOperationPayload;
  createdAt: string;
  clientOperationId?: string | null;
  idempotencyKey?: string | null;
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
  activeVersionId: string | null;
  isFollowingHead: boolean;
  activeBranchName?: string | null;
  projectState?: JsonValue;
  operationTail: DawProjectOperationRecord[];
  assets: DawProjectBootstrapAsset[];
  pluginDefinitions: DawProjectBootstrapPluginDefinition[];
  comments?: JsonValue;
  annotations?: JsonValue;
  presenceSeed?: string;
  permissions: DawProjectPermissions;
}

export interface DawSetUserActiveVersionRequest {
  demoId: string;
  activeVersionId: string;
  isFollowingHead?: boolean;
}

export interface DawSetUserActiveVersionResponse {
  activeVersionId: string;
  isFollowingHead: boolean;
  activeBranchName: string | null;
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
      operationType: 'SEGMENT_FADE_SET';
      payload: DawOperationPayloadSegmentFadeSet;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'CROSSFADE_SET';
      payload: DawOperationPayloadCrossfadeSet;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_CREATED';
      payload: DawOperationPayloadVersionCreated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_RENAMED';
      payload: DawOperationPayloadVersionRenamed;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_SELECTED';
      payload: DawOperationPayloadVersionSelected;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_BRANCH_CREATED';
      payload: DawOperationPayloadVersionBranchCreated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_REVERTED_FROM';
      payload: DawOperationPayloadVersionRevertedFrom;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'CURRENT_VERSION_CHANGED';
      payload: DawOperationPayloadCurrentVersionChanged;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'TRACK_VERSION_CREATED';
      payload: DawOperationPayloadTrackVersionCreated;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_PARENT_SET';
      payload: DawOperationPayloadVersionParentSet;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_OPERATION_SUMMARY_SET';
      payload: DawOperationPayloadVersionOperationSummarySet;
    })
  | (DawOperationCommitMetadata & {
      demoId: string;
      operationType: 'VERSION_NODE_ADDED';
      payload: DawOperationPayloadVersionNodeAdded;
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

export type DawProjectOperationRequest = DawOperationCommitRequest;

export interface DawOperationsResponse {
  operations: DawProjectOperationRecord[];
}
