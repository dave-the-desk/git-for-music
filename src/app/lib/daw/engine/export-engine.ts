import { EMPTY_TRACK_MIME_TYPE, buildRenderableTrackSegments, type TrackTimelineSegment } from '@/app/lib/daw/utils/segments';
import { DEFAULT_DEMO_TEMPO_BPM, normalizeTempoBpm } from '@/app/lib/daw/utils/timing';
import type { DawTrack } from '@/app/lib/daw/state/local-project-state';

export type DawExportTrack = Pick<
  DawTrack,
  | 'trackId'
  | 'trackName'
  | 'trackVersionId'
  | 'storageKey'
  | 'mimeType'
  | 'startOffsetMs'
  | 'durationMs'
  | 'segments'
  | 'recordedTempoBpm'
  | 'sourceTempoBpm'
  | 'plugins'
> & {
  isMuted?: boolean;
  gain?: number;
  pan?: number;
};

export type DawExportProjectInput = {
  tracks: DawExportTrack[];
  localTempoBpm: number;
  sharedDemoTempoBpm?: number | null;
  sampleRate?: number;
};

type AudioSampleChannel = Float32Array<ArrayBufferLike>;

type DecodedAudioBufferLike = {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): AudioSampleChannel;
};

export type DawExportRenderedMix = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationMs: number;
};

export type DawExportRenderedFile = {
  trackVersionId: string;
  trackName: string;
  fileName: string;
  blob: Blob;
};

type Mp3EncoderLike = {
  encodeBuffer(left: Int16Array, right: Int16Array): Int8Array | Uint8Array;
  flush(): Int8Array | Uint8Array;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dbToLinear(db: number) {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120) || 'export';
}

function getTrackPlaybackRate(track: DawExportTrack, sharedTempoBpm: number, localTempoBpm: number) {
  const recordedTempoBpm = normalizeTempoBpm(track.recordedTempoBpm ?? track.sourceTempoBpm, sharedTempoBpm);
  return clamp(localTempoBpm / recordedTempoBpm, 0.25, 4);
}

function getSegmentEnvelope(segment: TrackTimelineSegment, elapsedMs: number) {
  const fadeInMs = Math.max(0, segment.fadeInMs + (segment.crossfadeInMs ?? 0));
  const fadeOutMs = Math.max(0, segment.fadeOutMs + (segment.crossfadeOutMs ?? 0));
  const durationMs = Math.max(0, segment.durationMs);
  if (durationMs <= 0) return 0;

  const clampedElapsed = clamp(elapsedMs, 0, durationMs);
  let envelope = 1;

  if (fadeInMs > 0 && clampedElapsed < fadeInMs) {
    envelope *= clampedElapsed / fadeInMs;
  }

  if (fadeOutMs > 0) {
    const remainingMs = durationMs - clampedElapsed;
    if (remainingMs < fadeOutMs) {
      envelope *= Math.max(0, remainingMs / fadeOutMs);
    }
  }

  return clamp(envelope, 0, 1);
}

function getStereoSourceViews(buffer: DecodedAudioBufferLike) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  return { left, right };
}

function sampleChannel(channel: AudioSampleChannel, sourcePosition: number) {
  if (!Number.isFinite(sourcePosition) || sourcePosition < 0) return 0;
  const leftIndex = Math.floor(sourcePosition);
  const fraction = sourcePosition - leftIndex;
  if (leftIndex < 0 || leftIndex >= channel.length) return 0;

  const current = channel[leftIndex] ?? 0;
  const next = channel[leftIndex + 1] ?? current;
  return current + (next - current) * fraction;
}

function encodeInt16Samples(samples: AudioSampleChannel) {
  const result = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = clamp(samples[index] ?? 0, -1, 1);
    result[index] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return result;
}

async function loadMp3Encoder(): Promise<new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike> {
  const globalScope = globalThis as typeof globalThis & {
    lamejs?: { Mp3Encoder?: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike };
  };

  if (!globalScope.lamejs?.Mp3Encoder) {
    await new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-daw-lamejs-bundle="true"]');
      if (existingScript) {
        if (globalScope.lamejs?.Mp3Encoder) {
          resolve();
          return;
        }
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Unable to load MP3 encoder bundle')), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.src = '/vendor/lamejs/lame.all.js';
      script.async = true;
      script.dataset.dawLamejsBundle = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Unable to load MP3 encoder bundle'));
      document.head.appendChild(script);
    });
  }

  const candidate = globalScope.lamejs?.Mp3Encoder;
  if (!candidate) {
    throw new Error('MP3 encoder is unavailable in this environment');
  }

  return candidate;
}

