import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshotStateForDemo } from '@/features/daw/server/snapshot-builder';

function makeClient(latestSnapshot: unknown, operations: unknown[]) {
  return {
    projectSnapshot: {
      findFirst: async () => latestSnapshot,
    },
    projectOperationLog: {
      findMany: async () => operations,
    },
  };
}

test('loadSnapshotStateForDemo materializes TRACK_VERSION_CREATED into a normal segment', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
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
          id: 'version-root',
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
          tracks: [],
        },
      ],
      comments: [],
      annotations: [],
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const snapshot = await loadSnapshotStateForDemo(
    makeClient(latestSnapshot, [
      {
        id: 'op-2',
        projectId: 'project-1',
        demoId: 'demo-1',
        operationType: 'TRACK_VERSION_CREATED',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 1,
        operationSeq: 2,
        payload: {
          versionId: 'version-root',
          trackId: 'track-1',
          trackVersionId: 'track-version-1',
          operationSummary: 'Added recording',
          track: {
            trackId: 'track-1',
            trackName: 'Recorded track',
            trackPosition: 0,
            trackVersionId: 'track-version-1',
            storageKey: '/assets/recording.wav',
            mimeType: 'audio/wav',
            durationMs: 1750,
            startOffsetMs: 250,
            createdAt: '2025-01-02T00:00:00.000Z',
            isDerived: false,
            operationType: 'ORIGINAL',
            parentTrackVersionId: null,
            segments: [
              {
                id: 'segment-1',
                trackVersionId: 'track-version-1',
                startMs: 0,
                endMs: 1750,
                timelineStartMs: 250,
                gainDb: 0,
                fadeInMs: 0,
                fadeOutMs: 0,
                isMuted: false,
                position: 0,
              },
            ],
          },
        },
        idempotencyKey: 'idempotency-2',
        clientOperationId: 'client-2',
      },
    ]) as never,
    {
      projectId: 'project-1',
      demoId: 'demo-1',
    },
  );

  const track = snapshot.versions[0]?.tracks[0];
  assert.ok(track);
  assert.equal(track?.trackId, 'track-1');
  assert.equal(track?.segments.length, 1);
  assert.equal(track?.segments[0]?.id, 'segment-1');
  assert.equal(track?.segments[0]?.timelineStartMs, 250);
  assert.equal(track?.segments[0]?.startMs, 0);
  assert.equal(snapshot.operationHistory.length, 1);
  assert.equal(snapshot.operationHistory[0]?.summary, 'Created track version for Recorded track');
});

test('loadSnapshotStateForDemo can stop at a historical operation sequence without replaying later activity', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 10,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
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
          id: 'version-root',
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
              trackId: 'track-1',
              trackName: 'Track 1',
              trackPosition: 0,
              trackVersionId: 'track-version-1',
              storageKey: '/assets/track-1.wav',
              mimeType: 'audio/wav',
              durationMs: 2000,
              startOffsetMs: 0,
              createdAt: '2025-01-01T00:00:00.000Z',
              isDerived: false,
              operationType: 'ORIGINAL',
              parentTrackVersionId: null,
              segments: [],
            },
          ],
        },
      ],
      comments: [],
      annotations: [],
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const snapshot = await loadSnapshotStateForDemo(
    makeClient(latestSnapshot, [
      {
        id: 'op-11',
        projectId: 'project-1',
        demoId: 'demo-1',
        operationType: 'TRACK_RENAMED',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 10,
        operationSeq: 11,
        payload: {
          trackId: 'track-1',
          trackName: 'Track 1 (first pass)',
        },
        idempotencyKey: 'idempotency-11',
        clientOperationId: 'client-11',
      },
      {
        id: 'op-12',
        projectId: 'project-1',
        demoId: 'demo-1',
        operationType: 'TRACK_RENAMED',
        createdAt: '2025-01-03T00:00:00.000Z',
        actorUserId: 'user-c',
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 10,
        operationSeq: 12,
        payload: {
          trackId: 'track-1',
          trackName: 'Track 1 (second pass)',
        },
        idempotencyKey: 'idempotency-12',
        clientOperationId: 'client-12',
      },
    ]) as never,
    {
      projectId: 'project-1',
      demoId: 'demo-1',
    },
    {
      operationSeq: 11,
    },
  );

  const version = snapshot.versions[0];
  const track = version?.tracks[0];

  assert.ok(version);
  assert.ok(track);
  assert.equal(track?.trackName, 'Track 1 (first pass)');
  assert.equal(snapshot.operationHistory.length, 1);
  assert.equal(snapshot.operationHistory[0]?.operationSeq, 11);
});

