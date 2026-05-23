import { Prisma, PrismaClient } from '@git-for-music/db';
import { randomUUID } from 'node:crypto';
import {
  loadDemoOperationTail,
  loadLatestDemoSnapshot,
  loadSnapshotStateForDemo,
  recordDemoDawOperation,
  type DemoDawOperationPayload,
  type DemoDawSnapshotOperationRow,
} from '@/features/daw/server/snapshot-builder';
import { analyzeDawOperationConflict } from '@/features/daw/server/conflict-rules';
import { splitSegment, MIN_SPLIT_DISTANCE_MS } from '@/features/daw/utils/segments';
import { isValidTempoBpm, normalizeTimeSignature } from '@/features/daw/utils/timing';
import {
  createProjectPresenceSeed,
  emitAcceptedDawOperation,
} from '@/features/daw/server/realtime-gateway';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
  return {
    id: segment.id,
    trackVersionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    timelineStartMs,
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
      const { segmentId, timelineStartMs, trackVersionId } = request.payload;
      if (typeof timelineStartMs !== 'number' || !Number.isFinite(timelineStartMs) || timelineStartMs < 0) {
        throw new Error('timelineStartMs must be a non-negative number');
      }

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
          trackVersionId: true,
        },
      });

      if (!segment) {
        throw new Error('Segment not found');
      }

      await client.segment.update({
        where: {
          id: segment.id,
        },
        data: {
          timelineStartMs,
        },
        select: {
          id: true,
        },
      });

      return {
        logPayload: {
          trackVersionId,
          segmentId: segment.id,
          timelineStartMs,
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

    case 'SEGMENT_MERGED': {
      const payload = request.payload;
      if (!Array.isArray(payload.segmentIds) || payload.segmentIds.length === 0) {
        throw new Error('segmentIds must not be empty');
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
        },
      });

      const segmentIds = new Set(payload.segmentIds);
      const mergedIndex = orderedSegments.findIndex((segment) => segment.id === payload.mergedSegment.id);
      if (mergedIndex < 0 && !segmentIds.has(payload.mergedSegment.id)) {
        throw new Error('Merged segment not found');
      }

      const removedIndexes = orderedSegments
        .map((segment, index) => (segmentIds.has(segment.id) ? index : -1))
        .filter((index) => index >= 0);
      if (removedIndexes.length === 0) {
        throw new Error('Segments not found');
      }

      const insertAt = removedIndexes[0];
      const remaining = orderedSegments.filter((segment) => !segmentIds.has(segment.id) || segment.id === payload.mergedSegment.id);
      const nextSegments = [...remaining];
      const mergedSegment = {
        ...payload.mergedSegment,
        trackVersionId: payload.trackVersionId,
      };

      const existingMergedIndex = nextSegments.findIndex((segment) => segment.id === mergedSegment.id);
      if (existingMergedIndex >= 0) {
        nextSegments[existingMergedIndex] = mergedSegment;
      } else {
        nextSegments.splice(Math.min(insertAt, nextSegments.length), 0, mergedSegment);
      }

      for (const segment of orderedSegments) {
        if (segmentIds.has(segment.id) && segment.id !== mergedSegment.id) {
          await client.segment.delete({ where: { id: segment.id } });
        }
      }

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
          segmentIds: payload.segmentIds,
          mergedSegment: payload.mergedSegment,
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
        },
      });

      if (!leftSegment || !rightSegment) {
        throw new Error('Segment not found');
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
          trackVersionId: translateTrackVersionId(request.payload.trackVersionId),
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
  },
): Promise<DawProjectBootstrapResponse | null> {
  const workspace = await resolveDawProjectWorkspace(client, input);
  if (!workspace) return null;

  const latestSnapshotRow = await loadLatestDemoSnapshot(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  });
  const afterSeq = latestSnapshotRow?.operationSeq ?? 0;

  const [operationTail, assets, pluginDefinitions] = await Promise.all([
    loadDemoOperationTail(
      client,
      {
        projectId: workspace.project.id,
        demoId: workspace.demo.id,
      },
      afterSeq,
    ),
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
  const projectState = await loadSnapshotStateForDemo(client, {
    projectId: workspace.project.id,
    demoId: workspace.demo.id,
  });

  return {
    project: {
      ...workspace.project,
      demoId: workspace.demo.id,
      currentVersionId: workspace.demo.currentVersionId,
    },
    latestSnapshot: serializeSnapshotRow(latestSnapshotRow),
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
  let workspace: DawProjectWorkspace = resolvedWorkspace;

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

  try {
    result = await client.$transaction(async (tx) => {
      let effectiveRequest = request;
      let branchedFromHistoricalBase = false;

      if (request.baseSnapshotId && request.baseSnapshotId !== workspace.demo.currentVersionId) {
        const sourceVersion = await tx.demoVersion.findFirst({
          where: {
            id: request.baseSnapshotId,
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

          await tx.demo.update({
            where: {
              id: workspace.demo.id,
            },
            data: {
              currentVersionId: branchVersion.id,
            },
            select: {
              id: true,
            },
          });

          workspace = {
            ...workspace,
            demo: {
              ...workspace.demo,
              currentVersionId: branchVersion.id,
            },
          };

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

          if (workspace.demo.currentVersionId) {
            const currentVersion = await tx.demoVersion.findFirst({
              where: {
                id: workspace.demo.currentVersionId,
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

      const execution = await executeOperationMutation(tx, workspace, effectiveRequest);

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

  if (result.created && result.operation) {
    await emitAcceptedDawOperation({
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      operation: result.operation,
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
