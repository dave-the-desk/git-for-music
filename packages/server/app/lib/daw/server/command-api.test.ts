import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  } as const;

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
  } as const;

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

test('version tree mutations broadcast a tree refresh while timeline edits do not', () => {
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
  ] as const) {
    assert.equal(shouldBroadcastVersionTreeChanged(operationType), true, operationType);
  }

  for (const operationType of ['TRACK_RENAMED', 'SEGMENT_SPLIT', 'SEGMENT_MOVED'] as const) {
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
  } as const;

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
    loadSourceSnapshotState: async () => null,
  });

  assert.ok(created);
  assert.equal(created?.id, 'version-auto');
  assert.equal(created?.kind, 'SEMANTIC');
  assert.equal(created?.operationSeq, 7);
  assert.equal((createdVersionArgs as { kind?: string } | null)?.kind, 'SEMANTIC');
  assert.equal((createdVersionArgs as { operationSeq?: number } | null)?.operationSeq, 7);
  assert.equal((activeVersionUpsertArgs as { create?: { activeVersionId?: string } } | null)?.create?.activeVersionId, 'version-auto');
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
  } as const;

  async function commitAcceptedOperation(operationSeq: number, createdAt: string) {
    const operation = {
      operationSeq,
      createdAt,
      operationType: 'TRACK_RENAMED' as const,
    };
    operations.push(operation);
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
  } as const;

  async function commitAcceptedOperation(operationSeq: number, createdAt: string) {
    const operation = {
      operationSeq,
      createdAt,
      operationType: 'TRACK_RENAMED' as const,
    };
    operations.push(operation);
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
