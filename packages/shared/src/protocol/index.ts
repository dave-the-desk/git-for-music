export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ProjectAssetKind = 'audio' | 'waveform' | 'analysis';
export type ProjectPluginTargetKind = 'project' | 'track' | 'track-version' | 'segment';
export type ProjectPresenceState = 'JOINED' | 'UPDATED' | 'LEFT' | 'HEARTBEAT';
export type ProjectTransportState = 'PLAYING' | 'PAUSED' | 'STOPPED' | 'SEEKING';
export type AssetLifecycleStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
export type PluginParameterType = 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'json';
export type AnalysisArtifactType = 'tempo' | 'key' | 'transcription' | 'stem-split' | 'generic' | string;

export interface ProjectTimeSignature {
  num: number;
  den: number;
}

export interface ProjectSelection {
  trackId: string | null;
  trackVersionId: string | null;
  segmentId: string | null;
  startMs: number | null;
  endMs: number | null;
}

export interface PluginParameterDefinition {
  id: string;
  key: string;
  name: string;
  type: PluginParameterType;
  defaultValue: JsonValue | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string[] | null;
  unit?: string | null;
  metadata?: Record<string, JsonValue>;
}

export interface PluginDefinition {
  id: string;
  pluginKey: string;
  name: string;
  vendor: string | null;
  version: string | null;
  description: string | null;
  category: string | null;
  inputChannels: number;
  outputChannels: number;
  parameterDefinitions: PluginParameterDefinition[];
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface PluginPreset {
  id: string;
  pluginDefinitionId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  parameterValues: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTrack {
  id: string;
  projectId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  color: string | null;
  muted: boolean;
}

export interface ProjectSection {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  startMs: number;
  endMs: number;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectComment {
  id: string;
  projectId: string;
  trackId: string | null;
  trackVersionId: string | null;
  body: string;
  isResolved: boolean;
  timestampMs: number | null;
  authorId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSegment {
  id: string;
  projectId: string;
  trackId: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  crossfadeInMs: number | null;
  crossfadeOutMs: number | null;
}

export interface ProjectTrackVersion {
  id: string;
  projectId: string;
  trackId: string;
  versionId: string | null;
  storageKey: string;
  sourceFileUrl: string | null;
  startOffsetMs: number;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  isDerived: boolean;
  operationType: 'ORIGINAL' | 'TIME_STRETCH' | string;
  parentTrackVersionId: string | null;
  createdAt: string;
  segments: ProjectSegment[];
}

export interface ProjectVersionBranch {
  id: string;
  projectId: string;
  label: string;
  description: string | null;
  parentVersionId: string | null;
  createdById: string | null;
  isMerge: boolean;
  createdAt: string;
}

export interface ProjectPluginTargetProject {
  kind: 'project';
  projectId: string;
}

export interface ProjectPluginTargetTrack {
  kind: 'track';
  trackId: string;
}

export interface ProjectPluginTargetTrackVersion {
  kind: 'track-version';
  trackVersionId: string;
}

export interface ProjectPluginTargetSegment {
  kind: 'segment';
  segmentId: string;
}

export type ProjectPluginTarget =
  | ProjectPluginTargetProject
  | ProjectPluginTargetTrack
  | ProjectPluginTargetTrackVersion
  | ProjectPluginTargetSegment;

export interface ProjectPluginInstance {
  id: string;
  pluginDefinitionId: string;
  pluginPresetId: string | null;
  bypassed: boolean;
  order: number;
  parameterValues: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
}

export interface ProjectPluginChain {
  id: string;
  projectId: string;
  target: ProjectPluginTarget;
  plugins: ProjectPluginInstance[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAssetRecord {
  id: string;
  projectId: string;
  trackId: string | null;
  trackVersionId: string | null;
  storageKey: string;
  status: AssetLifecycleStatus;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, JsonValue>;
}

export interface AudioAsset extends ProjectAssetRecord {
  kind: 'audio';
  originalFileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  durationMs: number | null;
}

export interface WaveformArtifact extends ProjectAssetRecord {
  kind: 'waveform';
  audioAssetId: string | null;
  peakCount: number | null;
  sampleRate: number | null;
  durationMs: number | null;
}

export interface AnalysisArtifact extends ProjectAssetRecord {
  kind: 'analysis';
  audioAssetId: string | null;
  waveformArtifactId: string | null;
  analysisType: AnalysisArtifactType;
  result: Record<string, JsonValue>;
  confidence: number | null;
}

export interface ProjectSnapshotState {
  projectId: string;
  tracks: ProjectTrack[];
  trackVersions: ProjectTrackVersion[];
  segments: ProjectSegment[];
  comments: ProjectComment[];
  sections: ProjectSection[];
  pluginChains: ProjectPluginChain[];
  versionBranches: ProjectVersionBranch[];
  audioAssets: AudioAsset[];
  waveformArtifacts: WaveformArtifact[];
  analysisArtifacts: AnalysisArtifact[];
  tempoBpm: number | null;
  timeSignature: ProjectTimeSignature;
  musicalKey: string | null;
  currentVersionId: string | null;
}

export interface ProjectSnapshot<TState = ProjectSnapshotState> {
  id: string;
  projectId: string;
  baseOperationId: string | null;
  appliedThroughOperationId: string | null;
  createdById: string | null;
  createdAt: string;
  operationCount: number;
  state: TState;
}

export type ProjectOperationType =
  | 'TRACK_ADDED'
  | 'TRACK_RENAMED'
  | 'TRACK_REMOVED'
  | 'ASSET_ADDED'
  | 'TRACK_VERSION_CREATED'
  | 'SEGMENT_CREATED'
  | 'SEGMENT_SPLIT'
  | 'SEGMENT_MOVED'
  | 'SEGMENT_TRIMMED'
  | 'SEGMENT_MERGED'
  | 'CROSSFADE_SET'
  | 'CROSSFADE_REMOVED'
  | 'COMMENT_ADDED'
  | 'COMMENT_UPDATED'
  | 'COMMENT_DELETED'
  | 'PROJECT_TEMPO_SET'
  | 'PROJECT_TIME_SIGNATURE_SET'
  | 'PROJECT_KEY_SET'
  | 'PROJECT_SECTION_ADDED'
  | 'PROJECT_SECTION_UPDATED'
  | 'PROJECT_SECTION_DELETED'
  | 'PLUGIN_CHAIN_SET'
  | 'PLUGIN_ADDED'
  | 'PLUGIN_REMOVED'
  | 'PLUGIN_PARAM_SET'
  | 'PLUGIN_BYPASS_SET'
  | 'VERSION_BRANCH_CREATED'
  | 'VERSION_REVERTED_FROM';

export interface ProjectOperationBase<TType extends ProjectOperationType = ProjectOperationType> {
  id: string;
  projectId: string;
  type: TType;
  createdAt: string;
  actorId: string | null;
  clientId: string | null;
  sequence: number | null;
  parentOperationId: string | null;
  causationId: string | null;
  correlationId: string | null;
}

export interface TrackAddedOperationPayload {
  track: ProjectTrack;
}

export interface TrackRenamedOperationPayload {
  trackId: string;
  previousName: string | null;
  name: string;
}

export interface TrackRemovedOperationPayload {
  track: ProjectTrack;
}

export interface AssetAddedOperationPayload {
  asset: AudioAsset | WaveformArtifact | AnalysisArtifact;
}

export interface TrackVersionCreatedOperationPayload {
  trackVersion: ProjectTrackVersion;
  sourceTrackVersionId: string | null;
}

export interface SegmentCreatedOperationPayload {
  segment: ProjectSegment;
}

export interface SegmentSplitOperationPayload {
  trackVersionId: string;
  sourceSegmentId: string | null;
  splitTimeMs: number;
  leftSegment: ProjectSegment;
  rightSegment: ProjectSegment;
}

export interface SegmentMovedOperationPayload {
  segmentId: string;
  fromTrackVersionId: string;
  toTrackVersionId: string;
  fromTimelineStartMs: number;
  toTimelineStartMs: number;
  toTimelineEndMs: number;
}

export interface SegmentTrimmedOperationPayload {
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

export interface SegmentMergedOperationPayload {
  trackVersionId: string;
  segmentIds: string[];
  mergedSegment: ProjectSegment;
}

export interface CrossfadeSetOperationPayload {
  trackVersionId: string;
  leftSegmentId: string;
  rightSegmentId: string;
  crossfadeInMs: number;
  crossfadeOutMs: number;
  curve: string | null;
}

export interface CrossfadeRemovedOperationPayload {
  trackVersionId: string;
  leftSegmentId: string;
  rightSegmentId: string;
}

export interface CommentAddedOperationPayload {
  comment: ProjectComment;
}

export interface CommentUpdatedOperationPayload {
  commentId: string;
  changes: Partial<Pick<ProjectComment, 'body' | 'isResolved' | 'timestampMs'>>;
}

export interface CommentDeletedOperationPayload {
  commentId: string;
  comment: ProjectComment | null;
}

export interface ProjectTempoSetOperationPayload {
  tempoBpm: number | null;
  previousTempoBpm: number | null;
}

export interface ProjectTimeSignatureSetOperationPayload {
  timeSignature: ProjectTimeSignature;
  previousTimeSignature: ProjectTimeSignature;
}

export interface ProjectKeySetOperationPayload {
  musicalKey: string | null;
  previousMusicalKey: string | null;
}

export interface ProjectSectionAddedOperationPayload {
  section: ProjectSection;
}

export interface ProjectSectionUpdatedOperationPayload {
  sectionId: string;
  changes: Partial<ProjectSection>;
}

export interface ProjectSectionDeletedOperationPayload {
  sectionId: string;
  section: ProjectSection | null;
}

export interface PluginChainSetOperationPayload {
  chain: ProjectPluginChain;
}

export interface PluginAddedOperationPayload {
  chainId: string;
  plugin: ProjectPluginInstance;
}

export interface PluginRemovedOperationPayload {
  chainId: string;
  pluginInstanceId: string;
}

export interface PluginParamSetOperationPayload {
  chainId: string;
  pluginInstanceId: string;
  parameterKey: string;
  value: JsonValue;
}

export interface PluginBypassSetOperationPayload {
  chainId: string;
  pluginInstanceId: string;
  bypassed: boolean;
}

export interface VersionBranchCreatedOperationPayload {
  versionBranch: ProjectVersionBranch;
}

export interface VersionRevertedFromOperationPayload {
  versionId: string;
  revertedFromVersionId: string;
  revertedToOperationId: string | null;
}

export interface ProjectOperationPayloadMap {
  TRACK_ADDED: TrackAddedOperationPayload;
  TRACK_RENAMED: TrackRenamedOperationPayload;
  TRACK_REMOVED: TrackRemovedOperationPayload;
  ASSET_ADDED: AssetAddedOperationPayload;
  TRACK_VERSION_CREATED: TrackVersionCreatedOperationPayload;
  SEGMENT_CREATED: SegmentCreatedOperationPayload;
  SEGMENT_SPLIT: SegmentSplitOperationPayload;
  SEGMENT_MOVED: SegmentMovedOperationPayload;
  SEGMENT_TRIMMED: SegmentTrimmedOperationPayload;
  SEGMENT_MERGED: SegmentMergedOperationPayload;
  CROSSFADE_SET: CrossfadeSetOperationPayload;
  CROSSFADE_REMOVED: CrossfadeRemovedOperationPayload;
  COMMENT_ADDED: CommentAddedOperationPayload;
  COMMENT_UPDATED: CommentUpdatedOperationPayload;
  COMMENT_DELETED: CommentDeletedOperationPayload;
  PROJECT_TEMPO_SET: ProjectTempoSetOperationPayload;
  PROJECT_TIME_SIGNATURE_SET: ProjectTimeSignatureSetOperationPayload;
  PROJECT_KEY_SET: ProjectKeySetOperationPayload;
  PROJECT_SECTION_ADDED: ProjectSectionAddedOperationPayload;
  PROJECT_SECTION_UPDATED: ProjectSectionUpdatedOperationPayload;
  PROJECT_SECTION_DELETED: ProjectSectionDeletedOperationPayload;
  PLUGIN_CHAIN_SET: PluginChainSetOperationPayload;
  PLUGIN_ADDED: PluginAddedOperationPayload;
  PLUGIN_REMOVED: PluginRemovedOperationPayload;
  PLUGIN_PARAM_SET: PluginParamSetOperationPayload;
  PLUGIN_BYPASS_SET: PluginBypassSetOperationPayload;
  VERSION_BRANCH_CREATED: VersionBranchCreatedOperationPayload;
  VERSION_REVERTED_FROM: VersionRevertedFromOperationPayload;
}

export type ProjectOperation = {
  [TType in ProjectOperationType]: ProjectOperationBase<TType> & {
    payload: ProjectOperationPayloadMap[TType];
  };
}[ProjectOperationType];

export type ProjectOperationOf<TType extends ProjectOperationType> = Extract<ProjectOperation, { type: TType }>;

export interface ProjectBootstrapPayload<TState = ProjectSnapshotState> {
  projectId: string;
  snapshot: ProjectSnapshot<TState> | null;
  tailOperations: ProjectOperation[];
  pluginDefinitions: PluginDefinition[];
  pluginPresets: PluginPreset[];
  audioAssets: AudioAsset[];
  waveformArtifacts: WaveformArtifact[];
  analysisArtifacts: AnalysisArtifact[];
  versionBranches: ProjectVersionBranch[];
  presence: PresenceMessage[];
  transport: TransportMessage | null;
  serverTime: string;
}

export interface PresenceMessage {
  projectId: string;
  userId: string;
  clientId: string;
  displayName: string | null;
  avatarUrl: string | null;
  color: string | null;
  status: ProjectPresenceState;
  cursorMs: number | null;
  selection: ProjectSelection | null;
  updatedAt: string;
}

export interface TransportMessage {
  projectId: string;
  status: ProjectTransportState;
  playheadMs: number;
  tempoBpm: number | null;
  timeSignature: ProjectTimeSignature | null;
  loopStartMs: number | null;
  loopEndMs: number | null;
  metronomeEnabled: boolean;
  updatedAt: string;
}

export interface AssetStatusMessage {
  projectId: string;
  assetId: string;
  assetKind: ProjectAssetKind;
  status: AssetLifecycleStatus;
  progress: number | null;
  detail: string | null;
  updatedAt: string;
}

export interface RealtimeOperationMessage {
  type: 'operation';
  projectId: string;
  createdAt: string;
  sourceClientId: string | null;
  sourceUserId: string | null;
  operation: ProjectOperation;
}

export interface RealtimePresenceMessage {
  type: 'presence';
  projectId: string;
  createdAt: string;
  sourceClientId: string | null;
  sourceUserId: string | null;
  presence: PresenceMessage;
}

export interface RealtimeTransportMessage {
  type: 'transport';
  projectId: string;
  createdAt: string;
  sourceClientId: string | null;
  sourceUserId: string | null;
  transport: TransportMessage;
}

export interface RealtimeAssetStatusEnvelope {
  type: 'asset-status';
  projectId: string;
  createdAt: string;
  sourceClientId: string | null;
  sourceUserId: string | null;
  assetStatus: AssetStatusMessage;
}

export interface RealtimeBootstrapMessage<TState = ProjectSnapshotState> {
  type: 'bootstrap';
  projectId: string;
  createdAt: string;
  sourceClientId: string | null;
  sourceUserId: string | null;
  bootstrap: ProjectBootstrapPayload<TState>;
}

export type RealtimeMessage =
  | RealtimeOperationMessage
  | RealtimePresenceMessage
  | RealtimeTransportMessage
  | RealtimeAssetStatusEnvelope
  | RealtimeBootstrapMessage;
