import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitDawProjectOperation,
  maybeCreateAutoDemoVersionAfterAcceptedOperation,
  getTimelineEditBranchLabel,
  isTimelineEditOperation,
  shouldBroadcastVersionTreeChanged,
  shouldCreateBranchForOperation,
  shouldCreatePerEditBranchForOperation,
  setUserActiveVersion,
  shouldBranchFromHistoricalBase,
  validateSegmentFadeSelection,
  validateSegmentCrossfadeSelection,
  validateSegmentMergeSelection,
} from '@/app/lib/daw/server/command-api';
import { loadSnapshotStateForDemo } from '@/app/lib/daw/server/snapshot-builder';

function makeMergeSegment(overrides: Partial<{
  id: string;
  trackVersionId: string;
  startMs: number;
  endMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
  isImplicit: boolean;
}> = {}) {
  const startMs = overrides.startMs ?? 0;
  const endMs = overrides.endMs ?? 1000;
  const timelineStartMs = overrides.timelineStartMs ?? 0;
  const timelineEndMs = overrides.timelineEndMs ?? timelineStartMs + (endMs - startMs);

  return {
    id: overrides.id ?? 'segment-a',
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    startMs,
    endMs,
    timelineStartMs,
    timelineEndMs,
    gainDb: overrides.gainDb ?? 0,
    fadeInMs: overrides.fadeInMs ?? 0,
    fadeOutMs: overrides.fadeOutMs ?? 0,
    isMuted: overrides.isMuted ?? false,
    position: overrides.position ?? 0,
    isImplicit: overrides.isImplicit ?? false,
  };
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function findVersionTrack(snapshot: {
  versions: Array<{
    id: string;
    tracks: Array<{
      trackId: string;
      trackName: string;
      trackVersionId: string;
      segments: Array<{
        id: string;
      }>;
    }>;
  }>;
}, trackId: string) {
  for (const version of snapshot.versions) {
    const track = version.tracks.find((candidate) => candidate.trackId === trackId);
    if (track) {
      return track;
    }
  }

  return null;
}

function findVersionSegment(snapshot: {
  versions: Array<{
    id: string;
    tracks: Array<{
      trackId: string;
      trackVersionId: string;
      segments: Array<{
        id: string;
        startMs: number;
        endMs: number;
        timelineStartMs: number | null;
        timelineEndMs: number | null;
        position: number;
      }>;
    }>;
  }>;
}, segmentId: string) {
  for (const version of snapshot.versions) {
    for (const track of version.tracks) {
      const segment = track.segments.find((candidate) => candidate.id === segmentId);
      if (segment) {
        return { version, track, segment };
      }
    }
  }

  return null;
}

test('setUserActiveVersion preserves an explicit pinned checkout without moving the shared head', async () => {
  let demoUpdateCalled = false;
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        name: 'Demo',
        description: null,
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'version-branch',
            label: 'Branch label',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
        ],
        project: {
          id: 'project-1',
          slug: 'project-1',
          name: 'Project',
          description: null,
          group: {
            id: 'group-1',
            slug: 'group',
          },
        },
      }),
      update: async () => {
        demoUpdateCalled = true;
        throw new Error('demo.currentVersionId should not be written');
      },
    },
    groupMember: {
      findFirst: async () => ({
        role: 'MEMBER',
      }),
    },
    demoVersion: {
      findFirst: async () => ({
        id: 'version-branch',
        label: 'Branch label',
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch',
          isFollowingHead: false,
          activeVersion: {
            label: 'Branch label',
          },
        };
      },
    },
  };

  const result = await setUserActiveVersion(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-branch',
    isFollowingHead: false,
  });

  assert.ok(result);
  assert.equal(result?.activeVersionId, 'version-branch');
  assert.equal(result?.isFollowingHead, false);
  assert.equal(result?.activeBranchName, 'Branch label');
  assert.equal(demoUpdateCalled, false);
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { create: Record<string, unknown> }).create, {
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-branch',
    isFollowingHead: false,
  });
  assert.deepEqual((upsertArgs as { update: Record<string, unknown> }).update, {
    activeVersionId: 'version-branch',
    isFollowingHead: false,
  });
});

test('setUserActiveVersion moves an existing checkout to the requested branch when the user switches branches', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        name: 'Demo',
        description: null,
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'version-branch',
            label: 'Branch label',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
        ],
        project: {
          id: 'project-1',
          slug: 'project-1',
          name: 'Project',
          description: null,
          group: {
            id: 'group-1',
            slug: 'group',
          },
        },
      }),
    },
    groupMember: {
      findFirst: async () => ({
        role: 'MEMBER',
      }),
    },
    demoVersion: {
      findFirst: async () => ({
        id: 'version-branch',
        label: 'Branch label',
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-root',
        isFollowingHead: true,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch',
          isFollowingHead: true,
          activeVersion: {
            label: 'Branch label',
          },
        };
      },
    },
  };

  const result = await setUserActiveVersion(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-branch',
    isFollowingHead: true,
  });

  assert.ok(result);
  assert.equal(result?.activeVersionId, 'version-branch');
  assert.equal(result?.isFollowingHead, true);
  assert.equal(result?.activeBranchName, 'Branch label');
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { update: Record<string, unknown> }).update, {
    activeVersionId: 'version-branch',
    isFollowingHead: true,
  });
});

