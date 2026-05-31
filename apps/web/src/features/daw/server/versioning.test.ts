import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versioning';

test('createDemoVersionWithCopiedTracks preserves moved segment placement when cloning a version', async () => {
  const createdSegments: Array<Record<string, unknown>> = [];
  const sourceTrackVersion = {
    id: 'track-version-a',
    trackId: 'track-a',
    storageKey: '/tracks/a.wav',
    sourceFileUrl: null,
    startOffsetMs: 0,
    durationMs: 2000,
    sampleRate: 48000,
    channels: 2,
    mimeType: 'audio/wav',
    sizeBytes: 1024,
    checksum: 'checksum-a',
    isDerived: false,
    operationType: 'ORIGINAL',
    parentTrackVersionId: null,
    track: {
      name: 'Track A',
      position: 0,
    },
    segments: [
      {
        id: 'segment-1',
        startMs: 100,
        endMs: 900,
        timelineStartMs: 3500,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      {
        id: 'segment-2',
        startMs: 900,
        endMs: 1700,
        timelineStartMs: 4300,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 1,
      },
    ],
  };

  const tx = {
    demo: {
      findFirst: async () => null,
    },
    demoVersion: {
      findFirst: async () => ({
        description: 'Source version',
        tempoBpm: 120,
        timeSignatureNum: 4,
        timeSignatureDen: 4,
        musicalKey: null,
        tempoSource: 'MANUAL',
        keySource: 'MANUAL',
      }),
      create: async (args: {
        data: {
          demoId: string;
          label: string;
          description: string | null;
          tempoBpm?: number | null;
          timeSignatureNum?: number;
          timeSignatureDen?: number;
          musicalKey?: string | null;
          tempoSource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
          keySource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
          parentId: string | null;
        };
      }) => ({
        id: 'version-clone',
        label: args.data.label,
        description: args.data.description,
        tempoBpm: args.data.tempoBpm ?? 120,
        timeSignatureNum: args.data.timeSignatureNum ?? 4,
        timeSignatureDen: args.data.timeSignatureDen ?? 4,
        musicalKey: args.data.musicalKey ?? null,
        tempoSource: args.data.tempoSource ?? 'MANUAL',
        keySource: args.data.keySource ?? 'MANUAL',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        parentId: args.data.parentId,
      }),
    },
    trackVersion: {
      findMany: async () => [sourceTrackVersion],
      create: async (args: {
        data: Record<string, unknown>;
      }) => ({
        id: 'track-version-clone',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        data: args.data,
      }),
    },
    segment: {
      create: async (args: { data: Record<string, unknown> }) => {
        createdSegments.push(args.data);
        return {
          id: `segment-clone-${createdSegments.length}`,
        };
      },
    },
  } as const;

  const result = await createDemoVersionWithCopiedTracks(tx as never, {
    demoId: 'demo-1',
    label: 'Branch clone',
    sourceVersionId: 'version-root',
    parentId: 'version-root',
  });

  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0]?.trackVersionId, 'track-version-clone');
  assert.equal(result.tracks[0]?.segments[0]?.timelineStartMs, 3500);
  assert.equal(result.tracks[0]?.segments[0]?.startMs, 100);
  assert.equal(result.tracks[0]?.segments[0]?.endMs, 900);
  assert.equal(result.tracks[0]?.segments[0]?.position, 0);
  assert.equal(createdSegments[0]?.timelineStartMs, 3500);
  assert.equal(createdSegments[0]?.position, 0);
});

