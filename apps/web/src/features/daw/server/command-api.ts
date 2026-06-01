import { Prisma, PrismaClient } from '@git-for-music/db';
import { randomUUID } from 'node:crypto';
import {
  loadDemoOperationTail,
  loadLatestDemoSnapshot,
  loadLatestDemoSnapshotAtOrBeforeOperationSeq,
  loadSnapshotStateForDemo,
  recordDemoDawOperation,
  type DemoDawSnapshotData,
  type DemoDawOperationPayload,
  type DemoDawSnapshotOperationRow,
} from '@/features/daw/server/snapshot-builder';
import {
  loadOrCreateDemoUserActiveVersionState,
  type DemoUserActiveVersionState,
  setDemoUserActiveVersion,
} from '@/features/daw/server/demo-user-active-version';
import { analyzeDawOperationConflict } from '@/features/daw/server/conflict-rules';
import {
  buildMergedSegmentFromPair,
  CROSSFADE_EPSILON_MS,
  CROSSFADE_DURATION_ERROR,
  getCrossfadeCandidateError,
  getMergeCandidateError,
  sortSegmentsForMerge,
  splitSegment,
  MIN_SPLIT_DISTANCE_MS,
  type MergeableSegment,
} from '@/features/daw/utils/segments';
import { isValidTempoBpm, normalizeTimeSignature } from '@/features/daw/utils/timing';
import {
  createProjectPresenceSeed,
  emitAcceptedDawOperation,
  emitDawVersionTreeChanged,
} from '@/features/daw/server/realtime-gateway';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
import { serializeCreatedDemoVersionTreeNode } from '@/features/daw/server/versioning';
import type {
  DawOperationCommitRequest,
  DawOperationLogPayload,
  DawOperationType,
  DawProjectBootstrapAsset,
  DawProjectBootstrapPluginDefinition,
  DawProjectBootstrapResponse,
  DawProjectOperationRecord,
  DawProjectPermissions,
  DawProjectRole,
  DawProjectSnapshotRecord,
  DawSegmentSnapshot,
  DawOperationPayloadCommentAdded,
  DawOperationPayloadCommentUpdated,
  DawOperationPayloadCommentDeleted,
  DawOperationPayloadAnnotationAdded,
  DawOperationPayloadAnnotationUpdated,
  DawOperationPayloadAnnotationDeleted,
  DawOperationPayloadVersionRenamed,
  DawOperationPayloadVersionTimingUpdated,
} from '@/features/daw/protocol';
import type { JsonValue, TimingSource } from '@git-for-music/shared';

export type DawDatabaseClient = PrismaClient | Prisma.TransactionClient;

interface DawProjectWorkspace {
  project: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    group: {
      id: string;
      slug: string;
    };
  };
  demo: {
    id: string;
    name: string;
    description: string | null;
    currentVersionId: string | null;
  };
  permissions: DawProjectPermissions;
}

interface DawOperationExecutionResult {
  logPayload: DawOperationLogPayload;
  forceCheckpoint?: boolean;
}

const MAX_TRACK_NAME_LENGTH = 100;
const MAX_VERSION_LABEL_LENGTH = 120;
const VALID_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);
const VALID_TIMING_SOURCES = new Set<TimingSource>(['MANUAL', 'ANALYZED', 'IMPORTED']);
const TIMELINE_EDIT_OPERATION_TYPES = new Set<DawOperationType>([
  'TRACK_RENAMED',
  'TRACK_OFFSET_UPDATED',
  'SEGMENT_SPLIT',
  'SEGMENT_MOVED',
  'SEGMENT_DELETED',
  'SEGMENT_TRIMMED',
  'SEGMENT_MERGED',
  'SEGMENT_FADE_SET',
  'CROSSFADE_SET',
]);
const BRANCH_CREATING_OPERATION_TYPES = new Set<DawOperationType>([
  'TRACK_RENAMED',
  'SEGMENT_TRIMMED',
]);
const VERSION_TREE_MUTATION_OPERATION_TYPES = new Set<DawOperationType>([
  'VERSION_CREATED',
  'VERSION_BRANCH_CREATED',
  'VERSION_RENAMED',
  'VERSION_SELECTED',
  'VERSION_REVERTED_FROM',
  'CURRENT_VERSION_CHANGED',
  'TRACK_VERSION_CREATED',
  'VERSION_PARENT_SET',
  'VERSION_OPERATION_SUMMARY_SET',
  'VERSION_NODE_ADDED',
  'VERSION_TIMING_UPDATED',
]);

export function shouldBranchFromHistoricalBase(input: {
  baseSnapshotId: string | null;
  latestSnapshotId: string | null;
}) {
  return Boolean(input.baseSnapshotId && input.baseSnapshotId !== input.latestSnapshotId);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isTimelineEditOperation(operationType: DawOperationType) {
  return TIMELINE_EDIT_OPERATION_TYPES.has(operationType);
}

export function shouldCreateBranchForOperation(operationType: DawOperationType) {
  return BRANCH_CREATING_OPERATION_TYPES.has(operationType);
}

export function getTimelineEditBranchLabel(operationType: DawOperationType) {
  if (!shouldCreateBranchForOperation(operationType)) {
    return null;
  }

  switch (operationType) {
    case 'TRACK_RENAMED':
      return 'Track renamed';
    case 'SEGMENT_SPLIT':
      return 'Split clip';
    case 'SEGMENT_DELETED':
      return 'Deleted clip';
    case 'SEGMENT_TRIMMED':
      return 'Trimmed clip';
    case 'SEGMENT_MERGED':
      return 'Merged clips';
    case 'SEGMENT_FADE_SET':
      return 'Fade adjusted';
    case 'CROSSFADE_SET':
      return 'Crossfade adjusted';
    default:
      return null;
  }
}

export function shouldBroadcastVersionTreeChanged(operationType: DawOperationType) {
  return VERSION_TREE_MUTATION_OPERATION_TYPES.has(operationType);
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeProjectOperation(row: DemoDawSnapshotOperationRow): DawProjectOperationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    type: row.type,
    createdAt: row.createdAt,
    actorUserId: row.actorUserId,
    baseSnapshotId: row.baseSnapshotId,
    baseOperationSeq: row.baseOperationSeq,
    operationSeq: row.operationSeq,
    payload: row.payload as unknown as DawProjectOperationRecord['payload'],
    idempotencyKey: row.idempotencyKey,
    clientOperationId: row.clientOperationId,
  };
}

function serializeSnapshotRow(row: Awaited<ReturnType<typeof loadLatestDemoSnapshot>>) {
  if (!row) return null;

  return {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    operationSeq: row.operationSeq,
    snapshot: row.snapshot as DawProjectSnapshotRecord['snapshot'],
    createdById: row.createdById,
    createdAt: toIsoString(row.createdAt),
  } satisfies DawProjectSnapshotRecord;
}