test('setUserActiveVersion defaults isFollowingHead to true', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        name: 'Demo',
        description: null,
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        project: {
          id: 'project-1',
          slug: 'project-1',
          name: 'Project',
          description: null,
          group: {
            id: 'group-1',
            slug: 'group',
          },
        },
      }),
    },
    groupMember: {
      findFirst: async () => ({
        role: 'MEMBER',
      }),
    },
    demoVersion: {
      findFirst: async () => ({
        id: 'version-root',
        label: 'Root',
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-root',
          isFollowingHead: true,
          activeVersion: {
            label: 'Root',
          },
        };
      },
    },
  };

  const result = await setUserActiveVersion(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-root',
  });

  assert.ok(result);
  assert.equal(result?.isFollowingHead, true);
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { create: Record<string, unknown> }).create, {
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-root',
    isFollowingHead: true,
  });
  assert.deepEqual((upsertArgs as { update: Record<string, unknown> }).update, {
    activeVersionId: 'version-root',
    isFollowingHead: true,
  });
});

test('shouldBranchFromHistoricalBase only forks when the snapshot is stale', () => {
  assert.equal(
    shouldBranchFromHistoricalBase({ baseSnapshotId: 'snapshot-1', latestSnapshotId: 'snapshot-1' }),
    false,
  );
  assert.equal(
    shouldBranchFromHistoricalBase({ baseSnapshotId: 'snapshot-1', latestSnapshotId: 'snapshot-2' }),
    true,
  );
  assert.equal(
    shouldBranchFromHistoricalBase({ baseSnapshotId: null, latestSnapshotId: 'snapshot-2' }),
    false,
  );
});

test('timeline edits that branch keep labels while placement moves stay in place', () => {
  for (const operationType of [
    'TRACK_RENAMED',
    'SEGMENT_TRIMMED',
  ] as const) {
    assert.equal(isTimelineEditOperation(operationType), true, operationType);
    assert.equal(shouldCreateBranchForOperation(operationType), true, operationType);
    assert.equal((getTimelineEditBranchLabel(operationType)?.length ?? 0) > 0, true, operationType);
  }

  for (const operationType of [
    'TRACK_OFFSET_UPDATED',
    'SEGMENT_MOVED',
    'SEGMENT_SPLIT',
    'SEGMENT_DELETED',
    'SEGMENT_MERGED',
    'SEGMENT_FADE_SET',
    'CROSSFADE_SET',
  ] as const) {
    assert.equal(isTimelineEditOperation(operationType), true, operationType);
    assert.equal(shouldCreateBranchForOperation(operationType), false, operationType);
    assert.equal(getTimelineEditBranchLabel(operationType), null, operationType);
  }

  assert.equal(isTimelineEditOperation('VERSION_RENAMED'), false);
});

test('per-edit branching can be disabled for ordinary edits behind a flag', () => {
  for (const operationType of ['TRACK_RENAMED', 'SEGMENT_TRIMMED'] as const) {
    assert.equal(shouldCreatePerEditBranchForOperation(operationType, false), true, operationType);
    assert.equal(shouldCreatePerEditBranchForOperation(operationType, true), false, operationType);
  }
});