async function loadDecodedAudioBuffer(storageKey: string, audioContext: AudioContext): Promise<DecodedAudioBufferLike> {
  const response = await fetch(storageKey);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio for export: ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  return audioContext.decodeAudioData(bytes.slice(0));
}

function buildRenderableSegments(track: DawExportTrack, fallbackDurationMs: number) {
  return buildRenderableTrackSegments({
    trackVersionId: track.trackVersionId,
    trackStartOffsetMs: track.startOffsetMs,
    segments: track.segments,
    fallbackDurationMs,
    allowImplicitSegment: track.mimeType !== EMPTY_TRACK_MIME_TYPE,
  });
}

function estimateTrackDurationMs(track: DawExportTrack, buffer: DecodedAudioBufferLike, playbackRate: number) {
  const fallbackDurationMs = Math.max(track.durationMs ?? 0, Math.round((buffer.length / buffer.sampleRate) * 1000));
  const segments = buildRenderableSegments(track, fallbackDurationMs);

  if (segments.length === 0) {
    return 0;
  }

  return segments.reduce((maxDuration, segment) => {
    const segmentEndMs = segment.timelineStartMs + segment.durationMs / playbackRate;
    return Math.max(maxDuration, segmentEndMs);
  }, 0);
}

export function renderDawAudioMix(input: {
  tracks: DawExportTrack[];
  decodedBuffersByTrackVersionId: Map<string, DecodedAudioBufferLike>;
  localTempoBpm: number;
  sharedDemoTempoBpm?: number | null;
  sampleRate?: number;
}): DawExportRenderedMix {
  const sharedTempoBpm = normalizeTempoBpm(input.sharedDemoTempoBpm ?? null, DEFAULT_DEMO_TEMPO_BPM);
  const localTempoBpm = normalizeTempoBpm(input.localTempoBpm, sharedTempoBpm);
  const sampleRate = input.sampleRate ?? 44100;

  const trackRenders = input.tracks.flatMap((track) => {
    const buffer = input.decodedBuffersByTrackVersionId.get(track.trackVersionId);
    if (!buffer) return [];

    const playbackRate = getTrackPlaybackRate(track, sharedTempoBpm, localTempoBpm);
    const trackDurationMs = estimateTrackDurationMs(track, buffer, playbackRate);
    const trackGain = Math.max(0, track.gain ?? 1);
    const trackMuted = track.isMuted === true;
    const pan = clamp(track.pan ?? 0, -1, 1);
    const angle = (pan + 1) * (Math.PI / 4);
    const leftPan = Math.cos(angle);
    const rightPan = Math.sin(angle);
    const fallbackDurationMs = Math.max(track.durationMs ?? 0, Math.round((buffer.length / buffer.sampleRate) * 1000));
    const segments = buildRenderableSegments(track, fallbackDurationMs);

    return segments.map((segment) => ({
      buffer,
      segment,
      playbackRate,
      trackDurationMs,
      trackGain: trackMuted ? 0 : trackGain,
      leftPan,
      rightPan,
    }));
  });

  const durationMs = trackRenders.reduce((maxDuration, render) => {
    const segmentEndMs = render.segment.timelineStartMs + render.segment.durationMs / render.playbackRate;
    return Math.max(maxDuration, segmentEndMs, render.trackDurationMs);
  }, 0);
  const totalSamples = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  for (const render of trackRenders) {
    const { buffer, segment, playbackRate, trackGain, leftPan, rightPan } = render;
    const { left: sourceLeft, right: sourceRight } = getStereoSourceViews(buffer);
    const segmentStartSample = Math.max(0, Math.floor((segment.timelineStartMs / 1000) * sampleRate));
    const segmentEndSample = Math.min(
      totalSamples,
      Math.ceil(((segment.timelineStartMs + segment.durationMs / playbackRate) / 1000) * sampleRate),
    );

    for (let sampleIndex = segmentStartSample; sampleIndex < segmentEndSample; sampleIndex += 1) {
      const outputTimeMs = (sampleIndex / sampleRate) * 1000;
      const elapsedOutputMs = outputTimeMs - segment.timelineStartMs;
      if (elapsedOutputMs < 0) continue;

      const sourceElapsedMs = elapsedOutputMs * playbackRate;
      if (sourceElapsedMs < 0 || sourceElapsedMs > segment.durationMs) continue;

      const envelope = getSegmentEnvelope(segment, sourceElapsedMs);
      if (envelope <= 0) continue;

      const sourcePosition = ((segment.sourceStartMs + sourceElapsedMs) / 1000) * buffer.sampleRate;
      const segmentGain = dbToLinear(segment.gainDb) * envelope * trackGain;
      left[sampleIndex] += sampleChannel(sourceLeft, sourcePosition) * segmentGain * leftPan;
      right[sampleIndex] += sampleChannel(sourceRight, sourcePosition) * segmentGain * rightPan;
    }
  }

  return { left, right, sampleRate, durationMs };
}