function serializeAsset(row: {
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
  sizeBytes: bigint;
  checksum: string;
  parentAssetId: string | null;
  createdAt: Date;
}): DawProjectBootstrapAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    trackId: row.trackId,
    trackVersionId: row.trackVersionId,
    assetKind: row.assetKind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sampleRate: row.sampleRate,
    bitDepth: row.bitDepth,
    channelCount: row.channelCount,
    durationMs: row.durationMs,
    sizeBytes: row.sizeBytes.toString(),
    checksum: row.checksum,
    parentAssetId: row.parentAssetId,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializePluginDefinition(row: {
  id: string;
  pluginKey: string;
  name: string;
  version: string;
  manufacturer: string | null;
  parameterSchema: Prisma.JsonValue;
  createdAt: Date;
}): DawProjectBootstrapPluginDefinition {
  return {
    id: row.id,
    pluginKey: row.pluginKey,
    name: row.name,
    version: row.version,
    manufacturer: row.manufacturer,
    parameterSchema: row.parameterSchema as DawProjectBootstrapPluginDefinition['parameterSchema'],
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeSegmentSnapshot(
  trackVersionId: string,
  segment: {
    id: string;
    startMs: number;
    endMs: number;
    timelineStartMs: number | null;
    timelineEndMs?: number | null;
    gainDb: number;
    fadeInMs: number;
    fadeOutMs: number;
    isMuted: boolean;
    position: number;
    crossfadeInMs?: number | null;
    crossfadeOutMs?: number | null;
    crossfadeCurve?: string | null;
  },
): DawSegmentSnapshot {
  const timelineStartMs = segment.timelineStartMs ?? segment.startMs;
  const timelineEndMs =
    segment.timelineEndMs ?? timelineStartMs + Math.max(0, segment.endMs - segment.startMs);
  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
    timelineEndMs,
    gainDb: segment.gainDb,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    isMuted: segment.isMuted,
    position: segment.position,
    crossfadeInMs: segment.crossfadeInMs ?? null,
    crossfadeOutMs: segment.crossfadeOutMs ?? null,
    crossfadeCurve: segment.crossfadeCurve ?? null,
  };
}

function validateTrackName(trackName: unknown) {
  if (!isNonEmptyString(trackName)) {
    return 'Track name cannot be empty';
  }

  const trimmed = trackName.trim();
  if (trimmed.length > MAX_TRACK_NAME_LENGTH) {
    return `Track name must be ${MAX_TRACK_NAME_LENGTH} characters or fewer`;
  }

  return null;
}

function validateVersionTimingPayload(payload: DawOperationPayloadVersionTimingUpdated) {
  if (payload === null || typeof payload !== 'object') {
    return 'Invalid operation payload';
  }

  if (!('versionId' in payload) || !isNonEmptyString((payload as { versionId?: unknown }).versionId)) {
    return 'versionId is required';
  }

  const nextLabel = 'label' in payload ? payload.label : undefined;
  const hasLabel = nextLabel !== undefined;
  const hasTempo = 'tempoBpm' in payload;
  const hasTimeSignature = 'timeSignatureNum' in payload || 'timeSignatureDen' in payload;
  const hasKey = 'musicalKey' in payload;
  const hasTimingSource = 'tempoSource' in payload || 'keySource' in payload;

  if (!hasLabel && !hasTempo && !hasTimeSignature && !hasKey && !hasTimingSource) {
    return 'No changes provided';
  }

  if (hasLabel && typeof nextLabel !== 'string') {
    return 'label must be a string';
  }

  if (hasLabel && nextLabel.trim().length > MAX_VERSION_LABEL_LENGTH) {
    return `Label must be ${MAX_VERSION_LABEL_LENGTH} characters or fewer`;
  }

  if (
    hasTempo &&
    (payload.tempoBpm !== null &&
      (typeof payload.tempoBpm !== 'number' || !Number.isFinite(payload.tempoBpm) || !isValidTempoBpm(payload.tempoBpm)))
  ) {
    return 'Tempo must be between 20 and 300 BPM';
  }

  if (hasTimeSignature) {
    const normalized = normalizeTimeSignature({
      num: 'timeSignatureNum' in payload ? payload.timeSignatureNum : undefined,
      den: 'timeSignatureDen' in payload ? payload.timeSignatureDen : undefined,
    });

    if (!VALID_DENOMINATORS.has(normalized.den)) {
      return 'Time signature denominator must be a standard musical denominator';
    }
  }

  if ('tempoSource' in payload && payload.tempoSource !== undefined && !VALID_TIMING_SOURCES.has(payload.tempoSource)) {
    return 'Invalid tempo source';
  }

  if ('keySource' in payload && payload.keySource !== undefined && !VALID_TIMING_SOURCES.has(payload.keySource)) {
    return 'Invalid key source';
  }

  return null;
}

function validateCollaborativeNotePayload(
  payload:
    | DawOperationPayloadCommentAdded
    | DawOperationPayloadCommentUpdated
    | DawOperationPayloadCommentDeleted
    | DawOperationPayloadAnnotationAdded
    | DawOperationPayloadAnnotationUpdated
    | DawOperationPayloadAnnotationDeleted,
  noteKind: 'comment' | 'annotation',
) {
  if (!isNonEmptyString(payload.body)) {
    return `${noteKind} body cannot be empty`;
  }

  if (!isNonEmptyString(payload.createdBy)) {
    return `${noteKind} creator is required`;
  }

  if (!payload.trackId && payload.segmentId) {
    return `trackId is required when anchoring a ${noteKind} to a segment`;
  }

  if (
    payload.startTimeMs !== null &&
    (typeof payload.startTimeMs !== 'number' || !Number.isFinite(payload.startTimeMs) || payload.startTimeMs < 0)
  ) {
    return `${noteKind} startTimeMs must be a non-negative number`;
  }

  if (
    payload.endTimeMs !== null &&
    (typeof payload.endTimeMs !== 'number' || !Number.isFinite(payload.endTimeMs) || payload.endTimeMs < 0)
  ) {
    return `${noteKind} endTimeMs must be a non-negative number`;
  }

  if (payload.startTimeMs !== null && payload.endTimeMs !== null && payload.endTimeMs < payload.startTimeMs) {
    return `${noteKind} endTimeMs must be greater than or equal to startTimeMs`;
  }

  return null;
}

type SegmentFadeValidationSegment = {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  fadeInMs: number;
  fadeOutMs: number;
  position: number;
};

type SegmentCrossfadeValidationSegment = MergeableSegment;

function materializeFadeValidationSegment(segment: {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  fadeInMs: number;
  fadeOutMs: number;
  position: number;
  trackVersion: {
    startOffsetMs: number;
  };
}): SegmentFadeValidationSegment {
  return {
    id: segment.id,
    trackVersionId: segment.trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs: segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    position: segment.position,
  };
}

function materializeCrossfadeValidationSegment(segment: {
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number | null;
  position: number;
  isImplicit?: boolean | null;
  trackVersion: {
    startOffsetMs: number;
  };
}): SegmentCrossfadeValidationSegment {
  const timelineStartMs = segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs;
  return {
    id: segment.id,
    trackVersionId: segment.trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
    timelineEndMs: timelineStartMs + Math.max(0, segment.endMs - segment.startMs),
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: segment.position,
    isImplicit: segment.isImplicit ?? false,
  };
}

export function validateSegmentFadeSelection(
  segment: SegmentFadeValidationSegment,
  payload: {
    fadeInMs: number;
    fadeOutMs: number;
  },
) {
  if (!segment || !isFiniteNumber(segment.startMs) || !isFiniteNumber(segment.endMs)) {
    return 'Segment not found';
  }

  if (!isFiniteNumber(payload.fadeInMs) || !isFiniteNumber(payload.fadeOutMs)) {
    return 'Fade durations must be finite numbers';
  }

  if (payload.fadeInMs < 0 || payload.fadeOutMs < 0) {
    return 'Fade durations must be non-negative';
  }

  const segmentDurationMs = Math.max(0, segment.endMs - segment.startMs);
  if (payload.fadeInMs + payload.fadeOutMs > segmentDurationMs + CROSSFADE_EPSILON_MS) {
    return 'Fade duration cannot exceed the clip duration.';
  }

  return null;
}

export function validateSegmentCrossfadeSelection(
  leftSegment: SegmentCrossfadeValidationSegment,
  rightSegment: SegmentCrossfadeValidationSegment,
  payload: {
    crossfadeInMs: number;
    crossfadeOutMs: number;
    curve: string | null;
  },
) {
  const candidateError = getCrossfadeCandidateError(leftSegment, rightSegment);
  if (candidateError) {
    return candidateError;
  }

  if (!isFiniteNumber(payload.crossfadeInMs) || !isFiniteNumber(payload.crossfadeOutMs)) {
    return 'Crossfade durations must be finite numbers';
  }

  if (payload.crossfadeInMs < 0 || payload.crossfadeOutMs < 0) {
    return 'Crossfade durations must be non-negative';
  }

  if (payload.curve !== null && !isNonEmptyString(payload.curve)) {
    return 'Crossfade curve must be a non-empty string or null';
  }

  const leftDurationMs = Math.max(0, leftSegment.endMs - leftSegment.startMs);
  const rightDurationMs = Math.max(0, rightSegment.endMs - rightSegment.startMs);

  if (
    payload.crossfadeOutMs > leftDurationMs + CROSSFADE_EPSILON_MS ||
    payload.crossfadeInMs > rightDurationMs + CROSSFADE_EPSILON_MS
  ) {
    return CROSSFADE_DURATION_ERROR;
  }

  return null;
}

function materializeMergeValidationSegment(segment: {
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
  trackVersion: {
    startOffsetMs: number;
  };
}): MergeableSegment {
  return {
    id: segment.id,
    trackVersionId: segment.trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs: segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs,
    gainDb: segment.gainDb,
    fadeInMs: segment.fadeInMs,
    fadeOutMs: segment.fadeOutMs,
    isMuted: segment.isMuted,
    position: segment.position,
    isImplicit: false,
  };
}

function areMergedSegmentsEquivalent(
  expected: ReturnType<typeof buildMergedSegmentFromPair>,
  actual: DawSegmentSnapshot,
) {
  return (
    expected.id === actual.id &&
    expected.trackVersionId === actual.trackVersionId &&
    expected.startMs === actual.startMs &&
    expected.endMs === actual.endMs &&
    expected.timelineStartMs === actual.timelineStartMs &&
    expected.timelineEndMs === actual.timelineEndMs &&
    expected.gainDb === actual.gainDb &&
    expected.fadeInMs === actual.fadeInMs &&
    expected.fadeOutMs === actual.fadeOutMs &&
    expected.isMuted === actual.isMuted &&
    expected.position === actual.position &&
    (expected.crossfadeInMs ?? null) === (actual.crossfadeInMs ?? null) &&
    (expected.crossfadeOutMs ?? null) === (actual.crossfadeOutMs ?? null) &&
    (expected.crossfadeCurve ?? null) === (actual.crossfadeCurve ?? null)
  );
}

export function validateSegmentMergeSelection(
  firstSegment: MergeableSegment,
  secondSegment: MergeableSegment,
  mergedSegment: DawSegmentSnapshot,
) {
  const validationError = getMergeCandidateError(firstSegment, secondSegment);
  if (validationError) {
    return validationError;
  }

  const expectedMergedSegment = buildMergedSegmentFromPair(firstSegment, secondSegment, {
    id: mergedSegment.id,
  });

  if (!areMergedSegmentsEquivalent(expectedMergedSegment, mergedSegment)) {
    return 'Merged segment does not match the selected clips';
  }

  return null;
}

async function resolveDawProjectWorkspace(
  client: DawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    userId: string;
  },
): Promise<DawProjectWorkspace | null> {
  const demo = await client.demo.findFirst({
    where: {
      id: input.demoId,
      project: {
        id: input.projectId,
        group: {
          members: {
            some: {
              userId: input.userId,
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      currentVersionId: true,
      project: {
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          group: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!demo) {
    return null;
  }

  const membership = await client.groupMember.findFirst({
    where: {
      groupId: demo.project.group.id,
      userId: input.userId,
    },
    select: {
      role: true,
    },
  });

  const role = (membership?.role ?? 'MEMBER') as DawProjectRole;
  return {
    project: {
      id: demo.project.id,
      slug: demo.project.slug,
      name: demo.project.name,
      description: demo.project.description,
      group: {
        id: demo.project.group.id,
        slug: demo.project.group.slug,
      },
    },
    demo: {
      id: demo.id,
      name: demo.name,
      description: demo.description,
      // Fallback seed only; the viewer's live checkout comes from DemoUserActiveVersion.
      currentVersionId: demo.currentVersionId,
    },
    permissions: {
      role,
      canRead: true,
      canWrite: true,
      canManageProject: role === 'OWNER' || role === 'ADMIN',
    },
  };
}

async function loadOperationBySequence(
  client: DawDatabaseClient,
  input: {
    demoId: string;
    operationSeq: number;
  },
): Promise<DawProjectOperationRecord | null> {
  const row = await client.projectOperationLog.findUnique({
    where: {
      demoId_operationSeq: {
        demoId: input.demoId,
        operationSeq: input.operationSeq,
      },
    },
    select: {
      id: true,
      projectId: true,
      demoId: true,
      operationType: true,
      createdAt: true,
      actorUserId: true,
      baseSnapshotId: true,
      baseOperationSeq: true,
      operationSeq: true,
      payload: true,
      idempotencyKey: true,
      clientOperationId: true,
    },
  });

  if (!row) {
    return null;
  }

  const operationRow: DemoDawSnapshotOperationRow = {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    type: row.operationType as DawOperationType,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    baseSnapshotId: row.baseSnapshotId,
    baseOperationSeq: row.baseOperationSeq,
    operationSeq: row.operationSeq,
    payload: row.payload as DemoDawSnapshotOperationRow['payload'],
    idempotencyKey: row.idempotencyKey,
    clientOperationId: row.clientOperationId,
  };

  return serializeProjectOperation(operationRow);
}

async function loadOperationByIdempotencyKey(
  client: DawDatabaseClient,
  input: {
    demoId: string;
    idempotencyKey: string;
  },
) {
  const row = await client.projectOperationLog.findUnique({
    where: {
      demoId_idempotencyKey: {
        demoId: input.demoId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
      projectId: true,
      demoId: true,
      operationType: true,
      createdAt: true,
      actorUserId: true,
      baseSnapshotId: true,
      baseOperationSeq: true,
      operationSeq: true,
      payload: true,
      idempotencyKey: true,
      clientOperationId: true,
    },
  });

  if (!row) {
    return null;
  }

  const operationRow: DemoDawSnapshotOperationRow = {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    type: row.operationType as DawOperationType,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    baseSnapshotId: row.baseSnapshotId,
    baseOperationSeq: row.baseOperationSeq,
    operationSeq: row.operationSeq,
    payload: row.payload as DemoDawSnapshotOperationRow['payload'],
    idempotencyKey: row.idempotencyKey,
    clientOperationId: row.clientOperationId,
  };

  return serializeProjectOperation(operationRow);
}

async function loadOperationByClientOperationId(
  client: DawDatabaseClient,
  input: {
    demoId: string;
    clientOperationId: string;
  },
) {
  const row = await client.projectOperationLog.findUnique({
    where: {
      demoId_clientOperationId: {
        demoId: input.demoId,
        clientOperationId: input.clientOperationId,
      },
    },
    select: {
      id: true,
      projectId: true,
      demoId: true,
      operationType: true,
      createdAt: true,
      actorUserId: true,
      baseSnapshotId: true,
      baseOperationSeq: true,
      operationSeq: true,
      payload: true,
      idempotencyKey: true,
      clientOperationId: true,
    },
  });

  if (!row) {
    return null;
  }

  const operationRow: DemoDawSnapshotOperationRow = {
    id: row.id,
    projectId: row.projectId,
    demoId: row.demoId,
    type: row.operationType as DawOperationType,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    baseSnapshotId: row.baseSnapshotId,
    baseOperationSeq: row.baseOperationSeq,
    operationSeq: row.operationSeq,
    payload: row.payload as DemoDawSnapshotOperationRow['payload'],
    idempotencyKey: row.idempotencyKey,
    clientOperationId: row.clientOperationId,
  };

  return serializeProjectOperation(operationRow);
}

async function executeOperationMutation(
  client: DawDatabaseClient,
  workspace: DawProjectWorkspace,
  request: DawOperationCommitRequest,
  actorUserId: string,
): Promise<DawOperationExecutionResult> {
  switch (request.operationType) {
    case 'TRACK_RENAMED': {
      const validationError = validateTrackName(request.payload.trackName);
      if (validationError) {
        throw new Error(validationError);
      }

      const track = await client.track.findFirst({
        where: {
          id: request.payload.trackId,
          demo: {
            id: workspace.demo.id,
            projectId: workspace.project.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (!track) {
        throw new Error('Track not found');
      }

      await client.track.update({
        where: {
          id: track.id,
        },
        data: {
          name: request.payload.trackName.trim(),
        },
        select: {
          id: true,
        },
      });

      return {
        logPayload: {
          trackId: track.id,
          trackName: request.payload.trackName.trim(),
        },
      };
    }

    case 'TRACK_OFFSET_UPDATED': {
      const { startOffsetMs, trackVersionId } = request.payload;
      if (typeof startOffsetMs !== 'number' || !Number.isFinite(startOffsetMs) || startOffsetMs < 0) {
        throw new Error('startOffsetMs must be a non-negative number');
      }

      const trackVersion = await client.trackVersion.findFirst({
        where: {
          id: trackVersionId,
          track: {
            demo: {
              id: workspace.demo.id,
              projectId: workspace.project.id,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!trackVersion) {
        throw new Error('Track version not found');
      }

      await client.trackVersion.update({
        where: {
          id: trackVersion.id,
        },
        data: {
          startOffsetMs,
        },
        select: {
          id: true,
        },
      });

      return {
        logPayload: {
          trackVersionId: trackVersion.id,
          startOffsetMs,
        },
      };
    }

    case 'SEGMENT_MOVED': {
      const {
        segmentId,
        fromTrackVersionId,
        toTrackVersionId,
        fromTimelineStartMs,
        fromTimelineEndMs,
        toTimelineStartMs,
        toTimelineEndMs,
      } = request.payload;

      if (typeof segmentId !== 'string' || segmentId.trim().length === 0) {
        throw new Error('segmentId is required');
      }
      if (typeof fromTrackVersionId !== 'string' || fromTrackVersionId.trim().length === 0) {
        throw new Error('fromTrackVersionId is required');
      }
      if (typeof toTrackVersionId !== 'string' || toTrackVersionId.trim().length === 0) {
        throw new Error('toTrackVersionId is required');
      }
      if (
        typeof fromTimelineStartMs !== 'number' ||
        !Number.isFinite(fromTimelineStartMs) ||
        fromTimelineStartMs < 0
      ) {
        throw new Error('fromTimelineStartMs must be a non-negative number');
      }
      if (typeof fromTimelineEndMs !== 'number' || !Number.isFinite(fromTimelineEndMs) || fromTimelineEndMs < 0) {
        throw new Error('fromTimelineEndMs must be a non-negative number');
      }
      if (typeof toTimelineStartMs !== 'number' || !Number.isFinite(toTimelineStartMs) || toTimelineStartMs < 0) {
        throw new Error('toTimelineStartMs must be a non-negative number');
      }
      if (typeof toTimelineEndMs !== 'number' || !Number.isFinite(toTimelineEndMs) || toTimelineEndMs <= toTimelineStartMs) {
        throw new Error('toTimelineEndMs must be greater than toTimelineStartMs');
      }

      const [sourceTrackVersion, targetTrackVersion] = await Promise.all([
        client.trackVersion.findFirst({
          where: {
            id: fromTrackVersionId,
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
          select: {
            id: true,
          },
        }),
        client.trackVersion.findFirst({
          where: {
            id: toTrackVersionId,
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
          select: {
            id: true,
          },
        }),
      ]);

      if (!sourceTrackVersion || !targetTrackVersion) {
        throw new Error('Track version not found');
      }

      const segment = await client.segment.findFirst({
        where: {
          id: segmentId,
          trackVersionId: fromTrackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          position: true,
          trackVersion: {
            select: {
              startOffsetMs: true,
            },
          },
        },
      });

      if (!segment) {
        throw new Error('Segment not found');
      }

      const sourceDurationMs = segment.endMs - segment.startMs;
      const currentTimelineStartMs = segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs;
      const currentTimelineEndMs = currentTimelineStartMs + sourceDurationMs;
      if (
        Math.abs(currentTimelineStartMs - fromTimelineStartMs) > 0.001 ||
        Math.abs(currentTimelineEndMs - fromTimelineEndMs) > 0.001
      ) {
        throw new Error('Segment bounds no longer match the saved clip');
      }

      if (fromTrackVersionId !== toTrackVersionId) {
        await client.segment.updateMany({
          where: {
            trackVersionId: fromTrackVersionId,
            position: {
              gt: segment.position,
            },
          },
          data: {
            position: {
              decrement: 1,
            },
          },
        });

        await client.segment.update({
          where: {
            id: segment.id,
          },
          data: {
            trackVersionId: toTrackVersionId,
            timelineStartMs: toTimelineStartMs,
            position: await client.segment.count({
              where: {
                trackVersionId: toTrackVersionId,
              },
            }),
          },
          select: {
            id: true,
          },
        });
      } else {
        await client.segment.update({
          where: {
            id: segment.id,
          },
          data: {
            timelineStartMs: toTimelineStartMs,
          },
          select: {
            id: true,
          },
        });
      }

      return {
        logPayload: {
          segmentId: segment.id,
          fromTrackVersionId,
          toTrackVersionId,
          fromTimelineStartMs,
          fromTimelineEndMs,
          toTimelineStartMs,
          toTimelineEndMs,
        },
      };
    }

    case 'SEGMENT_DELETED': {
      const { segmentId, trackVersionId } = request.payload;

      const segment = await client.segment.findFirst({
        where: {
          id: segmentId,
          trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          position: true,
        },
      });

      if (!segment) {
        throw new Error('Segment not found');
      }

      await client.segment.delete({
        where: {
          id: segment.id,
        },
      });

      await client.segment.updateMany({
        where: {
          trackVersionId,
          position: {
            gt: segment.position,
          },
        },
        data: {
          position: {
            decrement: 1,
          },
        },
      });

      return {
        logPayload: {
          trackVersionId,
          segmentId: segment.id,
        },
      };
    }

    case 'SEGMENT_TRIMMED': {
      const payload = request.payload;
      const nextStartMs = payload.to.startMs;
      const nextEndMs = payload.to.endMs;
      if (
        typeof nextStartMs !== 'number' ||
        !Number.isFinite(nextStartMs) ||
        typeof nextEndMs !== 'number' ||
        !Number.isFinite(nextEndMs) ||
        nextEndMs <= nextStartMs
      ) {
        throw new Error('Trim bounds must be valid finite numbers');
      }

      const segment = await client.segment.findFirst({
        where: {
          id: payload.segmentId,
          trackVersionId: payload.trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          trackVersionId: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          gainDb: true,
          fadeInMs: true,
          fadeOutMs: true,
          isMuted: true,
          position: true,
        },
      });

      if (!segment) {
        throw new Error('Segment not found');
      }

      await client.segment.update({
        where: { id: segment.id },
        data: {
          startMs: nextStartMs,
          endMs: nextEndMs,
        },
      });

      return {
        logPayload: {
          trackVersionId: payload.trackVersionId,
          segmentId: segment.id,
          from: payload.from,
          to: payload.to,
        },
      };
    }

    case 'SEGMENT_FADE_SET': {
      const payload = request.payload;
      if (
        !isFiniteNumber(payload.fadeInMs) ||
        !isFiniteNumber(payload.fadeOutMs) ||
        payload.fadeInMs < 0 ||
        payload.fadeOutMs < 0
      ) {
        throw new Error('Fade durations must be non-negative finite numbers');
      }

      const segment = await client.segment.findFirst({
        where: {
          id: payload.segmentId,
          trackVersionId: payload.trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          trackVersionId: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          fadeInMs: true,
          fadeOutMs: true,
          position: true,
          trackVersion: {
            select: {
              startOffsetMs: true,
            },
          },
        },
      });

      if (!segment) {
        throw new Error('Segment not found');
      }

      const validationError = validateSegmentFadeSelection(materializeFadeValidationSegment(segment), payload);
      if (validationError) {
        throw new Error(validationError);
      }

      await client.segment.update({
        where: { id: segment.id },
        data: {
          fadeInMs: payload.fadeInMs,
          fadeOutMs: payload.fadeOutMs,
        },
      });

      return {
        logPayload: {
          trackVersionId: payload.trackVersionId,
          segmentId: segment.id,
          fadeInMs: payload.fadeInMs,
          fadeOutMs: payload.fadeOutMs,
          previousFadeInMs: segment.fadeInMs,
          previousFadeOutMs: segment.fadeOutMs,
        },
      };
    }

    case 'SEGMENT_MERGED': {
      const payload = request.payload;
      if (!Array.isArray(payload.segmentIds) || payload.segmentIds.length !== 2) {
        throw new Error('Exactly two segmentIds are required');
      }

      const segmentIds = new Set(payload.segmentIds);
      if (segmentIds.size !== 2) {
        throw new Error('segmentIds must contain two different clips');
      }

      if (!payload.mergedSegment || payload.mergedSegment.trackVersionId !== payload.trackVersionId) {
        throw new Error('Merged segment must belong to the target track');
      }

      if (!isNonEmptyString(payload.mergedSegment.id)) {
        throw new Error('Merged segment id is required');
      }

      if (segmentIds.has(payload.mergedSegment.id)) {
        throw new Error('Merged segment id must be new');
      }

      const orderedSegments = await client.segment.findMany({
        where: {
          trackVersionId: payload.trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        orderBy: {
          position: 'asc',
        },
        select: {
          id: true,
          trackVersionId: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          gainDb: true,
          fadeInMs: true,
          fadeOutMs: true,
          isMuted: true,
          position: true,
          trackVersion: {
            select: {
              startOffsetMs: true,
            },
          },
        },
      });

      const selectedSegments = orderedSegments.filter((segment) => segmentIds.has(segment.id));
      if (selectedSegments.length !== 2) {
        throw new Error('Segments not found');
      }

      const [firstSegment, secondSegment] = sortSegmentsForMerge(
        materializeMergeValidationSegment(selectedSegments[0]!),
        materializeMergeValidationSegment(selectedSegments[1]!),
      );
      const validationError = validateSegmentMergeSelection(firstSegment, secondSegment, payload.mergedSegment);
      if (validationError) {
        throw new Error(validationError);
      }

      const mergedSegment = buildMergedSegmentFromPair(firstSegment, secondSegment, {
        id: payload.mergedSegment.id,
      });
      const insertAt = Math.min(firstSegment.position, secondSegment.position);
      const remaining = orderedSegments.filter((segment) => !segmentIds.has(segment.id));
      const nextSegments: Array<(typeof orderedSegments)[number] | typeof mergedSegment> = [...remaining];
      nextSegments.splice(Math.min(insertAt, nextSegments.length), 0, mergedSegment);

      for (const segment of selectedSegments) {
        await client.segment.delete({ where: { id: segment.id } });
      }

      await client.segment.create({
        data: {
          id: mergedSegment.id,
          trackVersionId: mergedSegment.trackVersionId,
          startMs: mergedSegment.startMs,
          endMs: mergedSegment.endMs,
          timelineStartMs: mergedSegment.timelineStartMs,
          gainDb: mergedSegment.gainDb,
          fadeInMs: mergedSegment.fadeInMs,
          fadeOutMs: mergedSegment.fadeOutMs,
          isMuted: mergedSegment.isMuted,
          position: insertAt,
        },
        select: {
          id: true,
        },
      });

      for (let index = 0; index < nextSegments.length; index += 1) {
        const segment = nextSegments[index];
        if (segment.id === mergedSegment.id) {
          await client.segment.update({
            where: { id: segment.id },
            data: {
              startMs: segment.startMs,
              endMs: segment.endMs,
              timelineStartMs: segment.timelineStartMs,
              gainDb: segment.gainDb,
              fadeInMs: segment.fadeInMs,
              fadeOutMs: segment.fadeOutMs,
              isMuted: segment.isMuted,
              position: index,
            },
          });
          continue;
        }

        await client.segment.update({
          where: { id: segment.id },
          data: {
            position: index,
          },
        });
      }

      return {
        logPayload: {
          trackVersionId: payload.trackVersionId,
          segmentIds: [firstSegment.id, secondSegment.id],
          mergedSegment,
        },
      };
    }

    case 'CROSSFADE_SET': {
      const payload = request.payload;
      if (
        typeof payload.crossfadeInMs !== 'number' ||
        !Number.isFinite(payload.crossfadeInMs) ||
        typeof payload.crossfadeOutMs !== 'number' ||
        !Number.isFinite(payload.crossfadeOutMs)
      ) {
        throw new Error('Crossfade durations must be finite numbers');
      }

      if (payload.crossfadeInMs < 0 || payload.crossfadeOutMs < 0) {
        throw new Error('Crossfade durations must be non-negative');
      }

      const leftSegment = await client.segment.findFirst({
        where: {
          id: payload.leftSegmentId,
          trackVersionId: payload.trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          trackVersionId: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          position: true,
          trackVersion: {
            select: {
              startOffsetMs: true,
            },
          },
        },
      });

      const rightSegment = await client.segment.findFirst({
        where: {
          id: payload.rightSegmentId,
          trackVersionId: payload.trackVersionId,
          trackVersion: {
            track: {
              demo: {
                id: workspace.demo.id,
                projectId: workspace.project.id,
              },
            },
          },
        },
        select: {
          id: true,
          trackVersionId: true,
          startMs: true,
          endMs: true,
          timelineStartMs: true,
          position: true,
          trackVersion: {
            select: {
              startOffsetMs: true,
            },
          },
        },
      });

      if (!leftSegment || !rightSegment) {
        throw new Error('Segment not found');
      }

      const validationError = validateSegmentCrossfadeSelection(
        materializeCrossfadeValidationSegment(leftSegment),
        materializeCrossfadeValidationSegment(rightSegment),
        {
          crossfadeInMs: payload.crossfadeInMs,
          crossfadeOutMs: payload.crossfadeOutMs,
          curve: payload.curve,
        },
      );
      if (validationError) {
        throw new Error(validationError);
      }

      return {
        logPayload: {
          trackVersionId: payload.trackVersionId,
          leftSegmentId: payload.leftSegmentId,
          rightSegmentId: payload.rightSegmentId,
          crossfadeInMs: payload.crossfadeInMs,
          crossfadeOutMs: payload.crossfadeOutMs,
          curve: payload.curve,
        },
      };
    }

    case 'SEGMENT_SPLIT': {
      const payload = request.payload;

      if (
        typeof payload.segmentStartMs !== 'number' ||
        !Number.isFinite(payload.segmentStartMs) ||
        typeof payload.segmentEndMs !== 'number' ||
        !Number.isFinite(payload.segmentEndMs) ||
        typeof payload.splitTimeMs !== 'number' ||
        !Number.isFinite(payload.splitTimeMs)
      ) {
        throw new Error('segmentStartMs, segmentEndMs, and splitTimeMs must be finite numbers');
      }

      if (payload.segmentEndMs <= payload.segmentStartMs) {
        throw new Error('segmentEndMs must be greater than segmentStartMs');
      }

      const trackVersion = await client.trackVersion.findFirst({
        where: {
          id: payload.trackVersionId,
          track: {
            demo: {
              id: workspace.demo.id,
              projectId: workspace.project.id,
            },
          },
        },
        select: {
          id: true,
          startOffsetMs: true,
        },
      });

      if (!trackVersion) {
        throw new Error('Track version not found');
      }

      const existingSegmentsCount = await client.segment.count({
        where: {
          trackVersionId: trackVersion.id,
        },
      });

      const existingSegment = isNonEmptyString(payload.segmentId)
        ? await client.segment.findFirst({
            where: {
              id: payload.segmentId,
              trackVersionId: trackVersion.id,
            },
            select: {
              id: true,
              startMs: true,
              endMs: true,
              timelineStartMs: true,
              gainDb: true,
              fadeInMs: true,
              fadeOutMs: true,
              isMuted: true,
              position: true,
            },
          })
        : null;

      if (payload.segmentId && !existingSegment) {
        throw new Error('Segment not found');
      }

      if (!payload.segmentId && existingSegmentsCount > 0) {
        throw new Error('segmentId is required when the track version already has persisted segments');
      }

      const baseSegment =
        existingSegment ?? {
          id: `implicit:${trackVersion.id}`,
          startMs: payload.segmentStartMs,
          endMs: payload.segmentEndMs,
          timelineStartMs: trackVersion.startOffsetMs,
          gainDb: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          isMuted: false,
          position: 0,
        };

      if (
        existingSegment &&
        (Math.abs(existingSegment.startMs - payload.segmentStartMs) > 0.001 ||
          Math.abs(existingSegment.endMs - payload.segmentEndMs) > 0.001)
      ) {
        throw new Error('Segment bounds no longer match the saved clip');
      }

      const { leftSegment, rightSegment } = splitSegment(baseSegment, payload.splitTimeMs, MIN_SPLIT_DISTANCE_MS);

      if (existingSegment) {
        await client.segment.updateMany({
          where: {
            trackVersionId: trackVersion.id,
            position: {
              gt: existingSegment.position,
            },
          },
          data: {
            position: {
              increment: 1,
            },
          },
        });

        await client.segment.update({
          where: {
            id: existingSegment.id,
          },
          data: {
            startMs: leftSegment.startMs,
            endMs: leftSegment.endMs,
            timelineStartMs: leftSegment.timelineStartMs,
            gainDb: leftSegment.gainDb,
            fadeInMs: leftSegment.fadeInMs,
            fadeOutMs: leftSegment.fadeOutMs,
            isMuted: leftSegment.isMuted,
            position: leftSegment.position,
          },
        });

        const right = await client.segment.create({
          data: {
            trackVersionId: trackVersion.id,
            startMs: rightSegment.startMs,
            endMs: rightSegment.endMs,
            timelineStartMs: rightSegment.timelineStartMs,
            gainDb: rightSegment.gainDb,
            fadeInMs: rightSegment.fadeInMs,
            fadeOutMs: rightSegment.fadeOutMs,
            isMuted: rightSegment.isMuted,
            position: rightSegment.position,
          },
          select: {
            id: true,
          },
        });

        return {
          logPayload: {
            trackVersionId: trackVersion.id,
            sourceSegmentId: existingSegment.id,
            leftSegment: serializeSegmentSnapshot(trackVersion.id, {
              ...existingSegment,
              startMs: leftSegment.startMs,
              endMs: leftSegment.endMs,
              timelineStartMs:
                leftSegment.timelineStartMs ?? trackVersion.startOffsetMs + leftSegment.startMs,
            }),
            rightSegment: serializeSegmentSnapshot(trackVersion.id, {
              id: right.id,
              startMs: rightSegment.startMs,
              endMs: rightSegment.endMs,
              timelineStartMs:
                rightSegment.timelineStartMs ?? trackVersion.startOffsetMs + rightSegment.startMs,
              gainDb: rightSegment.gainDb,
              fadeInMs: rightSegment.fadeInMs,
              fadeOutMs: rightSegment.fadeOutMs,
              isMuted: rightSegment.isMuted,
              position: rightSegment.position,
            }),
          },
        };
      }

      const left = await client.segment.create({
        data: {
          trackVersionId: trackVersion.id,
          startMs: leftSegment.startMs,
          endMs: leftSegment.endMs,
          timelineStartMs: leftSegment.timelineStartMs,
          gainDb: leftSegment.gainDb,
          fadeInMs: leftSegment.fadeInMs,
          fadeOutMs: leftSegment.fadeOutMs,
          isMuted: leftSegment.isMuted,
          position: leftSegment.position,
        },
        select: {
          id: true,
        },
      });

      const right = await client.segment.create({
        data: {
          trackVersionId: trackVersion.id,
          startMs: rightSegment.startMs,
          endMs: rightSegment.endMs,
          timelineStartMs: rightSegment.timelineStartMs,
          gainDb: rightSegment.gainDb,
          fadeInMs: rightSegment.fadeInMs,
          fadeOutMs: rightSegment.fadeOutMs,
          isMuted: rightSegment.isMuted,
          position: rightSegment.position,
        },
        select: {
          id: true,
        },
      });

      return {
        logPayload: {
          trackVersionId: trackVersion.id,
          sourceSegmentId: null,
          leftSegment: serializeSegmentSnapshot(trackVersion.id, {
            id: left.id,
            startMs: leftSegment.startMs,
            endMs: leftSegment.endMs,
            timelineStartMs:
              leftSegment.timelineStartMs ?? trackVersion.startOffsetMs + leftSegment.startMs,
            gainDb: leftSegment.gainDb,
            fadeInMs: leftSegment.fadeInMs,
            fadeOutMs: leftSegment.fadeOutMs,
            isMuted: leftSegment.isMuted,
            position: leftSegment.position,
          }),
          rightSegment: serializeSegmentSnapshot(trackVersion.id, {
            id: right.id,
            startMs: rightSegment.startMs,
            endMs: rightSegment.endMs,
            timelineStartMs:
              rightSegment.timelineStartMs ?? trackVersion.startOffsetMs + rightSegment.startMs,
            gainDb: rightSegment.gainDb,
            fadeInMs: rightSegment.fadeInMs,
            fadeOutMs: rightSegment.fadeOutMs,
            isMuted: rightSegment.isMuted,
            position: rightSegment.position,
          }),
        },
      };
    }

    case 'VERSION_RENAMED': {
      const payload = request.payload as DawOperationPayloadVersionRenamed;
      const nextLabel = (payload.label ?? payload.name ?? payload.branchName ?? '').trim();
      if (!nextLabel) {
        throw new Error('Label is required');
      }

      const version = await client.demoVersion.findFirst({
        where: {
          id: payload.versionId,
          demo: {
            project: {
              id: workspace.project.id,
            },
          },
        },
        select: {
          id: true,
          label: true,
        },
      });

      if (!version) {
        throw new Error('Version not found');
      }

      const updated = await client.demoVersion.update({
        where: {
          id: version.id,
        },
        data: {
          label: nextLabel,
        },
        select: {
          id: true,
          label: true,
        },
      });

      return {
        logPayload: {
          versionId: updated.id,
          label: updated.label,
        },
      };
    }

    case 'VERSION_SELECTED':
    case 'CURRENT_VERSION_CHANGED': {
      const payload = request.payload as { currentVersionId: string; previousVersionId?: string | null };
      const version = await client.demoVersion.findFirst({
        where: {
          id: payload.currentVersionId,
          demo: {
            project: {
              id: workspace.project.id,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!version) {
        throw new Error('Version not found');
      }

      // Deprecated compatibility path: keep accepting legacy checkout mutations
      // from old logs/clients, but store them in the per-user active-version row
      // instead of the demo row and do not treat them as the shared checkout.
      await setDemoUserActiveVersion(client, {
        projectId: workspace.project.id,
        demoId: workspace.demo.id,
        userId: actorUserId,
        versionId: version.id,
        isFollowingHead: true,
      });

      return {
        logPayload: {
          previousVersionId: payload.previousVersionId ?? null,
          currentVersionId: version.id,
        },
      };
    }

    case 'VERSION_TIMING_UPDATED': {
      const validationError = validateVersionTimingPayload(request.payload);
      if (validationError) {
        throw new Error(validationError);
      }

      const version = await client.demoVersion.findFirst({
        where: {
          id: request.payload.versionId,
          demo: {
            id: workspace.demo.id,
            projectId: workspace.project.id,
          },
        },
        select: {
          id: true,
          label: true,
          tempoBpm: true,
          timeSignatureNum: true,
          timeSignatureDen: true,
          musicalKey: true,
          tempoSource: true,
          keySource: true,
        },
      });

      if (!version) {
        throw new Error('Version not found');
      }

      const nextLabel = 'label' in request.payload ? request.payload.label?.trim() : undefined;
      let normalizedTimeSignature:
        | {
            num: number;
            den: number;
          }
        | null = null;

      if ('timeSignatureNum' in request.payload || 'timeSignatureDen' in request.payload) {
        normalizedTimeSignature = normalizeTimeSignature({
          num: 'timeSignatureNum' in request.payload ? request.payload.timeSignatureNum : undefined,
          den: 'timeSignatureDen' in request.payload ? request.payload.timeSignatureDen : undefined,
        });
      }

      const nextTempoBpm = 'tempoBpm' in request.payload ? request.payload.tempoBpm ?? null : version.tempoBpm;
      const nextMusicalKey =
        'musicalKey' in request.payload ? request.payload.musicalKey?.trim() || null : version.musicalKey;
      const nextTempoSource = request.payload.tempoSource ?? version.tempoSource;
      const nextKeySource = request.payload.keySource ?? version.keySource;

      const updated = await client.demoVersion.update({
        where: {
          id: version.id,
        },
        data: {
          ...(nextLabel !== undefined ? { label: nextLabel } : {}),
          ...(request.payload.tempoBpm !== undefined ? { tempoBpm: nextTempoBpm } : {}),
          ...(normalizedTimeSignature
            ? {
                timeSignatureNum: normalizedTimeSignature.num,
                timeSignatureDen: normalizedTimeSignature.den,
              }
            : {}),
          ...(request.payload.musicalKey !== undefined ? { musicalKey: nextMusicalKey } : {}),
          ...(request.payload.tempoSource !== undefined ? { tempoSource: nextTempoSource } : {}),
          ...(request.payload.keySource !== undefined ? { keySource: nextKeySource } : {}),
        },
        select: {
          id: true,
          label: true,
          tempoBpm: true,
          timeSignatureNum: true,
          timeSignatureDen: true,
          musicalKey: true,
          tempoSource: true,
          keySource: true,
        },
      });

      return {
        logPayload: {
          versionId: updated.id,
          label: updated.label,
          tempoBpm: updated.tempoBpm,
          timeSignatureNum: updated.timeSignatureNum,
          timeSignatureDen: updated.timeSignatureDen,
          musicalKey: updated.musicalKey,
          tempoSource: updated.tempoSource,
          keySource: updated.keySource,
        },
        forceCheckpoint: true,
      };
    }
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED':
    case 'COMMENT_DELETED': {
      const payload = request.payload as
        | DawOperationPayloadCommentAdded
        | DawOperationPayloadCommentUpdated
        | DawOperationPayloadCommentDeleted;
      const validationError = validateCollaborativeNotePayload(payload, 'comment');
      if (validationError) {
        throw new Error(validationError);
      }

      return {
        logPayload: {
          ...payload,
        },
      };
    }
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED':
    case 'ANNOTATION_DELETED': {
      const payload = request.payload as
        | DawOperationPayloadAnnotationAdded
        | DawOperationPayloadAnnotationUpdated
        | DawOperationPayloadAnnotationDeleted;
      const validationError = validateCollaborativeNotePayload(payload, 'annotation');
      if (validationError) {
        throw new Error(validationError);
      }

      return {
        logPayload: {
          ...payload,
        },
      };
    }
    default:
      throw new Error(`Unsupported operation type: ${request.operationType}`);
  }
}

function findIdempotentOperation(
  client: DawDatabaseClient,
  request: DawOperationCommitRequest & { clientOperationId: string },
) {
  return Promise.all([
    loadOperationByIdempotencyKey(client, {
      demoId: request.demoId,
      idempotencyKey: request.idempotencyKey ?? '',
    }),
    request.clientOperationId
      ? loadOperationByClientOperationId(client, {
          demoId: request.demoId,
          clientOperationId: request.clientOperationId,
        })
      : Promise.resolve(null),
  ]).then(([byIdempotency, byClientOperationId]) => byIdempotency ?? byClientOperationId);
}

function translateRequestForBranch(
  request: DawOperationCommitRequest & { clientOperationId: string },
  branchVersionId: string,
  cloneMap: {
    trackVersionIdMap: Map<string, string>;
    segmentIdMap: Map<string, string>;
  },
): DawOperationCommitRequest & { clientOperationId: string } {
  const translateTrackVersionId = (trackVersionId: string) =>
    cloneMap.trackVersionIdMap.get(trackVersionId) ?? trackVersionId;
  const translateSegmentId = (segmentId?: string | null) =>
    segmentId ? cloneMap.segmentIdMap.get(segmentId) ?? segmentId : segmentId ?? null;

  switch (request.operationType) {
    case 'TRACK_RENAMED':
      return request;
    case 'TRACK_OFFSET_UPDATED':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
        },
      };
    case 'SEGMENT_SPLIT':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'SEGMENT_MOVED':
      return {
        ...request,
        payload: {
          ...request.payload,
          fromTrackVersionId: translateTrackVersionId(request.payload.fromTrackVersionId),
          toTrackVersionId: translateTrackVersionId(request.payload.toTrackVersionId),
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'SEGMENT_DELETED':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'SEGMENT_TRIMMED':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'SEGMENT_FADE_SET':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'SEGMENT_MERGED':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          segmentIds: request.payload.segmentIds.map((segmentId) => translateSegmentId(segmentId) ?? segmentId),
          mergedSegment: {
            ...request.payload.mergedSegment,
            trackVersionId: translateTrackVersionId(request.payload.mergedSegment.trackVersionId),
          },
        },
      };
    case 'CROSSFADE_SET':
      return {
        ...request,
        payload: {
          ...request.payload,
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
          leftSegmentId: translateSegmentId(request.payload.leftSegmentId) ?? request.payload.leftSegmentId,
          rightSegmentId: translateSegmentId(request.payload.rightSegmentId) ?? request.payload.rightSegmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'VERSION_TIMING_UPDATED':
      return {
        ...request,
        payload: {
          ...request.payload,
          versionId: branchVersionId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED':
    case 'COMMENT_DELETED':
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED':
    case 'ANNOTATION_DELETED':
      return {
        ...request,
        payload: {
          ...request.payload,
          segmentId: translateSegmentId(request.payload.segmentId) ?? request.payload.segmentId,
        },
      } as DawOperationCommitRequest & { clientOperationId: string };
    default:
      return request;
  }
}

export async function loadDawProjectBootstrap(
  client: DawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    userId: string;
    operationSeq?: number | null;
  },
): Promise<DawProjectBootstrapResponse | null> {
  const workspace = await resolveDawProjectWorkspace(client, input);
  if (!workspace) return null;

  const latestSnapshotRow = await loadLatestDemoSnapshot(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  });
  const targetOperationSeq =
    typeof input.operationSeq === 'number' && Number.isFinite(input.operationSeq)
      ? input.operationSeq
      : null;
  const historicalSnapshotRow =
    targetOperationSeq !== null
      ? await loadLatestDemoSnapshotAtOrBeforeOperationSeq(
          client,
          {
            projectId: workspace.project.id,
            demoId: workspace.demo.id,
          },
          targetOperationSeq,
        )
      : latestSnapshotRow;
  const afterSeq = historicalSnapshotRow?.operationSeq ?? 0;

  const [activeVersionState, operationTail, assets, pluginDefinitions] = await Promise.all([
    loadOrCreateDemoUserActiveVersionState(client, {
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      userId: input.userId,
    }),
    targetOperationSeq === null
      ? loadDemoOperationTail(
          client,
          {
            projectId: workspace.project.id,
            demoId: workspace.demo.id,
          },
          afterSeq,
        )
      : Promise.resolve<DemoDawSnapshotOperationRow[]>([]),
    client.audioAssetMetadata.findMany({
      where: {
        projectId: workspace.project.id,
        demoId: workspace.demo.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        projectId: true,
        demoId: true,
        trackId: true,
        trackVersionId: true,
        assetKind: true,
        storageKey: true,
        mimeType: true,
        sampleRate: true,
        bitDepth: true,
        channelCount: true,
        durationMs: true,
        sizeBytes: true,
        checksum: true,
        parentAssetId: true,
        createdAt: true,
      },
    }),
    client.pluginMetadata.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        pluginKey: true,
        name: true,
        version: true,
        manufacturer: true,
        parameterSchema: true,
        createdAt: true,
      },
    }),
  ]);

  const presenceSeed = createProjectPresenceSeed({
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
    userId: input.userId,
  });
  const projectState = (await loadSnapshotStateForDemo(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  }, {
    operationSeq: targetOperationSeq,
  })) as DemoDawSnapshotData;

  return {
    project: {
      ...workspace.project,
      demoId: workspace.demo.id,
      // Shared head metadata only. The viewer checkout is carried separately
      // through DemoUserActiveVersion and must not be inferred from this field.
      currentVersionId: projectState.currentVersionId ?? workspace.demo.currentVersionId,
    },
    latestSnapshot: serializeSnapshotRow(historicalSnapshotRow),
    activeVersionId: activeVersionState.activeVersionId,
    isFollowingHead: activeVersionState.isFollowingHead,
    activeBranchName: activeVersionState.activeBranchName,
    projectState: projectState as unknown as JsonValue,
    operationTail: operationTail.map((row) => serializeProjectOperation(row)),
    assets: assets.map((asset) => serializeAsset(asset)),
    pluginDefinitions: pluginDefinitions.map((plugin) => serializePluginDefinition(plugin)),
    comments: projectState.comments as unknown as JsonValue,
    annotations: projectState.annotations as unknown as JsonValue,
    presenceSeed,
    permissions: workspace.permissions,
  };
}

export async function setUserActiveVersion(
  client: DawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    userId: string;
    activeVersionId: string;
    isFollowingHead?: boolean;
  },
): Promise<DemoUserActiveVersionState | null> {
  const workspace = await resolveDawProjectWorkspace(client, input);
  if (!workspace) return null;

  const activeVersionState = await loadOrCreateDemoUserActiveVersionState(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
    userId: input.userId,
    currentActiveVersionId: input.activeVersionId,
    isFollowingHead: input.isFollowingHead,
  });

  if (!activeVersionState) {
    throw new Error('Project not found');
  }

  return {
    activeVersionId: activeVersionState.activeVersionId,
    isFollowingHead: activeVersionState.isFollowingHead,
    activeBranchName: activeVersionState.activeBranchName,
  };
}

export async function commitDawProjectOperation(
  client: PrismaClient,
  input: {
    projectId: string;
    userId: string;
    request: DawOperationCommitRequest;
  },
): Promise<
  | { operation: DawProjectOperationRecord; created: boolean; conflict: null }
  | {
      operation: null;
      created: false;
      conflict: {
        reason: string;
        conflictingOperationIds: string[];
        conflictingOperationSeqs: number[];
        branchVersion: {
          id: string;
          label: string;
          parentId: string | null;
        } | null;
      };
    }
> {
  const resolvedWorkspace = await resolveDawProjectWorkspace(client, {
    projectId: input.projectId,
    demoId: input.request.demoId,
    userId: input.userId,
  });

  if (!resolvedWorkspace) {
    throw new Error('Project not found');
  }
  const workspace: DawProjectWorkspace = resolvedWorkspace;
  const activeVersionState = await loadOrCreateDemoUserActiveVersionState(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
    userId: input.userId,
  });
  const checkoutVersionId = activeVersionState.activeVersionId ?? workspace.demo.currentVersionId;
  const latestSnapshotRow = await loadLatestDemoSnapshot(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  });
  const latestSnapshotId = latestSnapshotRow?.id ?? null;

  const request = {
    ...input.request,
    clientOperationId: input.request.clientOperationId ?? randomUUID(),
  } satisfies DawOperationCommitRequest & { clientOperationId: string };

  const existing = await findIdempotentOperation(client, request);
  if (existing) {
    return {
      operation: existing,
      created: false,
      conflict: null,
    };
  }

  let result:
    | { operation: DawProjectOperationRecord; created: boolean; conflict: null }
    | {
        operation: null;
        created: false;
        conflict: {
          reason: string;
          conflictingOperationIds: string[];
          conflictingOperationSeqs: number[];
          branchVersion: {
            id: string;
            label: string;
            parentId: string | null;
          } | null;
        };
      };
  let versionTreeChanged = false;
  let timelineBranchOperation: DawProjectOperationRecord | null = null;

  try {
    result = await client.$transaction(async (tx) => {
      let effectiveRequest = request;
      let branchedFromHistoricalBase = false;
      const baseSnapshotId = request.baseSnapshotId ?? null;
      const shouldCreateBranchForRequest = shouldCreateBranchForOperation(effectiveRequest.operationType);

      if (
        shouldCreateBranchForRequest &&
        baseSnapshotId &&
        shouldBranchFromHistoricalBase({ baseSnapshotId, latestSnapshotId })
      ) {
        const sourceVersion = await tx.demoVersion.findFirst({
          where: {
            id: baseSnapshotId,
            demoId: workspace.demo.id,
          },
          select: {
            id: true,
            label: true,
          },
        });

        if (sourceVersion) {
          const branchVersion = await createDemoVersionWithCopiedTracks(tx, {
            demoId: workspace.demo.id,
            sourceVersionId: sourceVersion.id,
            parentId: sourceVersion.id,
            label: `${sourceVersion.label} branch`,
            description: `Branch created from ${sourceVersion.label}.`,
          });

          await setDemoUserActiveVersion(tx, {
            projectId: workspace.project.id,
            demoId: workspace.demo.id,
            userId: input.userId,
            versionId: branchVersion.id,
            isFollowingHead: true,
          });

          versionTreeChanged = true;

          effectiveRequest = translateRequestForBranch(request, branchVersion.id, branchVersion.cloneMap);
          branchedFromHistoricalBase = true;
        }
      }

      if (!branchedFromHistoricalBase) {
        const conflict = await analyzeDawOperationConflict(tx, workspace, effectiveRequest);
        if (conflict) {
          let branchVersion:
            | {
                id: string;
                label: string;
                parentId: string | null;
              }
            | null = null;

          if (shouldCreateBranchForRequest && checkoutVersionId) {
            const currentVersion = await tx.demoVersion.findFirst({
              where: {
                id: checkoutVersionId,
                demoId: workspace.demo.id,
              },
              select: {
                id: true,
                label: true,
              },
            });

            if (currentVersion) {
              const createdBranch = await createDemoVersionWithCopiedTracks(tx, {
                demoId: workspace.demo.id,
                sourceVersionId: currentVersion.id,
                parentId: currentVersion.id,
                label: `${currentVersion.label} conflict`,
                description: `Conflict branch created while applying ${effectiveRequest.operationType}.`,
              });

              branchVersion = {
                id: createdBranch.id,
                label: createdBranch.label,
                parentId: createdBranch.parentId,
              };
              versionTreeChanged = true;
            }
          }

          return {
            operation: null,
            created: false,
            conflict: {
              reason: conflict.reason,
              conflictingOperationIds: conflict.conflictingOperationIds,
              conflictingOperationSeqs: conflict.conflictingOperationSeqs,
              branchVersion,
            },
          };
        }
      }

      if (shouldCreateBranchForRequest && isTimelineEditOperation(effectiveRequest.operationType)) {
        if (!checkoutVersionId) {
          throw new Error('No active version available to branch from');
        }

        const branchSourceVersion = await tx.demoVersion.findFirst({
          where: {
            id: checkoutVersionId,
            demoId: workspace.demo.id,
          },
          select: {
            id: true,
            label: true,
          },
        });

        if (!branchSourceVersion) {
          throw new Error('Version not found');
        }

        const branchLabel = getTimelineEditBranchLabel(effectiveRequest.operationType);
        if (!branchLabel) {
          throw new Error(`No branch label available for ${effectiveRequest.operationType}`);
        }
        const branchVersion = await createDemoVersionWithCopiedTracks(tx, {
          demoId: workspace.demo.id,
          sourceVersionId: branchSourceVersion.id,
          parentId: branchSourceVersion.id,
          label: branchLabel,
          description: `${branchLabel} from ${branchSourceVersion.label}`,
        });

        await setDemoUserActiveVersion(tx, {
          projectId: workspace.project.id,
          demoId: workspace.demo.id,
          userId: input.userId,
          versionId: branchVersion.id,
          isFollowingHead: true,
        });

        const branchOperation = await recordDemoDawOperation(
          tx,
          {
            projectId: workspace.project.id,
            demoId: workspace.demo.id,
            actorUserId: input.userId,
            operationType: 'VERSION_BRANCH_CREATED',
            payload: {
              versionId: branchVersion.id,
              parentVersionId: branchVersion.parentId,
              branchName: branchVersion.label,
              branchMode: 'continue',
              label: branchVersion.label,
              createdAt: branchVersion.createdAt.toISOString(),
              createdBy: input.userId,
              operationSummary: branchVersion.description,
              sourceVersionId: branchSourceVersion.id,
              version: serializeCreatedDemoVersionTreeNode({
                id: branchVersion.id,
                label: branchVersion.label,
                description: branchVersion.description,
                parentId: branchVersion.parentId,
                createdAt: branchVersion.createdAt,
                branchMode: 'continue',
                tempoBpm: branchVersion.tempoBpm,
                timeSignatureNum: branchVersion.timeSignatureNum,
                timeSignatureDen: branchVersion.timeSignatureDen,
                musicalKey: branchVersion.musicalKey,
                tempoSource: branchVersion.tempoSource,
                keySource: branchVersion.keySource,
                isCurrent: true,
                tracks: branchVersion.tracks,
              }),
            },
          },
          {
            checkpointCreatedById: input.userId,
          },
        );

        timelineBranchOperation = await loadOperationBySequence(tx, {
          demoId: workspace.demo.id,
          operationSeq: branchOperation.operationSeq,
        });

        versionTreeChanged = true;
        effectiveRequest = translateRequestForBranch(effectiveRequest, branchVersion.id, branchVersion.cloneMap);
      }

      const execution = await executeOperationMutation(tx, workspace, effectiveRequest, input.userId);

      const record = await recordDemoDawOperation(
        tx,
        {
          projectId: workspace.project.id,
          demoId: workspace.demo.id,
          actorUserId: input.userId,
          operationType: effectiveRequest.operationType,
          payload: execution.logPayload as DemoDawOperationPayload,
          idempotencyKey: effectiveRequest.idempotencyKey,
          clientOperationId: effectiveRequest.clientOperationId,
        },
        {
          checkpointCreatedById: input.userId,
          checkpointTailOperations: effectiveRequest.checkpointTailOperations,
          forceCheckpoint: execution.forceCheckpoint,
        },
      );
      if (shouldBroadcastVersionTreeChanged(effectiveRequest.operationType)) {
        versionTreeChanged = true;
      }

      const operation = await loadOperationBySequence(tx, {
        demoId: workspace.demo.id,
        operationSeq: record.operationSeq,
      });

      if (!operation) {
        throw new Error('Accepted operation could not be reloaded');
      }

      return {
        operation,
        created: record.created,
        conflict: null,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await findIdempotentOperation(client, request);
      if (existing) {
        return {
          operation: existing,
          created: false,
          conflict: null,
        };
      }
    }
    throw error;
  }

  if (timelineBranchOperation) {
    await emitAcceptedDawOperation({
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      operation: timelineBranchOperation,
    });
  }

  if (result.created && result.operation) {
    await emitAcceptedDawOperation({
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      operation: result.operation,
    });
  }

  if (versionTreeChanged) {
    await emitDawVersionTreeChanged({
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      actorUserId: input.userId,
    });
  }

  return result;
}

export async function loadDawProjectOperations(
  client: DawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    userId: string;
    afterSeq: number;
  },
): Promise<DawProjectOperationRecord[] | null> {
  const workspace = await resolveDawProjectWorkspace(client, input);
  if (!workspace) return null;

  return loadDemoOperationTail(
    client,
    {
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
    },
    input.afterSeq,
  ).then((rows) => rows.map((row) => serializeProjectOperation(row)));
}

export async function loadDawProjectSnapshotSequence(
  client: DawDatabaseClient,
  input: {
    projectId: string;
    demoId: string;
    userId: string;
  },
) {
  const workspace = await resolveDawProjectWorkspace(client, input);
  if (!workspace) return null;

  const latestSnapshot = await loadLatestDemoSnapshot(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  });

  return latestSnapshot?.operationSeq ?? 0;
}