test('safe concurrent edits on the same branch head converge without creating an unwanted branch', async () => {
  const rootVersionId = 'version-root';
  const rootSnapshot = {
    id: 'snapshot-0',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 0,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: rootVersionId,
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [
        {
          id: rootVersionId,
          label: 'Root',
          description: null,
          tempoBpm: 120,
          timeSignatureNum: 4,
          timeSignatureDen: 4,
          musicalKey: null,
          tempoSource: 'MANUAL',
          keySource: 'MANUAL',
          parentId: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          tracks: [
            {
              trackId: 'track-a',
              trackName: 'Track A',
              trackPosition: 0,
              trackVersionId: 'track-version-a',
              storageKey: '/tracks/track-version-a.wav',
              mimeType: 'audio/wav',
              durationMs: 3000,
              startOffsetMs: 0,
              createdAt: '2025-01-01T00:00:00.000Z',
              isDerived: false,
              operationType: 'ORIGINAL',
              parentTrackVersionId: null,
              segments: [
                {
                  id: 'segment-a',
                  trackVersionId: 'track-version-a',
                  startMs: 0,
                  endMs: 1000,
                  timelineStartMs: 0,
                  timelineEndMs: 1000,
                  gainDb: 0,
                  fadeInMs: 0,
                  fadeOutMs: 0,
                  isMuted: false,
                  position: 0,
                },
                {
                  id: 'segment-b',
                  trackVersionId: 'track-version-a',
                  startMs: 1200,
                  endMs: 2200,
                  timelineStartMs: 1200,
                  timelineEndMs: 2200,
                  gainDb: 0,
                  fadeInMs: 0,
                  fadeOutMs: 0,
                  isMuted: false,
                  position: 1,
                },
              ],
            },
          ],
        },
      ],
      comments: [],
      annotations: [],
      operationHistory: [],
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const liveSnapshot = cloneSnapshot(rootSnapshot.snapshot);
  const snapshotRows = [rootSnapshot] as Array<typeof rootSnapshot>;
  const operationRows: Array<{
    id: string;
    projectId: string;
    demoId: string;
    operationType: string;
    createdAt: Date;
    actorUserId: string;
    baseSnapshotId: string | null;
    baseOperationSeq: number;
    operationSeq: number;
    payload: unknown;
    idempotencyKey: string;
    clientOperationId: string;
  }> = [];
  const createdVersionRows: Array<{ id: string; label: string }> = [];
  const activeVersionRows = new Map<string, { activeVersionId: string; isFollowingHead: boolean }>();

  const tx = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        name: 'Demo',
        description: null,
        currentVersionId: rootVersionId,
        versions: [
          {
            id: rootVersionId,
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        project: {
          id: 'project-1',
          slug: 'project-1',
          name: 'Project',
          description: null,
          group: {
            id: 'group-1',
            slug: 'group',
          },
        },
      }),
    },
    groupMember: {
      findFirst: async () => ({
        role: 'MEMBER',
      }),
    },
    demoVersion: {
      findFirst: async (args: { where: { id: string } }) => {
        if (args.where.id === rootVersionId) {
          return {
            id: rootVersionId,
            label: 'Root',
            operationSeq: 0,
          };
        }

        return createdVersionRows.find((version) => version.id === args.where.id) ?? null;
      },
      create: async (args: { data: { label: string } }) => {
        const created = {
          id: `version-${createdVersionRows.length + 1}`,
          label: args.data.label,
        };
        createdVersionRows.push(created);
        return {
          id: created.id,
          label: created.label,
          description: null,
          kind: 'BRANCH',
          operationSeq: 0,
          tempoBpm: 120,
          timeSignatureNum: 4,
          timeSignatureDen: 4,
          musicalKey: null,
          tempoSource: 'MANUAL',
          keySource: 'MANUAL',
          createdAt: '2025-01-01T00:00:00.000Z',
          parentId: rootVersionId,
          isMerge: false,
          tracks: [],
        };
      },
    },
    demoUserActiveVersion: {
      findFirst: async (args: { where: { userId: string } }) => {
        const existing = activeVersionRows.get(args.where.userId);
        return existing
          ? {
              activeVersionId: existing.activeVersionId,
              isFollowingHead: existing.isFollowingHead,
            }
          : null;
      },
      upsert: async (args: {
        where: { demoId_userId: { userId: string } };
        create: { activeVersionId: string; isFollowingHead: boolean };
        update: { activeVersionId: string; isFollowingHead: boolean };
      }) => {
        const userId = args.where.demoId_userId.userId;
        const row = {
          activeVersionId: args.update.activeVersionId,
          isFollowingHead: args.update.isFollowingHead,
        };
        activeVersionRows.set(userId, row);
        return {
          activeVersionId: row.activeVersionId,
          isFollowingHead: row.isFollowingHead,
          activeVersion: {
            label: row.activeVersionId === rootVersionId ? 'Root' : 'Branch',
          },
          };
      },
    },
    user: {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        return args.where.id.in.map((id) => ({
          id,
          name: id === 'user-a' ? 'Avery Fox' : id === 'user-b' ? 'Bea Moss' : null,
        }));
      },
    },
    projectSnapshot: {
      findFirst: async (args: { where: { demoId: string; operationSeq?: { lte: number } } }) => {
        if (args.where.operationSeq?.lte !== undefined) {
          const candidate = snapshotRows
            .filter((row) => row.operationSeq <= args.where.operationSeq!.lte)
            .sort((a, b) => b.operationSeq - a.operationSeq)[0];
          return candidate ? cloneSnapshot(candidate) : null;
        }

        const latest = [...snapshotRows].sort((a, b) => b.operationSeq - a.operationSeq)[0];
        return latest ? cloneSnapshot(latest) : null;
      },
      create: async (args: { data: { operationSeq: number; snapshot: typeof liveSnapshot; createdById: string } }) => {
        const created = {
          id: `snapshot-${snapshotRows.length}`,
          projectId: 'project-1',
          demoId: 'demo-1',
          operationSeq: args.data.operationSeq,
          snapshot: cloneSnapshot(args.data.snapshot),
          createdById: args.data.createdById,
          createdAt: '2025-01-01T00:00:00.000Z',
        };
        snapshotRows.push(created);
        return cloneSnapshot(created);
      },
    },
    projectOperationLog: {
      findFirst: async (args: {
        where: { demoId: string; idempotencyKey?: string; clientOperationId?: string };
        orderBy?: { operationSeq: 'desc' };
      }) => {
        if (args.where.idempotencyKey) {
          return (
            operationRows.find(
              (row) => row.demoId === args.where.demoId && row.idempotencyKey === args.where.idempotencyKey,
            ) ?? null
          );
        }

        if (args.where.clientOperationId) {
          return (
            operationRows.find(
              (row) => row.demoId === args.where.demoId && row.clientOperationId === args.where.clientOperationId,
            ) ?? null
          );
        }

        return [...operationRows].sort((a, b) => b.operationSeq - a.operationSeq)[0] ?? null;
      },
      findMany: async (args: { where: { demoId: string; operationSeq?: { gt: number } } }) => {
        return [...operationRows]
          .filter((row) => row.demoId === args.where.demoId && row.operationSeq > (args.where.operationSeq?.gt ?? 0))
          .sort((a, b) => a.operationSeq - b.operationSeq);
      },
      findUnique: async (args: {
        where: {
          demoId_operationSeq?: { demoId: string; operationSeq: number };
          demoId_idempotencyKey?: { demoId: string; idempotencyKey: string };
          demoId_clientOperationId?: { demoId: string; clientOperationId: string };
        };
      }) => {
        if (args.where.demoId_operationSeq) {
          return (
            operationRows.find(
              (row) =>
                row.demoId === args.where.demoId_operationSeq!.demoId &&
                row.operationSeq === args.where.demoId_operationSeq!.operationSeq,
            ) ?? null
          );
        }

        if (args.where.demoId_idempotencyKey) {
          return (
            operationRows.find(
              (row) =>
                row.demoId === args.where.demoId_idempotencyKey!.demoId &&
                row.idempotencyKey === args.where.demoId_idempotencyKey!.idempotencyKey,
            ) ?? null
          );
        }

        return (
          operationRows.find(
            (row) =>
              row.demoId === args.where.demoId_clientOperationId!.demoId &&
              row.clientOperationId === args.where.demoId_clientOperationId!.clientOperationId,
          ) ?? null
        );
      },
      create: async (args: {
        data: {
          projectId: string;
          demoId: string;
          actorUserId: string;
          baseSnapshotId: string | null;
          baseOperationSeq: number;
          operationSeq: number;
          operationType: string;
          payload: unknown;
          idempotencyKey: string;
          clientOperationId: string;
        };
      }) => {
        const created = {
          id: `operation-${args.data.operationSeq}`,
          projectId: args.data.projectId,
          demoId: args.data.demoId,
          operationType: args.data.operationType,
          createdAt: new Date(`2025-01-02T00:00:0${args.data.operationSeq}.000Z`),
          actorUserId: args.data.actorUserId,
          baseSnapshotId: args.data.baseSnapshotId,
          baseOperationSeq: args.data.baseOperationSeq,
          operationSeq: args.data.operationSeq,
          payload: args.data.payload,
          idempotencyKey: args.data.idempotencyKey,
          clientOperationId: args.data.clientOperationId,
        };
        operationRows.push(created);
        return {
          id: created.id,
          operationSeq: created.operationSeq,
          createdAt: created.createdAt,
        };
      },
    },
    track: {
      findFirst: async (args: { where: { id: string } }) => {
        const track = findVersionTrack(liveSnapshot, args.where.id);
        return track ? { id: args.where.id } : null;
      },
      update: async (args: { where: { id: string }; data: { name: string } }) => {
        const track = findVersionTrack(liveSnapshot, args.where.id);
        if (track) {
          track.trackName = args.data.name;
        }
        return { id: args.where.id };
      },
    },
    trackVersion: {
      findFirst: async () => null,
    },
    segment: {
      findFirst: async (args: { where: { id: string; trackVersionId: string } }) => {
        const segment = findVersionSegment(liveSnapshot, args.where.id);
        if (!segment || segment.track.trackVersionId !== args.where.trackVersionId) {
          return null;
        }

        return {
          id: segment.segment.id,
          startMs: segment.segment.startMs,
          endMs: segment.segment.endMs,
          timelineStartMs: segment.segment.timelineStartMs,
          position: segment.segment.position,
          trackVersion: {
            startOffsetMs: 0,
          },
        };
      },
      update: async (args: { where: { id: string }; data: { startMs?: number; endMs?: number; timelineStartMs?: number } }) => {
        const segment = findVersionSegment(liveSnapshot, args.where.id);
        if (segment) {
          if (typeof args.data.startMs === 'number') {
            segment.segment.startMs = args.data.startMs;
          }
          if (typeof args.data.endMs === 'number') {
            segment.segment.endMs = args.data.endMs;
          }
          if (typeof args.data.timelineStartMs === 'number') {
            segment.segment.timelineStartMs = args.data.timelineStartMs;
          }
          segment.segment.timelineEndMs =
            segment.segment.timelineStartMs === null
              ? null
              : segment.segment.timelineStartMs + (segment.segment.endMs - segment.segment.startMs);
        }
        return { id: args.where.id };
      },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
      create: async () => ({ id: 'segment-created' }),
    },
  };

  const client = {
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(tx),
    demo: tx.demo,
    groupMember: tx.groupMember,
    demoVersion: tx.demoVersion,
    demoUserActiveVersion: tx.demoUserActiveVersion,
    user: tx.user,
    projectSnapshot: tx.projectSnapshot,
    projectOperationLog: tx.projectOperationLog,
    track: tx.track,
    trackVersion: tx.trackVersion,
    segment: tx.segment,
  };

  const trimSegment = (segmentId: string, fromStartMs: number, fromEndMs: number, toStartMs: number, toEndMs: number) =>
    ({
      demoId: 'demo-1',
      operationType: 'SEGMENT_TRIMMED' as const,
      payload: {
        trackVersionId: 'track-version-a',
        segmentId,
        from: {
          startMs: fromStartMs,
          endMs: fromEndMs,
        },
        to: {
          startMs: toStartMs,
          endMs: toEndMs,
        },
      },
      baseSnapshotId: 'snapshot-0',
      baseOperationSeq: 0,
      targetTrackId: 'track-a',
      targetSegmentId: segmentId,
      affectedTimeRange: {
        startMs: fromStartMs,
        endMs: fromEndMs,
      },
      idempotencyKey: `${segmentId}-idempotency`,
      clientOperationId: `${segmentId}-client`,
    }) satisfies Parameters<typeof commitDawProjectOperation>[1]['request'];

  const first = await commitDawProjectOperation(client as never, {
    projectId: 'project-1',
    userId: 'user-a',
    request: trimSegment('segment-a', 0, 1000, 100, 900),
  });

  const second = await commitDawProjectOperation(client as never, {
    projectId: 'project-1',
    userId: 'user-b',
    request: trimSegment('segment-b', 1200, 2200, 1300, 2100),
  });

  const mergedState = await loadSnapshotStateForDemo(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  assert.equal(first.conflict, null);
  assert.equal(second.conflict, null);
  assert.equal(first.operation?.type, 'SEGMENT_TRIMMED');
  assert.equal(second.operation?.type, 'SEGMENT_TRIMMED');
  assert.equal(createdVersionRows.length, 0);
  assert.equal(operationRows.some((row) => row.operationType === 'VERSION_BRANCH_CREATED'), false);
  assert.equal(operationRows.length, 2);
  assert.equal(findVersionTrack(mergedState, 'track-a')?.trackName, 'Track A');
  assert.equal(findVersionSegment(mergedState, 'segment-a')?.segment.startMs, 100);
  assert.equal(findVersionSegment(mergedState, 'segment-a')?.segment.endMs, 900);
  assert.equal(findVersionSegment(mergedState, 'segment-b')?.segment.startMs, 1300);
  assert.equal(findVersionSegment(mergedState, 'segment-b')?.segment.endMs, 2100);
});