async function encodeStereoMp3(left: Float32Array, right: Float32Array, sampleRate: number) {
  const Mp3Encoder = await loadMp3Encoder();
  const encoder = new Mp3Encoder(2, sampleRate, 192);
  const chunks: Uint8Array[] = [];
  const frameSize = 1152;

  for (let index = 0; index < left.length; index += frameSize) {
    const leftChunk = encodeInt16Samples(left.subarray(index, index + frameSize));
    const rightChunk = encodeInt16Samples(right.subarray(index, index + frameSize));
    const mp3Buffer = encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3Buffer.length > 0) {
      chunks.push(new Uint8Array(mp3Buffer.buffer.slice(0, mp3Buffer.byteLength)));
    }
  }

  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) {
    chunks.push(new Uint8Array(finalChunk.buffer.slice(0, finalChunk.byteLength)));
  }

  return new Blob(chunks as unknown as BlobPart[], { type: 'audio/mpeg' });
}

async function decodeTrackBuffers(tracks: DawExportTrack[]) {
  const audioContext = new AudioContext();
  try {
    const decodedBuffersByTrackVersionId = new Map<string, DecodedAudioBufferLike>();
    await Promise.all(
      tracks.map(async (track) => {
        if (decodedBuffersByTrackVersionId.has(track.trackVersionId)) return;
        decodedBuffersByTrackVersionId.set(track.trackVersionId, await loadDecodedAudioBuffer(track.storageKey, audioContext));
      }),
    );
    return decodedBuffersByTrackVersionId;
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function buildTrackFileName(track: DawExportTrack) {
  return `${sanitizeFileName(track.trackName)}.mp3`;
}

export async function renderDawProjectAsMp3Blob(input: DawExportProjectInput) {
  const decodedBuffersByTrackVersionId = await decodeTrackBuffers(input.tracks);
  const rendered = renderDawAudioMix({
    tracks: input.tracks,
    decodedBuffersByTrackVersionId,
    localTempoBpm: input.localTempoBpm,
    sharedDemoTempoBpm: input.sharedDemoTempoBpm,
    sampleRate: input.sampleRate,
  });

  return encodeStereoMp3(rendered.left, rendered.right, rendered.sampleRate);
}

export async function renderDawTrackStemsAsMp3Blobs(input: DawExportProjectInput): Promise<DawExportRenderedFile[]> {
  const decodedBuffersByTrackVersionId = await decodeTrackBuffers(input.tracks);

  const outputs = await Promise.all(
    input.tracks.map(async (track) => {
      const rendered = renderDawAudioMix({
        tracks: [
          {
            ...track,
            isMuted: false,
          },
        ],
        decodedBuffersByTrackVersionId,
        localTempoBpm: input.localTempoBpm,
        sharedDemoTempoBpm: input.sharedDemoTempoBpm,
        sampleRate: input.sampleRate,
      });

      return {
        trackVersionId: track.trackVersionId,
        trackName: track.trackName,
        fileName: buildTrackFileName(track),
        blob: await encodeStereoMp3(rendered.left, rendered.right, rendered.sampleRate),
      };
    }),
  );

  return outputs;
}
