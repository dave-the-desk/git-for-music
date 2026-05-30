import type { Prisma, PrismaClient } from '@git-for-music/db';
import type { DawOperationCommitRequest, DawProjectOperationRecord } from '@/features/daw/protocol';

type DawConflictDbClient = PrismaClient | Prisma.TransactionClient;

export type DawOperationConflictScope =
  | {
      kind: 'track-metadata';
      trackId: string;
      field: 'trackName';
      payloadSignature: string;
    }
  | {
      kind: 'track-timeline';
      trackId: string | null;
      trackVersionId: string;
      segmentId: string | null;
      range: { startMs: number; endMs: number } | null;
      payloadSignature: string;
    }
  | {
      kind: 'version-timing';
      versionId: string;
      fields: Set<string>;
      fieldValues: Map<string, unknown>;
      payloadSignature: string;
    }
  | {
      kind: 'comment';
      commentId: string;
      payloadSignature: string;
    }
  | {
      kind: 'annotation';
      annotationId: string;
      payloadSignature: string;
    };

export type DawOperationConflictResult = {
  reason: string;
  conflictingOperationIds: string[];
  conflictingOperationSeqs: number[];
};

type DawConflictWorkspace = {
  project: {
    id: string;
  };
  demo: {
    id: string;
    currentVersionId: string | null;
  };
};

const VERSION_TIMING_FIELDS = new Set([
  'label',
  'tempoBpm',
  'timeSignatureNum',
  'timeSignatureDen',
  'musicalKey',
  'tempoSource',
  'keySource',
]);

function stableSignature(value: unknown) {
  return JSON.stringify(value, (_key, next) =>
    next instanceof Set ? [...next].sort() : next instanceof Map ? [...next.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))) : next,
  );
}

function rangeFrom(startMs: number, endMs: number) {
  return {
    startMs: Math.min(startMs, endMs),
    endMs: Math.max(startMs, endMs),
  };
}

function rangeFromMovePayload(payload: {
  fromTimelineStartMs: number;
  fromTimelineEndMs: number;
  toTimelineStartMs: number;
  toTimelineEndMs: number;
}) {
  return rangeFrom(
    Math.min(payload.fromTimelineStartMs, payload.toTimelineStartMs),
    Math.max(payload.fromTimelineEndMs, payload.toTimelineEndMs),
  );
}

function rangesOverlap(
  left: { startMs: number; endMs: number } | null,
  right: { startMs: number; endMs: number } | null,
) {
  if (!left || !right) return true;
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

async function resolveTrackVersionTrackId(
  client: DawConflictDbClient,
  workspace: DawConflictWorkspace,
  trackVersionId: string,
) {
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
      trackId: true,
    },
  });

  return trackVersion?.trackId ?? null;
}

async function resolveSegmentScope(
  client: DawConflictDbClient,
  workspace: DawConflictWorkspace,
  input: {
    trackVersionId: string;
    segmentId?: string | null;
    fallbackRange?: { startMs: number; endMs: number } | null;
  },
): Promise<{
  trackId: string | null;
  trackVersionId: string;
  segmentId: string | null;
  range: { startMs: number; endMs: number } | null;
} | null> {
  const trackId = await resolveTrackVersionTrackId(client, workspace, input.trackVersionId);
  if (!trackId) return null;

  if (!input.segmentId) {
    return {
      trackId,
      trackVersionId: input.trackVersionId,
      segmentId: null,
      range: input.fallbackRange ?? null,
    };
  }

  const segment = await client.segment.findFirst({
    where: {
      id: input.segmentId,
      trackVersionId: input.trackVersionId,
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
      trackVersion: {
        select: {
          startOffsetMs: true,
        },
      },
    },
  });

  if (!segment) {
    return {
      trackId,
      trackVersionId: input.trackVersionId,
      segmentId: input.segmentId,
      range: input.fallbackRange ?? null,
    };
  }

  const startMs = segment.timelineStartMs ?? segment.trackVersion.startOffsetMs + segment.startMs;
  const endMs = startMs + (segment.endMs - segment.startMs);

  return {
    trackId,
    trackVersionId: input.trackVersionId,
    segmentId: segment.id,
    range: rangeFrom(startMs, endMs),
  };
}