test('validateSegmentFadeSelection accepts valid fades and rejects invalid durations', () => {
  assert.equal(
    validateSegmentFadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
      }),
      {
        fadeInMs: 100,
        fadeOutMs: 200,
      },
    ),
    null,
  );

  assert.equal(
    validateSegmentFadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
      }),
      {
        fadeInMs: -1,
        fadeOutMs: 0,
      },
    ),
    'Fade durations must be non-negative',
  );

  assert.equal(
    validateSegmentFadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
      }),
      {
        fadeInMs: 600,
        fadeOutMs: 500,
      },
    ),
    'Fade duration cannot exceed the clip duration.',
  );
});

test('validateSegmentCrossfadeSelection accepts adjacent clips and rejects invalid candidates', () => {
  assert.equal(
    validateSegmentCrossfadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-1',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        crossfadeInMs: 250,
        crossfadeOutMs: 250,
        curve: 'linear',
      },
    ),
    null,
  );

  assert.equal(
    validateSegmentCrossfadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-1',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1004,
        timelineEndMs: 2004,
        position: 1,
      }),
      {
        crossfadeInMs: 250,
        crossfadeOutMs: 250,
        curve: 'linear',
      },
    ),
    'These clips cannot be crossfaded because there is a gap between them.',
  );

  assert.equal(
    validateSegmentCrossfadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-2',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        crossfadeInMs: 250,
        crossfadeOutMs: 250,
        curve: 'linear',
      },
    ),
    'These clips must be on the same track to crossfade.',
  );

  assert.equal(
    validateSegmentCrossfadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        isImplicit: true,
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-1',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        crossfadeInMs: 250,
        crossfadeOutMs: 250,
        curve: 'linear',
      },
    ),
    'Only saved audio clips can be crossfaded.',
  );

  assert.equal(
    validateSegmentCrossfadeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 200,
        timelineStartMs: 0,
        timelineEndMs: 200,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-1',
        startMs: 200,
        endMs: 350,
        timelineStartMs: 200,
        timelineEndMs: 350,
        position: 1,
      }),
      {
        crossfadeInMs: 250,
        crossfadeOutMs: 250,
        curve: 'linear',
      },
    ),
    'Crossfade duration must fit within both clips.',
  );
});

