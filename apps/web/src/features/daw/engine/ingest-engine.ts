import type {
  DawAssetCompleteUploadRequest,
  DawAssetUploadRequest,
  DawAssetUploadResponse,
  UploadTimingChoice,
  UploadTrackResponse,
} from '@git-for-music/shared';
import { dawLocalCache } from '@/features/daw/engine/daw-local-cache';
import { waveformCacheEngine } from '@/features/daw/engine/waveform-cache';
import type { WaveformPeak } from '@/features/daw/state/ui-state';

const PEAK_WINDOW_MS = 10;

export type AudioPreview = {
  previewUrl: string;
  peaks: WaveformPeak[];
  durationMs: number;
  checksum: string;
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
  sizeBytes: number;
};

export type IngestUploadInput = {
  demoId: string;
  projectId: string;
  name?: string;
  sourceVersionId?: string;
  trackId?: string;
  startOffsetMs?: number;
  sourceType?: 'recording' | 'upload';
  recordedTempoBpm?: number | null;
  sourceTempoBpm?: number | null;
  timingChoice: UploadTimingChoice;
  file: File;
};

export class AudioIngestEngine {
  createObjectUrl(blob: Blob) {
    return URL.createObjectURL(blob);
  }

  revokeObjectUrl(url: string) {
    URL.revokeObjectURL(url);
  }