async function resolveRequestScope(
  client: DawConflictDbClient,
  workspace: DawConflictWorkspace,
  request: DawOperationCommitRequest,
): Promise<DawOperationConflictScope | null> {
  switch (request.operationType) {
    case 'TRACK_RENAMED':
      return {
        kind: 'track-metadata',
        trackId: request.targetTrackId ?? request.payload.trackId,
        field: 'trackName',
        payloadSignature: stableSignature({ trackId: request.payload.trackId, trackName: request.payload.trackName.trim() }),
      };
    case 'TRACK_OFFSET_UPDATED': {
      const trackId = request.targetTrackId ?? (await resolveTrackVersionTrackId(client, workspace, request.payload.trackVersionId));
      if (!trackId) return null;
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: request.payload.trackVersionId,
        segmentId: null,
        range: { startMs: 0, endMs: Number.POSITIVE_INFINITY },
        payloadSignature: stableSignature({
          trackVersionId: request.payload.trackVersionId,
          startOffsetMs: request.payload.startOffsetMs,
        }),
      };
    }
    case 'SEGMENT_SPLIT': {
      const trackVersionId = request.payload.trackVersionId;
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId,
        segmentId: request.payload.segmentId ?? request.targetSegmentId,
        fallbackRange: rangeFrom(request.payload.segmentStartMs, request.payload.segmentEndMs),
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        payloadSignature: stableSignature({
          trackVersionId,
          segmentId: request.payload.segmentId ?? null,
          segmentStartMs: request.payload.segmentStartMs,
          segmentEndMs: request.payload.segmentEndMs,
          splitTimeMs: request.payload.splitTimeMs,
        }),
      };
    }
    case 'SEGMENT_MOVED': {
      const moveRange = rangeFromMovePayload(request.payload);
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: request.payload.fromTrackVersionId,
        segmentId: request.payload.segmentId ?? request.targetSegmentId,
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        range: scope.range ? rangeFrom(Math.min(scope.range.startMs, moveRange.startMs), Math.max(scope.range.endMs, moveRange.endMs)) : moveRange,
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'SEGMENT_DELETED': {
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.payload.segmentId ?? request.targetSegmentId,
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'SEGMENT_TRIMMED': {
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.payload.segmentId ?? request.targetSegmentId,
        fallbackRange: rangeFrom(request.payload.to.startMs, request.payload.to.endMs),
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'SEGMENT_MERGED': {
      const trackId = request.targetTrackId ?? (await resolveTrackVersionTrackId(client, workspace, request.payload.trackVersionId));
      if (!trackId) return null;
      const merged = request.payload.mergedSegment;
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.targetSegmentId ?? null,
        range: rangeFrom(
          merged.timelineStartMs ?? merged.startMs,
          (merged.timelineStartMs ?? merged.startMs) + (merged.endMs - merged.startMs),
        ),
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'CROSSFADE_SET': {
      const trackId = request.targetTrackId ?? (await resolveTrackVersionTrackId(client, workspace, request.payload.trackVersionId));
      if (!trackId) return null;
      const left = await resolveSegmentScope(client, workspace, {
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.payload.leftSegmentId,
      });
      const right = await resolveSegmentScope(client, workspace, {
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.payload.rightSegmentId,
      });
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: request.payload.trackVersionId,
        segmentId: request.targetSegmentId ?? request.payload.leftSegmentId ?? request.payload.rightSegmentId ?? null,
        range:
          left?.range && right?.range
            ? rangeFrom(Math.min(left.range.startMs, right.range.startMs), Math.max(left.range.endMs, right.range.endMs))
            : left?.range ?? right?.range ?? null,
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'VERSION_TIMING_UPDATED': {
      const fieldValues = new Map<string, unknown>();
      for (const field of VERSION_TIMING_FIELDS) {
        if (field in request.payload) {
          fieldValues.set(field, (request.payload as unknown as Record<string, unknown>)[field]);
        }
      }
      return {
        kind: 'version-timing',
        versionId: request.payload.versionId,
        fields: new Set(fieldValues.keys()),
        fieldValues,
        payloadSignature: stableSignature(request.payload),
      };
    }
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED':
    case 'COMMENT_DELETED':
      return {
        kind: 'comment',
        commentId: request.payload.commentId,
        payloadSignature: stableSignature(request.payload),
      };
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED':
    case 'ANNOTATION_DELETED':
      return {
        kind: 'annotation',
        annotationId: request.payload.annotationId,
        payloadSignature: stableSignature(request.payload),
      };
    default:
      return null;
  }
}

async function resolveExistingOperationScope(
  client: DawConflictDbClient,
  workspace: DawConflictWorkspace,
  operation: DawProjectOperationRecord,
): Promise<DawOperationConflictScope | null> {
  switch (operation.type) {
    case 'TRACK_RENAMED': {
      const payload = operation.payload as { trackId: string; trackName: string };
      return {
        kind: 'track-metadata',
        trackId: payload.trackId,
        field: 'trackName',
        payloadSignature: stableSignature({ trackId: payload.trackId, trackName: payload.trackName }),
      };
    }
    case 'TRACK_OFFSET_UPDATED': {
      const payload = operation.payload as { trackVersionId: string; startOffsetMs: number };
      const trackId = await resolveTrackVersionTrackId(client, workspace, payload.trackVersionId);
      if (!trackId) return null;
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: payload.trackVersionId,
        segmentId: null,
        range: { startMs: 0, endMs: Number.POSITIVE_INFINITY },
        payloadSignature: stableSignature(payload),
      };
    }
    case 'SEGMENT_SPLIT': {
      const payload = operation.payload as {
        trackVersionId: string;
        sourceSegmentId: string | null;
        leftSegment: { timelineStartMs: number; startMs: number; endMs: number };
        rightSegment: { timelineStartMs: number; startMs: number; endMs: number };
      };
      const trackId = await resolveTrackVersionTrackId(client, workspace, payload.trackVersionId);
      if (!trackId) return null;
      const start = Math.min(
        payload.leftSegment.timelineStartMs ?? payload.leftSegment.startMs,
        payload.rightSegment.timelineStartMs ?? payload.rightSegment.startMs,
      );
      const end = Math.max(
        (payload.leftSegment.timelineStartMs ?? payload.leftSegment.startMs) +
          (payload.leftSegment.endMs - payload.leftSegment.startMs),
        (payload.rightSegment.timelineStartMs ?? payload.rightSegment.startMs) +
          (payload.rightSegment.endMs - payload.rightSegment.startMs),
      );
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: payload.trackVersionId,
        segmentId: payload.sourceSegmentId,
        range: rangeFrom(start, end),
        payloadSignature: stableSignature({
          trackVersionId: payload.trackVersionId,
          sourceSegmentId: payload.sourceSegmentId,
          leftSegment: payload.leftSegment,
          rightSegment: payload.rightSegment,
        }),
      };
    }
    case 'SEGMENT_MOVED': {
      const payload = operation.payload as {
        segmentId: string;
        fromTrackVersionId: string;
        toTrackVersionId: string;
        fromTimelineStartMs: number;
        fromTimelineEndMs: number;
        toTimelineStartMs: number;
        toTimelineEndMs: number;
      };
      const moveRange = rangeFromMovePayload(payload);
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: payload.fromTrackVersionId,
        segmentId: payload.segmentId,
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        range: scope.range ? rangeFrom(Math.min(scope.range.startMs, moveRange.startMs), Math.max(scope.range.endMs, moveRange.endMs)) : moveRange,
        payloadSignature: stableSignature(payload),
      };
    }
    case 'SEGMENT_DELETED': {
      const payload = operation.payload as { trackVersionId: string; segmentId: string };
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: payload.trackVersionId,
        segmentId: payload.segmentId,
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        payloadSignature: stableSignature(payload),
      };
    }
    case 'SEGMENT_TRIMMED': {
      const payload = operation.payload as {
        trackVersionId: string;
        segmentId: string;
        from: { startMs: number; endMs: number };
        to: { startMs: number; endMs: number };
      };
      const scope = await resolveSegmentScope(client, workspace, {
        trackVersionId: payload.trackVersionId,
        segmentId: payload.segmentId,
        fallbackRange: rangeFrom(payload.to.startMs, payload.to.endMs),
      });
      if (!scope) return null;
      return {
        kind: 'track-timeline',
        ...scope,
        payloadSignature: stableSignature(payload),
      };
    }
    case 'SEGMENT_MERGED': {
      const payload = operation.payload as {
        trackVersionId: string;
        segmentIds: string[];
        mergedSegment: {
          timelineStartMs: number;
          startMs: number;
          endMs: number;
        };
      };
      const trackId = await resolveTrackVersionTrackId(client, workspace, payload.trackVersionId);
      if (!trackId) return null;
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: payload.trackVersionId,
        segmentId: payload.segmentIds[0] ?? null,
        range: rangeFrom(
          payload.mergedSegment.timelineStartMs ?? payload.mergedSegment.startMs,
          (payload.mergedSegment.timelineStartMs ?? payload.mergedSegment.startMs) +
            (payload.mergedSegment.endMs - payload.mergedSegment.startMs),
        ),
        payloadSignature: stableSignature(payload),
      };
    }
    case 'CROSSFADE_SET': {
      const payload = operation.payload as {
        trackVersionId: string;
        leftSegmentId: string;
        rightSegmentId: string;
        crossfadeInMs: number;
        crossfadeOutMs: number;
        curve: string | null;
      };
      const trackId = await resolveTrackVersionTrackId(client, workspace, payload.trackVersionId);
      if (!trackId) return null;
      const left = await resolveSegmentScope(client, workspace, {
        trackVersionId: payload.trackVersionId,
        segmentId: payload.leftSegmentId,
      });
      const right = await resolveSegmentScope(client, workspace, {
        trackVersionId: payload.trackVersionId,
        segmentId: payload.rightSegmentId,
      });
      return {
        kind: 'track-timeline',
        trackId,
        trackVersionId: payload.trackVersionId,
        segmentId: payload.leftSegmentId ?? payload.rightSegmentId ?? null,
        range:
          left?.range && right?.range
            ? rangeFrom(Math.min(left.range.startMs, right.range.startMs), Math.max(left.range.endMs, right.range.endMs))
            : left?.range ?? right?.range ?? null,
        payloadSignature: stableSignature(payload),
      };
    }
    case 'VERSION_TIMING_UPDATED': {
      const payload = operation.payload as {
        versionId: string;
        label?: string;
        tempoBpm?: number | null;
        timeSignatureNum?: number;
        timeSignatureDen?: number;
        musicalKey?: string | null;
        tempoSource?: string;
        keySource?: string;
      };
      const fieldValues = new Map<string, unknown>();
      for (const field of VERSION_TIMING_FIELDS) {
        if (field in payload) {
          fieldValues.set(field, payload[field as keyof typeof payload]);
        }
      }
      return {
        kind: 'version-timing',
        versionId: payload.versionId,
        fields: new Set(fieldValues.keys()),
        fieldValues,
        payloadSignature: stableSignature(payload),
      };
    }
    case 'COMMENT_ADDED':
    case 'COMMENT_UPDATED':
    case 'COMMENT_DELETED':
      {
        const payload = operation.payload as {
          commentId: string;
          demoId: string;
          trackId: string | null;
          segmentId: string | null;
          startTimeMs: number | null;
          endTimeMs: number | null;
          body: string;
          createdBy: string;
          resolved: boolean;
        };
        return {
          kind: 'comment',
          commentId: payload.commentId,
          payloadSignature: stableSignature(payload),
        };
      }
    case 'ANNOTATION_ADDED':
    case 'ANNOTATION_UPDATED':
    case 'ANNOTATION_DELETED':
      {
        const payload = operation.payload as {
          annotationId: string;
          demoId: string;
          trackId: string | null;
          segmentId: string | null;
          startTimeMs: number | null;
          endTimeMs: number | null;
          body: string;
          createdBy: string;
          resolved: boolean;
        };
        return {
          kind: 'annotation',
          annotationId: payload.annotationId,
          payloadSignature: stableSignature(payload),
        };
      }
    default:
      return null;
  }
}