test('createDemoVersionWithCopiedTracks preserves crossfade metadata from the source version snapshot', async () => {
  const createdSegments: Array<Record<string, unknown>> = [];
  const sourceTrackVersion = {
    id: 'track-version-a',
    trackId: 'track-a',
    storageKey: '/tracks/a.wav',
    sourceFileUrl: null,
    startOffsetMs: 0,
    durationMs: 2000,
    sampleRate: 48000,
    channels: 2,
    mimeType: 'audio/wav',
    sizeBytes: 1024,
    checksum: 'checksum-a',
    isDerived: false,
    operationType: 'ORIGINAL',
    parentTrackVersionId: null,
    track: {
      name: 'Track A',
      position: 0,
    },
    segments: [
      {
        id: 'segment-1',
        startMs: 100,
        endMs: 900,
        timelineStartMs: 3500,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
    ],
  };

  const sourceSnapshot = {
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
              segments: [
                {
                  id: 'segment-1',
                  trackVersionId: 'track-version-a',
                  startMs: 100,
                  endMs: 900,
                  timelineStartMs: 3500,
                  gainDb: 0,
                  fadeInMs: 0,
                  fadeOutMs: 0,
                  isMuted: false,
                  position: 0,
                  crossfadeInMs: null,
                  crossfadeOutMs: null,
                  crossfadeCurve: null,
                },
                {
                  id: 'segment-2',
                  trackVersionId: 'track-version-a',
                  startMs: 900,
                  endMs: 1700,
                  timelineStartMs: 4300,
                  gainDb: 0,
                  fadeInMs: 0,
                  fadeOutMs: 0,
                  isMuted: false,
                  position: 1,
                  crossfadeInMs: null,
                  crossfadeOutMs: null,
                  crossfadeCurve: null,
                },
              ],
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

  const tx = {
    demo: {
      findFirst: async () => ({
        projectId: 'project-1',
      }),
    },
    demoVersion: {
      findFirst: async (args?: { select?: { demoId?: boolean } }) => {
        if (args?.select && 'demoId' in args.select) {
          return {
            demoId: 'demo-1',
          };
        }

        return {
          description: 'Source version',
          tempoBpm: 120,
          timeSignatureNum: 4,
          timeSignatureDen: 4,
          musicalKey: null,
          tempoSource: 'MANUAL',
          keySource: 'MANUAL',
        };
      },
      create: async (args: {
        data: {
          demoId: string;
          label: string;
          description: string | null;
          tempoBpm?: number | null;
          timeSignatureNum?: number;
          timeSignatureDen?: number;
          musicalKey?: string | null;
          tempoSource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
          keySource?: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
          parentId: string | null;
        };
      }) => ({
        id: 'version-clone',
        label: args.data.label,
        description: args.data.description,
        tempoBpm: args.data.tempoBpm ?? 120,
        timeSignatureNum: args.data.timeSignatureNum ?? 4,
        timeSignatureDen: args.data.timeSignatureDen ?? 4,
        musicalKey: args.data.musicalKey ?? null,
        tempoSource: args.data.tempoSource ?? 'MANUAL',
        keySource: args.data.keySource ?? 'MANUAL',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        parentId: args.data.parentId,
      }),
    },
    projectSnapshot: {
      findFirst: async () => sourceSnapshot,
    },
    projectOperationLog: {
      findMany: async () => [
        {
          id: 'op-2',
          projectId: 'project-1',
          demoId: 'demo-1',
          operationType: 'CROSSFADE_SET',
          createdAt: '2025-01-02T00:00:00.000Z',
          actorUserId: 'user-b',
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          operationSeq: 2,
          payload: {
            trackVersionId: 'track-version-a',
            leftSegmentId: 'segment-1',
            rightSegmentId: 'segment-2',
            crossfadeInMs: 250,
            crossfadeOutMs: 250,
            curve: 'linear',
          },
          idempotencyKey: 'idempotency-2',
          clientOperationId: 'client-2',
        },
      ],
    },
    trackVersion: {
      findMany: async () => [sourceTrackVersion],
      create: async (args: {
        data: Record<string, unknown>;
      }) => ({
        id: 'track-version-clone',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        data: args.data,
      }),
    },
    segment: {
      create: async (args: { data: Record<string, unknown> }) => {
        createdSegments.push(args.data);
        return {
          id: `segment-clone-${createdSegments.length}`,
        };
      },
    },
  } as const;

  const result = await createDemoVersionWithCopiedTracks(tx as never, {
    demoId: 'demo-1',
    label: 'Branch clone',
    sourceVersionId: 'version-root',
    parentId: 'version-root',
  });

  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0]?.trackVersionId, 'track-version-clone');
  assert.equal(result.tracks[0]?.segments[0]?.crossfadeInMs, null);
  assert.equal(result.tracks[0]?.segments[0]?.crossfadeOutMs, 250);
  assert.equal(result.tracks[0]?.segments[0]?.crossfadeCurve, 'linear');
  assert.equal(result.tracks[0]?.segments[1]?.crossfadeInMs, 250);
  assert.equal(result.tracks[0]?.segments[1]?.crossfadeOutMs, null);
  assert.equal(result.tracks[0]?.segments[1]?.crossfadeCurve, 'linear');
  assert.equal(createdSegments[0]?.crossfadeInMs, undefined);
  assert.equal(createdSegments[0]?.crossfadeOutMs, undefined);
  assert.equal(createdSegments[0]?.crossfadeCurve, undefined);
  assert.equal(createdSegments[1]?.crossfadeInMs, undefined);
  assert.equal(createdSegments[1]?.crossfadeOutMs, undefined);
  assert.equal(createdSegments[1]?.crossfadeCurve, undefined);
});