test('version tree mutations and audio-tool edits broadcast a tree refresh while track renames do not', () => {
  for (const operationType of [
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
    'TRACK_OFFSET_UPDATED',
    'SEGMENT_SPLIT',
    'SEGMENT_MOVED',
    'SEGMENT_DELETED',
    'SEGMENT_TRIMMED',
    'SEGMENT_MERGED',
    'SEGMENT_FADE_SET',
    'CROSSFADE_SET',
  ] as const) {
    assert.equal(shouldBroadcastVersionTreeChanged(operationType), true, operationType);
  }

  for (const operationType of ['TRACK_RENAMED'] as const) {
    assert.equal(shouldBroadcastVersionTreeChanged(operationType), false, operationType);
  }
});

test('maybeCreateAutoDemoVersionAfterAcceptedOperation creates a semantic checkpoint after an accepted semantic op', async () => {
  let activeVersionUpsertArgs: unknown = null;
  let createdVersionArgs: unknown = null;

  const tx = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
      }),
    },
    demoVersion: {
      findFirst: async (args: { where: { id: string } }) => {
        if (args.where.id === 'version-head') {
          return {
            id: 'version-head',
            label: 'Head',
            operationSeq: 5,
          };
        }

        if (args.where.id === 'version-auto') {
          return {
            id: 'version-auto',
            label: 'Semantic checkpoint',
          };
        }

        return null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createdVersionArgs = args.data;
        return {
          id: 'version-auto',
          label: args.data.label,
          description: args.data.description,
          kind: args.data.kind ?? 'EXPLICIT',
          operationSeq: args.data.operationSeq ?? null,
          tempoBpm: args.data.tempoBpm ?? 120,
          timeSignatureNum: args.data.timeSignatureNum ?? 4,
          timeSignatureDen: args.data.timeSignatureDen ?? 4,
          musicalKey: args.data.musicalKey ?? null,
          tempoSource: args.data.tempoSource ?? 'MANUAL',
          keySource: args.data.keySource ?? 'MANUAL',
          createdAt: new Date('2025-01-02T00:00:03.000Z'),
          parentId: args.data.parentId,
          isMerge: false,
        };
      },
    },
    projectOperationLog: {
      findMany: async () => [
        {
          operationSeq: 7,
          createdAt: '2025-01-02T00:00:02.000Z',
          operationType: 'TRACK_VERSION_CREATED',
        },
        {
          operationSeq: 6,
          createdAt: '2025-01-02T00:00:00.000Z',
          operationType: 'TRACK_RENAMED',
        },
      ],
    },
    demoUserActiveVersion: {
      upsert: async (args: unknown) => {
        activeVersionUpsertArgs = args;
        return {
          activeVersionId: 'version-auto',
          isFollowingHead: true,
          activeVersion: {
            label: 'Semantic checkpoint',
          },
        };
      },
    },
    trackVersion: {
      findMany: async () => [],
    },
    segment: {
      create: async () => ({ id: 'segment-auto' }),
    },
  };

  const created = await maybeCreateAutoDemoVersionAfterAcceptedOperation(tx as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    sourceVersionId: 'version-head',
    operation: {
      type: 'TRACK_VERSION_CREATED',
      operationSeq: 7,
      createdAt: '2025-01-02T00:00:02.000Z',
    },
  });

  assert.ok(created);
  assert.equal(created?.id, 'version-auto');
  assert.equal(created?.kind, 'SEMANTIC');
  assert.equal(created?.operationSeq, 7);
  assert.equal((createdVersionArgs as { kind?: string } | null)?.kind, 'SEMANTIC');
  assert.equal((createdVersionArgs as { operationSeq?: number } | null)?.operationSeq, 7);
  assert.equal((activeVersionUpsertArgs as { create?: { activeVersionId?: string } } | null)?.create?.activeVersionId, 'version-auto');
});