function conflictReasonForScopes(left: DawOperationConflictScope, right: DawOperationConflictScope) {
  if (left.kind === 'version-timing' && right.kind === 'version-timing' && left.versionId === right.versionId) {
    const sharedFields = [...left.fields].filter((field) => right.fields.has(field));
    const conflictingField = sharedFields.find((field) => left.fieldValues.get(field) !== right.fieldValues.get(field));
    if (conflictingField) {
      return `Version timing conflict on ${conflictingField}`;
    }
    return null;
  }

  if (left.kind === 'comment' && right.kind === 'comment' && left.commentId === right.commentId) {
    return left.payloadSignature === right.payloadSignature ? null : 'Same comment edited differently from the same base';
  }

  if (left.kind === 'annotation' && right.kind === 'annotation' && left.annotationId === right.annotationId) {
    return left.payloadSignature === right.payloadSignature ? null : 'Same annotation edited differently from the same base';
  }

  if (left.kind === 'track-metadata' && right.kind === 'track-metadata' && left.trackId === right.trackId) {
    return left.payloadSignature === right.payloadSignature ? null : 'Track metadata conflict';
  }

  if (left.kind === 'track-timeline' && right.kind === 'track-timeline' && left.trackVersionId === right.trackVersionId) {
    if (left.segmentId && right.segmentId && left.segmentId === right.segmentId) {
      return left.payloadSignature === right.payloadSignature ? null : 'Same segment edited differently from the same base';
    }

    return rangesOverlap(left.range, right.range) ? 'Overlapping timeline edits on the same track' : null;
  }

  return null;
}

