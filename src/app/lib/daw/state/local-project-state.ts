import type { DemoAnnotation, DemoComment, DemoVersionKind, JsonValue, TimingSource } from '@git-for-music/shared';
import type { DawOperationType } from '@git-for-music/server/app/lib/daw/protocol';

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

export type HostedPluginInstanceState = {
  instanceId: string;
  pluginKey: string;
  version: string;
  backend: 'wam' | 'remote';
  position: number;
  bypassed: boolean;
  params: Record<string, number>;
  state?: JsonValue;
  stateBlobKey?: string | null;
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
  plugins: HostedPluginInstanceState[];
};

export type DawVersion = {
  id: string;
  label: string;
  name?: string | null;
  branchName?: string | null;
  operationSummary?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  description: string | null;
  parentId: string | null;
  parentVersionId?: string | null;
  createdAt: string;
  kind?: DemoVersionKind;
  operationSeq?: number | null;
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

export type ProjectOperationHistoryEntry = {
  operationId: string;
  operationSeq?: number;
  operationType: DawOperationType;
  versionId: string | null;
  currentVersionId: string | null;
  trackId: string | null;
  segmentId: string | null;
  summary: string;
  actorUserId: string;
  createdAt: string;
};

export type LocalProjectState = {
  versions: DawVersion[];
  currentVersionId: string;
  activeVersionId?: string | null;
  isFollowingHead?: boolean;
  versionTreeUpdatedAt?: string | null;
  lastVersionOperationSeq?: number;
  lastSeenOperationSeq?: number;
  userDisplayNamesById?: Record<string, string | null>;
  comments: DemoComment[];
  annotations: DemoAnnotation[];
  tempoMetadataByTrackVersionId: Record<string, TempoMetadataEntry>;
  operationHistory: ProjectOperationHistoryEntry[];
};
