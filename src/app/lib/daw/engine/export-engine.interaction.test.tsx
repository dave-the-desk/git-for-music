import { expect, test } from 'vitest';
import { renderDawAudioMix, type DawExportTrack } from './export-engine';
import type { TrackTimelineSegment } from '@/app/lib/daw/utils/segments';

function makeSegment(overrides: Partial<TrackTimelineSegment> = {}): TrackTimelineSegment {
  return {
    id: overrides.id ?? 'segment-1',
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    sourceStartMs: overrides.sourceStartMs ?? 0,
    sourceEndMs: overrides.sourceEndMs ?? 1000,
    timelineStartMs: overrides.timelineStartMs ?? 0,
    timelineEndMs: overrides.timelineEndMs ?? 1000,
    durationMs: overrides.durationMs ?? 1000,
    startMs: overrides.startMs ?? 0,
    endMs: overrides.endMs ?? 1000,
    gainDb: overrides.gainDb ?? 0,
    fadeInMs: overrides.fadeInMs ?? 0,
    fadeOutMs: overrides.fadeOutMs ?? 0,
    isMuted: overrides.isMuted ?? false,
    position: overrides.position ?? 0,
    isImplicit: overrides.isImplicit ?? false,
    crossfadeInMs: overrides.crossfadeInMs ?? null,
    crossfadeOutMs: overrides.crossfadeOutMs ?? null,
    crossfadeCurve: overrides.crossfadeCurve ?? null,
  };
}

function makeTrack(overrides: Partial<DawExportTrack> = {}): DawExportTrack {
  return {
    trackId: overrides.trackId ?? 'track-1',
    trackName: overrides.trackName ?? 'Track 1',
    trackVersionId: overrides.trackVersionId ?? 'track-version-1',
    storageKey: overrides.storageKey ?? '/audio/track-1.wav',
    mimeType: overrides.mimeType ?? 'audio/wav',
    startOffsetMs: overrides.startOffsetMs ?? 0,
    durationMs: overrides.durationMs ?? 1000,
    segments: overrides.segments ?? [makeSegment()],
    recordedTempoBpm: overrides.recordedTempoBpm ?? 120,
    sourceTempoBpm: overrides.sourceTempoBpm ?? 120,
    plugins: overrides.plugins ?? [],
    isMuted: overrides.isMuted ?? false,
    gain: overrides.gain ?? 1,
    pan: overrides.pan ?? 0,
  };
}

function makeBuffer(channelData: Float32Array<ArrayBuffer>[], sampleRate = 1000) {
  return {
    sampleRate,
    numberOfChannels: channelData.length,
    length: channelData[0]?.length ?? 0,
    getChannelData(index: number): Float32Array<ArrayBuffer> {
      return channelData[index] ?? channelData[0] ?? (new Float32Array() as Float32Array<ArrayBuffer>);
    },
  } satisfies Pick<AudioBuffer, 'sampleRate' | 'numberOfChannels' | 'length' | 'getChannelData'>;
}

test('renderDawAudioMix applies gain, pan, and fades to the exported mix', () => {
  const track = makeTrack({
    gain: 2,
    pan: -1,
    segments: [makeSegment({ fadeInMs: 100 })],
  });
  const buffers = new Map([
    ['track-version-1', makeBuffer([Float32Array.from({ length: 1000 }, () => 1) as Float32Array<ArrayBuffer>])],
  ]);

  const rendered = renderDawAudioMix({
    tracks: [track],
    decodedBuffersByTrackVersionId: buffers,
    localTempoBpm: 120,
    sharedDemoTempoBpm: 120,
    sampleRate: 1000,
  });

  expect(rendered.sampleRate).toBe(1000);
  expect(rendered.left.length).toBe(1000);
  expect(rendered.right.length).toBe(1000);
  expect(rendered.left[0]).toBe(0);
  expect(rendered.left[50]).toBe(1);
  expect(rendered.right[50]).toBe(0);
  expect(rendered.left[150]).toBe(2);
  expect(rendered.right[150]).toBe(0);
});

test('renderDawAudioMix omits muted tracks from the exported project mix', () => {
  const track = makeTrack({
    isMuted: true,
    pan: 0,
  });
  const buffers = new Map([
    ['track-version-1', makeBuffer([Float32Array.from({ length: 1000 }, () => 1)])],
  ]);

  const rendered = renderDawAudioMix({
    tracks: [track],
    decodedBuffersByTrackVersionId: buffers,
    localTempoBpm: 120,
    sharedDemoTempoBpm: 120,
    sampleRate: 1000,
  });

  expect(rendered.left[100]).toBe(0);
  expect(rendered.right[100]).toBe(0);
});