test('loadSnapshotStateForDemo strips legacy recording take state from old snapshots', async () => {
  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
      project: {
        id: 'project-1',
        slug: 'project-1',
        group: {
          id: 'group-1',
          slug: 'group',
        },
      },
      versions: [],
      comments: [],
      annotations: [],
      recordingTakesByTrackId: {
        'track-1': [
          {
            id: 'take-1',
            trackId: 'track-1',
            trackVersionId: null,
            name: 'Recovered take',
            startOffsetMs: 250,
            durationMs: 1500,
            sourceStartMs: 0,
            sourceEndMs: 1500,
            timelineStartMs: 250,
            timelineEndMs: 1750,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            storageKey: '/assets/take-1.wav',
            assetId: 'asset-1',
            recordedTempoBpm: 120,
            sourceTempoBpm: 120,
            createdAt: '2025-01-02T00:00:00.000Z',
          },
        ],
      },
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const snapshot = await loadSnapshotStateForDemo(makeClient(latestSnapshot, []) as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
  });

  assert.equal((snapshot as Record<string, unknown>).recordingTakesByTrackId, undefined);
});

test('loadSnapshotStateForDemo replays SEGMENT_MOVED across track versions with exact placement', async () => {
  const sourceSegment = {
    id: 'segment-1',
    trackVersionId: 'track-version-a',
    startMs: 100,
    endMs: 900,
    timelineStartMs: 1200,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
  };

  const latestSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 1,
    snapshot: {
      id: 'demo-1',
      name: 'Demo',
      description: null,
      currentVersionId: 'version-root',
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
          id: 'version-root',
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
              id: 'track-version-a',
              trackId: 'track-a',
              trackName: 'Track A',
              trackPosition: 0,
              trackVersionId: 'track-version-a',
              storageKey: '/tracks/a.wav',
              mimeType: 'audio/wav',
              durationMs: 2000,
              startOffsetMs: 0,
              createdAt: '2025-01-01T00:00:00.000Z',
              isDerived: false,
              operationType: 'ORIGINAL',
              parentTrackVersionId: null,
              segments: [sourceSegment],
            },
            {
              id: 'track-version-b',
              trackId: 'track-b',
              trackName: 'Track B',
              trackPosition: 1,
              trackVersionId: 'track-version-b',
              storageKey: '/tracks/b.wav',
              mimeType: 'audio/wav',
              durationMs: 2000,
              startOffsetMs: 0,
              createdAt: '2025-01-01T00:00:00.000Z',
              isDerived: false,
              operationType: 'ORIGINAL',
              parentTrackVersionId: null,
              segments: [],
            },
          ],
        },
      ],
      comments: [],
      annotations: [],
    },
    createdById: 'user-a',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const snapshot = await loadSnapshotStateForDemo(
    makeClient(latestSnapshot, [
      {
        id: 'op-2',
        projectId: 'project-1',
        demoId: 'demo-1',
        operationType: 'SEGMENT_MOVED',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 1,
        operationSeq: 2,
        payload: {
          segmentId: 'segment-1',
          fromTrackVersionId: 'track-version-a',
          toTrackVersionId: 'track-version-b',
          fromTimelineStartMs: 1200,
          fromTimelineEndMs: 2000,
          toTimelineStartMs: 3500,
          toTimelineEndMs: 4300,
        },
        idempotencyKey: 'idempotency-2',
        clientOperationId: 'client-2',
      },
    ]) as never,
    {
      projectId: 'project-1',
      demoId: 'demo-1',
    },
  );

  const sourceTrack = snapshot.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
  const targetTrack = snapshot.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');

  assert.equal(sourceTrack?.segments.length, 0);
  assert.equal(targetTrack?.segments.length, 1);
  assert.equal(targetTrack?.segments[0]?.timelineStartMs, 3500);
  assert.equal(targetTrack?.segments[0]?.timelineEndMs, 4300);
  assert.equal(targetTrack?.segments[0]?.trackVersionId, 'track-version-b');
});