test('maybeCreateAutoDemoVersionAfterAcceptedOperation treats plugin adds as semantic checkpoints', async () => {
  let createdVersionArgs: unknown = null;

  const tx = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
      }),
    },
    demoVersion: {
      findFirst: async (args: { where: { id: string } }) => {
        if (args.where.id === 'version-head') {
          return {
            id: 'version-head',
            label: 'Head',
            operationSeq: 5,
          };
        }

        if (args.where.id === 'version-auto') {
          return {
            id: 'version-auto',
            label: 'Plugin checkpoint',
          };
        }

        return null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createdVersionArgs = args.data;
        return {
          id: 'version-auto',
          label: args.data.label,
          description: args.data.description,
          kind: args.data.kind ?? 'EXPLICIT',
          operationSeq: args.data.operationSeq ?? null,
          tempoBpm: args.data.tempoBpm ?? 120,
          timeSignatureNum: args.data.timeSignatureNum ?? 4,
          timeSignatureDen: args.data.timeSignatureDen ?? 4,
          musicalKey: args.data.musicalKey ?? null,
          tempoSource: args.data.tempoSource ?? 'MANUAL',
          keySource: args.data.keySource ?? 'MANUAL',
          createdAt: new Date('2025-01-02T00:00:03.000Z'),
          parentId: args.data.parentId,
          isMerge: false,
        };
      },
    },
    projectOperationLog: {
      findMany: async () => [
        {
          operationSeq: 7,
          createdAt: '2025-01-02T00:00:02.000Z',
          operationType: 'PLUGIN_ADDED',
        },
      ],
    },
    demoUserActiveVersion: {
      upsert: async () => ({
        activeVersionId: 'version-auto',
        isFollowingHead: true,
        activeVersion: {
          label: 'Plugin checkpoint',
        },
      }),
    },
    trackVersion: {
      findMany: async () => [],
    },
    segment: {
      create: async () => ({ id: 'segment-auto' }),
    },
  };

  const created = await maybeCreateAutoDemoVersionAfterAcceptedOperation(tx as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    sourceVersionId: 'version-head',
    operation: {
      type: 'PLUGIN_ADDED',
      operationSeq: 7,
      createdAt: '2025-01-02T00:00:02.000Z',
    },
  });

  assert.ok(created);
  assert.equal(created?.kind, 'SEMANTIC');
  assert.equal((createdVersionArgs as { kind?: string } | null)?.kind, 'SEMANTIC');
});