export async function analyzeDawOperationConflict(
  client: DawConflictDbClient,
  workspace: DawConflictWorkspace,
  request: DawOperationCommitRequest,
): Promise<DawOperationConflictResult | null> {
  const baseOperationSeq = request.baseOperationSeq ?? 0;
  const existingOperations = await client.projectOperationLog.findMany({
    where: {
      demoId: workspace.demo.id,
      operationSeq: {
        gt: baseOperationSeq,
      },
    },
    orderBy: {
      operationSeq: 'asc',
    },
    select: {
      id: true,
      operationSeq: true,
      operationType: true,
      payload: true,
    },
  });

  if (existingOperations.length === 0) {
    return null;
  }

  const requestScope = await resolveRequestScope(client, workspace, request);
  if (!requestScope) {
    return null;
  }

  const conflictingOperationIds: string[] = [];
  const conflictingOperationSeqs: number[] = [];

  for (const operation of existingOperations) {
    const existingScope = await resolveExistingOperationScope(client, workspace, {
      id: operation.id,
      projectId: workspace.project.id,
      demoId: workspace.demo.id,
      type: operation.operationType as DawProjectOperationRecord['type'],
      createdAt: new Date().toISOString(),
      actorUserId: '',
      baseSnapshotId: null,
      baseOperationSeq: 0,
      operationSeq: operation.operationSeq,
      payload: operation.payload as DawProjectOperationRecord['payload'],
      idempotencyKey: '',
      clientOperationId: '',
    });

    if (!existingScope) continue;

    const reason = conflictReasonForScopes(requestScope, existingScope);
    if (reason) {
      conflictingOperationIds.push(operation.id);
      conflictingOperationSeqs.push(operation.operationSeq);
      return {
        reason,
        conflictingOperationIds,
        conflictingOperationSeqs,
      };
    }
  }

  return null;
}
