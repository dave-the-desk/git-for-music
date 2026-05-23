import { dawLocalCache } from '@/features/daw/engine/daw-local-cache';
import type { WaveformPeak } from '@/features/daw/state/ui-state';

const PEAK_WINDOW_MS = 10;

export type WaveformCacheEntry = {
  peaks: WaveformPeak[];
  durationMs: number;
  source: 'cached' | 'remote' | 'local';
};

export type WaveformCacheResolveInput = {
  projectId: string;
  demoId: string;
  assetId?: string | null;
  localBlobId?: string | null;
  blob?: Blob | null;
  signedDownloadUrl?: string | null;
  forceRefresh?: boolean;
};

function cacheKey(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
  return `${projectId}:${demoId}:${assetIdOrLocalBlobId}`;
}

function createObjectUrl(blob: Blob) {
  return URL.createObjectURL(blob);
}

function revokeObjectUrl(url: string) {
  URL.revokeObjectURL(url);
}

async function decodeAudioBuffer(bytes: ArrayBuffer) {
  const audioContext = new AudioContext();
  try {
    return await audioContext.decodeAudioData(bytes.slice(0));
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function buildPeaksFromAudioBuffer(audioBuffer: AudioBuffer): WaveformPeak[] {
  const durationMs = Math.max(0, Math.round(audioBuffer.duration * 1000));
  const peakCount = Math.max(1, Math.ceil(durationMs / PEAK_WINDOW_MS));
  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
    audioBuffer.getChannelData(index),
  );
  const peaks: WaveformPeak[] = [];

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const startTimeMs = peakIndex * PEAK_WINDOW_MS;
    const startSample = Math.floor((startTimeMs / 1000) * audioBuffer.sampleRate);
    const endSample = Math.min(
      audioBuffer.length,
      Math.floor(((peakIndex + 1) * PEAK_WINDOW_MS / 1000) * audioBuffer.sampleRate),
    );
    const sampleSpan = Math.max(1, endSample - startSample);
    const step = Math.max(1, Math.floor(sampleSpan / 256));

    let min = 1;
    let max = -1;

    for (const channel of channelData) {
      for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += step) {
        const sample = channel[sampleIndex] ?? 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
    }

    peaks.push({ timeMs: startTimeMs, min, max });
  }

  return peaks;
}

async function generatePeaksFromBlob(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  const audioBuffer = await decodeAudioBuffer(bytes);
  return {
    peaks: buildPeaksFromAudioBuffer(audioBuffer),
    durationMs: Math.max(0, Math.round(audioBuffer.duration * 1000)),
  };
}

export class WaveformCacheEngine {
  private readonly memoryCache = new Map<string, WaveformCacheEntry>();

  async resolveWaveform(input: WaveformCacheResolveInput): Promise<WaveformCacheEntry | null> {
    const identifier = input.assetId ?? input.localBlobId ?? null;
    if (!identifier) return null;

    const key = cacheKey(input.projectId, input.demoId, identifier);
    if (!input.forceRefresh) {
      const memoryHit = this.memoryCache.get(key);
      if (memoryHit) return memoryHit;

      const diskHit = await dawLocalCache.getWaveformPeaks(input.projectId, input.demoId, identifier);
      if (diskHit) {
        const entry: WaveformCacheEntry = {
          peaks: diskHit.peaks,
          durationMs: diskHit.durationMs,
          source: 'cached',
        };
        this.memoryCache.set(key, entry);
        return entry;
      }
    }

    if (input.blob) {
      const generated = await generatePeaksFromBlob(input.blob);
      const entry: WaveformCacheEntry = {
        ...generated,
        source: 'local',
      };
      await this.persist(input, entry);
      return entry;
    }

    if (input.signedDownloadUrl) {
      const response = await fetch(input.signedDownloadUrl);
      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = (await response.json()) as { peaks?: WaveformPeak[]; durationMs?: number };
          if (Array.isArray(json.peaks) && typeof json.durationMs === 'number') {
            const entry: WaveformCacheEntry = {
              peaks: json.peaks,
              durationMs: json.durationMs,
              source: 'remote',
            };
            await this.persist(input, entry);
            return entry;
          }
        }

        const bytes = await response.arrayBuffer();
        const audioBuffer = await decodeAudioBuffer(bytes);
        const entry: WaveformCacheEntry = {
          peaks: buildPeaksFromAudioBuffer(audioBuffer),
          durationMs: Math.max(0, Math.round(audioBuffer.duration * 1000)),
          source: 'remote',
        };
        await this.persist(input, entry);
        return entry;
      }
    }

    return null;
  }

  async cacheLocalPeaks(input: {
    projectId: string;
    demoId: string;
    localBlobId: string;
    blob: Blob;
  }) {
    const entry = await this.resolveWaveform({
      projectId: input.projectId,
      demoId: input.demoId,
      localBlobId: input.localBlobId,
      blob: input.blob,
      forceRefresh: true,
    });
    return entry;
  }

  async cacheAssetPeaks(input: {
    projectId: string;
    demoId: string;
    assetId: string;
    signedDownloadUrl?: string | null;
    blob?: Blob | null;
    forceRefresh?: boolean;
  }) {
    return this.resolveWaveform({
      projectId: input.projectId,
      demoId: input.demoId,
      assetId: input.assetId,
      signedDownloadUrl: input.signedDownloadUrl ?? null,
      blob: input.blob ?? null,
      forceRefresh: input.forceRefresh,
    });
  }

  async invalidatePeaks(input: { projectId: string; demoId: string; assetIdOrLocalBlobId: string }) {
    const key = cacheKey(input.projectId, input.demoId, input.assetIdOrLocalBlobId);
    this.memoryCache.delete(key);
    await dawLocalCache.deleteWaveformPeaks(input.projectId, input.demoId, input.assetIdOrLocalBlobId);
  }

  clearMemoryCache() {
    this.memoryCache.clear();
  }

  private async persist(
    input: Pick<WaveformCacheResolveInput, 'projectId' | 'demoId' | 'assetId' | 'localBlobId'>,
    entry: WaveformCacheEntry,
  ) {
    const identifier = input.assetId ?? input.localBlobId;
    if (!identifier) return;

    this.memoryCache.set(cacheKey(input.projectId, input.demoId, identifier), entry);
    await dawLocalCache.putWaveformPeaks({
      projectId: input.projectId,
      demoId: input.demoId,
      assetId: input.assetId ?? null,
      localBlobId: input.localBlobId ?? null,
      durationMs: entry.durationMs,
      peaks: entry.peaks,
      sourceUrl: null,
    });
  }
}

export const waveformCacheEngine = new WaveformCacheEngine();

export { createObjectUrl, revokeObjectUrl, generatePeaksFromBlob };
