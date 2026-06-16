import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTimelineEditBranchLabel,
  isTimelineEditOperation,
  shouldBroadcastVersionTreeChanged,
  shouldCreateBranchForOperation,
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
    'SEGMENT_SPLIT',
    'SEGMENT_DELETED',
    'SEGMENT_TRIMMED',
    'SEGMENT_MERGED',
    'SEGMENT_FADE_SET',
    'CROSSFADE_SET',
  ] as const) {
    assert.equal(isTimelineEditOperation(operationType), true, operationType);
    assert.equal(shouldCreateBranchForOperation(operationType), true, operationType);
    assert.equal((getTimelineEditBranchLabel(operationType)?.length ?? 0) > 0, true, operationType);
  }

  for (const operationType of ['TRACK_OFFSET_UPDATED', 'SEGMENT_MOVED'] as const) {
    assert.equal(isTimelineEditOperation(operationType), true, operationType);
    assert.equal(shouldCreateBranchForOperation(operationType), false, operationType);
    assert.equal(getTimelineEditBranchLabel(operationType), null, operationType);
  }

  assert.equal(isTimelineEditOperation('VERSION_RENAMED'), false);
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