  async readAudioMetadata(file: Blob) {
    const bytes = await file.arrayBuffer();
    const checksumBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const checksum = Array.from(new Uint8Array(checksumBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(bytes.slice(0));
      return {
        checksum,
        durationMs: Math.max(0, Math.round(audioBuffer.duration * 1000)),
        sampleRate: audioBuffer.sampleRate,
        bitDepth: 16,
        channelCount: audioBuffer.numberOfChannels,
        sizeBytes: file.size,
      };
    } catch {
      return {
        checksum,
        durationMs: 0,
        sampleRate: audioContext.sampleRate || 44100,
        bitDepth: 16,
        channelCount: 2,
        sizeBytes: file.size,
      };
    } finally {
      await audioContext.close().catch(() => {});
    }
  }

  async generateLocalPeaks(file: Blob): Promise<WaveformPeak[]> {
    const preview = await waveformCacheEngine.resolveWaveform({
      projectId: 'local',
      demoId: 'local',
      localBlobId: `blob:${crypto.randomUUID()}`,
      blob: file,
      forceRefresh: true,
    });
    return preview?.peaks ?? [];
  }

  async createLocalPreview(file: Blob): Promise<AudioPreview> {
    const previewUrl = this.createObjectUrl(file);
    const metadata = await this.readAudioMetadata(file);
    const peaks = await this.generateLocalPeaks(file);

    return {
      previewUrl,
      peaks,
      ...metadata,
    };
  }

  async uploadAudioFile(input: IngestUploadInput): Promise<UploadTrackResponse & { assetId: string }> {
    const localBlobId = `local:${crypto.randomUUID()}`;
    const localMetadata = {
      mimeType: input.file.type || 'application/octet-stream',
      sizeBytes: input.file.size,
      recordedTempoBpm: input.recordedTempoBpm ?? null,
      sourceTempoBpm: input.sourceTempoBpm ?? null,
    };
    await dawLocalCache.putAsset({
      projectId: input.projectId,
      demoId: input.demoId,
      assetId: null,
      localBlobId,
      trackId: null,
      trackVersionId: null,
      storageKey: null,
      blob: input.file,
      uploadState: 'queued',
      metadata: localMetadata,
    });
    await waveformCacheEngine.cacheLocalPeaks({
      projectId: input.projectId,
      demoId: input.demoId,
      localBlobId,
      blob: input.file,
    });

    await dawLocalCache.updateAsset(input.projectId, input.demoId, localBlobId, (record) => ({
      ...record,
      uploadState: 'signing',
    }));

    const metadata = await this.readAudioMetadata(input.file);
    const signResponse = await fetch('/api/daw/assets/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        demoId: input.demoId,
        projectId: input.projectId,
        trackId: input.trackId ?? undefined,
        name: input.name?.trim() || undefined,
        sourceVersionId: input.sourceVersionId,
        timingChoice: input.timingChoice,
        fileName: input.file.name,
        contentType: input.file.type || 'application/octet-stream',
        sizeBytes: input.file.size,
      } satisfies DawAssetUploadRequest),
    });

    const signData = (await signResponse.json()) as DawAssetUploadResponse | { error?: string };
    if (!signResponse.ok) {
      await dawLocalCache.updateAsset(input.projectId, input.demoId, localBlobId, (record) => ({
        ...record,
        uploadState: 'failed',
        metadata: {
          ...(record.metadata ?? {}),
          ...localMetadata,
          checksum: metadata.checksum,
          durationMs: metadata.durationMs,
          sampleRate: metadata.sampleRate,
          bitDepth: metadata.bitDepth,
          channelCount: metadata.channelCount,
        },
      }));
      throw new Error('error' in signData ? signData.error ?? 'Could not prepare upload' : 'Could not prepare upload');
    }

    const uploadData = signData as DawAssetUploadResponse;
    await dawLocalCache.updateAsset(input.projectId, input.demoId, localBlobId, (record) => ({
      ...record,
      uploadState: 'uploading',
      metadata: {
        ...(record.metadata ?? {}),
        ...localMetadata,
        checksum: metadata.checksum,
        durationMs: metadata.durationMs,
        sampleRate: metadata.sampleRate,
        bitDepth: metadata.bitDepth,
        channelCount: metadata.channelCount,
      },
    }));

    const uploadResponse = await fetch(uploadData.uploadUrl, {
      method: uploadData.method,
      headers: new Headers(uploadData.headers),
      body: input.file,
    });

    if (!uploadResponse.ok) {
      await dawLocalCache.updateAsset(input.projectId, input.demoId, localBlobId, (record) => ({
        ...record,
        uploadState: 'failed',
      }));
      throw new Error('Could not upload file');
    }

    const completeBody: DawAssetCompleteUploadRequest = {
      uploadToken: uploadData.uploadToken,
      checksum: metadata.checksum,
      durationMs: metadata.durationMs,
      sampleRate: metadata.sampleRate,
      bitDepth: metadata.bitDepth,
      channelCount: metadata.channelCount,
      sizeBytes: metadata.sizeBytes,
    };

    const completeResponse = await fetch('/api/daw/assets/complete-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(completeBody),
    });

    const completeData = (await completeResponse.json()) as UploadTrackResponse | { error?: string };
    if (!completeResponse.ok) {
      await dawLocalCache.updateAsset(input.projectId, input.demoId, localBlobId, (record) => ({
        ...record,
        uploadState: 'failed',
      }));
      throw new Error(
        'error' in completeData ? completeData.error ?? 'Could not complete upload' : 'Could not complete upload',
      );
    }

    await dawLocalCache.deleteAsset(input.projectId, input.demoId, localBlobId);

    return {
      ...(completeData as UploadTrackResponse),
      assetId: uploadData.assetId,
    };
  }

  async uploadRecordedBlob(input: Omit<IngestUploadInput, 'file'> & { blob: Blob }) {
    const ext = input.blob.type.includes('ogg')
      ? 'ogg'
      : input.blob.type.includes('mp4')
        ? 'mp4'
        : 'webm';
    const file = new File([input.blob], `recording-${Date.now()}.${ext}`, { type: input.blob.type });
    return this.uploadAudioFile({ ...input, sourceType: 'recording', file });
  }

  private buildPeaksFromAudioBuffer(audioBuffer: AudioBuffer): WaveformPeak[] {
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

      peaks.push({
        timeMs: startTimeMs,
        min,
        max,
      });
    }

    return peaks;
  }
}