test('maybeCreateAutoDemoVersionAfterAcceptedOperation creates exactly one checkpoint after a burst settles', async () => {
  const createdVersions: Array<{
    id: string;
    kind: string;
    operationSeq: number | null;
    parentId: string | null;
  }> = [];
  const operations: Array<{
    operationSeq: number;
    createdAt: string;
    operationType: 'TRACK_RENAMED';
  }> = [];
  const versions = new Map<string, { id: string; operationSeq: number; label: string }>([
    ['version-head', { id: 'version-head', operationSeq: 5, label: 'Head' }],
  ]);
  let activeSourceVersionId = 'version-head';

  const tx = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
      }),
    },
    demoVersion: {
      findFirst: async (args: { where: { id: string } }) => versions.get(args.where.id) ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        const createdVersion = {
          id: `version-auto-${createdVersions.length + 1}`,
          kind: (args.data.kind ?? 'EXPLICIT') as string,
          operationSeq: (args.data.operationSeq ?? null) as number | null,
          parentId: (args.data.parentId ?? null) as string | null,
          label: args.data.label as string,
        };
        createdVersions.push(createdVersion);
        versions.set(createdVersion.id, {
          id: createdVersion.id,
          operationSeq: createdVersion.operationSeq ?? 0,
          label: createdVersion.label,
        });
        return {
          id: createdVersion.id,
          label: createdVersion.label,
          description: args.data.description ?? null,
          kind: createdVersion.kind,
          operationSeq: createdVersion.operationSeq,
          tempoBpm: args.data.tempoBpm ?? 120,
          timeSignatureNum: args.data.timeSignatureNum ?? 4,
          timeSignatureDen: args.data.timeSignatureDen ?? 4,
          musicalKey: args.data.musicalKey ?? null,
          tempoSource: args.data.tempoSource ?? 'MANUAL',
          keySource: args.data.keySource ?? 'MANUAL',
          createdAt: new Date('2025-01-02T00:00:10.000Z'),
          parentId: createdVersion.parentId,
          isMerge: false,
        };
      },
    },
    projectOperationLog: {
      findMany: async () =>
        [...operations].sort((a, b) => b.operationSeq - a.operationSeq).slice(0, 2),
    },
    demoUserActiveVersion: {
      upsert: async () => ({
        activeVersionId: activeSourceVersionId,
        isFollowingHead: true,
        activeVersion: {
          label: 'Head',
        },
      }),
    },
    trackVersion: {
      findMany: async () => [],
    },
    segment: {
      create: async () => ({ id: 'segment-auto' }),
    },
  };

  async function commitAcceptedOperation(operationSeq: number, createdAt: string) {
    const operation = {
      type: 'TRACK_RENAMED' as const,
      operationSeq,
      createdAt,
    };
    operations.push({
      operationType: operation.type,
      operationSeq: operation.operationSeq,
      createdAt: operation.createdAt,
    });
    const created = await maybeCreateAutoDemoVersionAfterAcceptedOperation(tx as never, {
      projectId: 'project-1',
      demoId: 'demo-1',
      userId: 'user-1',
      sourceVersionId: activeSourceVersionId,
      operation,
    });
    if (created) {
      activeSourceVersionId = created.id;
    }
    return created;
  }

  assert.equal(await commitAcceptedOperation(6, '2025-01-02T00:00:00.000Z'), null);
  assert.equal(await commitAcceptedOperation(7, '2025-01-02T00:00:01.000Z'), null);
  assert.equal(await commitAcceptedOperation(8, '2025-01-02T00:00:02.000Z'), null);

  const checkpoint = await commitAcceptedOperation(9, '2025-01-02T00:00:08.000Z');
  assert.ok(checkpoint);
  assert.equal(checkpoint?.kind, 'AUTO');
  assert.equal(checkpoint?.operationSeq, 9);

  assert.equal(await commitAcceptedOperation(10, '2025-01-02T00:00:08.500Z'), null);
  assert.equal(createdVersions.length, 1);
});

