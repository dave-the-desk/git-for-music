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
    ],
  };

  const tx = {
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