test('maybeCreateAutoDemoVersionAfterAcceptedOperation creates a checkpoint when the operation-count threshold is reached', async () => {
  const createdVersions: Array<{
    id: string;
    kind: string;
    operationSeq: number | null;
  }> = [];
  const operations: Array<{
    operationSeq: number;
    createdAt: string;
    operationType: 'TRACK_RENAMED';
  }> = [];
  const versions = new Map<string, { id: string; operationSeq: number; label: string }>([
    ['version-head', { id: 'version-head', operationSeq: 5, label: 'Head' }],
  ]);

  const tx = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
      }),
    },
    demoVersion: {
      findFirst: async (args: { where: { id: string } }) => versions.get(args.where.id) ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        const createdVersion = {
          id: `version-auto-${createdVersions.length + 1}`,
          kind: (args.data.kind ?? 'EXPLICIT') as string,
          operationSeq: (args.data.operationSeq ?? null) as number | null,
        };
        createdVersions.push(createdVersion);
        versions.set(createdVersion.id, {
          id: createdVersion.id,
          operationSeq: createdVersion.operationSeq ?? 0,
          label: args.data.label as string,
        });
        return {
          id: createdVersion.id,
          label: args.data.label,
          description: args.data.description ?? null,
          kind: createdVersion.kind,
          operationSeq: createdVersion.operationSeq,
          tempoBpm: args.data.tempoBpm ?? 120,
          timeSignatureNum: args.data.timeSignatureNum ?? 4,
          timeSignatureDen: args.data.timeSignatureDen ?? 4,
          musicalKey: args.data.musicalKey ?? null,
          tempoSource: args.data.tempoSource ?? 'MANUAL',
          keySource: args.data.keySource ?? 'MANUAL',
          createdAt: new Date('2025-01-02T00:00:12.000Z'),
          parentId: args.data.parentId,
          isMerge: false,
        };
      },
    },
    projectOperationLog: {
      findMany: async () =>
        [...operations].sort((a, b) => b.operationSeq - a.operationSeq).slice(0, 2),
    },
    demoUserActiveVersion: {
      upsert: async () => ({
        activeVersionId: 'version-head',
        isFollowingHead: true,
        activeVersion: {
          label: 'Head',
        },
      }),
    },
    trackVersion: {
      findMany: async () => [],
    },
    segment: {
      create: async () => ({ id: 'segment-auto' }),
    },
  };

  async function commitAcceptedOperation(operationSeq: number, createdAt: string) {
    const operation = {
      type: 'TRACK_RENAMED' as const,
      operationSeq,
      createdAt,
    };
    operations.push({
      operationType: operation.type,
      operationSeq: operation.operationSeq,
      createdAt: operation.createdAt,
    });
    return maybeCreateAutoDemoVersionAfterAcceptedOperation(tx as never, {
      projectId: 'project-1',
      demoId: 'demo-1',
      userId: 'user-1',
      sourceVersionId: 'version-head',
      operation,
    });
  }

  for (let operationSeq = 6; operationSeq <= 17; operationSeq += 1) {
    const created = await commitAcceptedOperation(
      operationSeq,
      `2025-01-02T00:00:${String(operationSeq - 6).padStart(2, '0')}.000Z`,
    );

    if (operationSeq < 17) {
      assert.equal(created, null);
    }
  }

  assert.equal(createdVersions.length, 1);
  assert.equal(createdVersions[0]?.operationSeq, 17);
});

test('validateSegmentMergeSelection accepts adjacent timeline and source segments', () => {
  assert.equal(
    validateSegmentMergeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        id: 'merged-segment',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 2000,
        timelineStartMs: 0,
        timelineEndMs: 2000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    ),
    null,
  );
});

test('validateSegmentMergeSelection rejects timeline gaps', () => {
  assert.equal(
    validateSegmentMergeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1004,
        timelineEndMs: 2004,
        position: 1,
      }),
      {
        id: 'merged-segment',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 2000,
        timelineStartMs: 0,
        timelineEndMs: 2000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    ),
    'These clips cannot be merged because they are not continuous. Use a future bounce/render command to combine non-contiguous audio.',
  );
});

test('validateSegmentMergeSelection rejects source gaps', () => {
  assert.equal(
    validateSegmentMergeSelection(
      makeMergeSegment({
        id: 'segment-a',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        startMs: 1050,
        endMs: 2050,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        id: 'merged-segment',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 2000,
        timelineStartMs: 0,
        timelineEndMs: 2000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    ),
    'These clips cannot be merged because they are not continuous. Use a future bounce/render command to combine non-contiguous audio.',
  );
});

test('validateSegmentMergeSelection rejects different track versions', () => {
  assert.equal(
    validateSegmentMergeSelection(
      makeMergeSegment({
        id: 'segment-a',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 1000,
        timelineStartMs: 0,
        timelineEndMs: 1000,
        position: 0,
      }),
      makeMergeSegment({
        id: 'segment-b',
        trackVersionId: 'track-version-2',
        startMs: 1000,
        endMs: 2000,
        timelineStartMs: 1000,
        timelineEndMs: 2000,
        position: 1,
      }),
      {
        id: 'merged-segment',
        trackVersionId: 'track-version-1',
        startMs: 0,
        endMs: 2000,
        timelineStartMs: 0,
        timelineEndMs: 2000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    ),
    'These clips must be on the same track to merge.',
  );
});
