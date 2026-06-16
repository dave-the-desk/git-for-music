'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PX_PER_SECOND } from './TimelineRuler';

export type TrackWaveformHandle = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekToTimeMs: (timeMs: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
};

type TrackWaveformProps = {
  trackVersionId: string;
  storageKey: string;
  mimeType?: string | null;
  startOffsetMs: number;
  durationMs: number;
  onDurationReady: (trackVersionId: string, durationMs: number) => void;
};

export const TrackWaveform = forwardRef<TrackWaveformHandle, TrackWaveformProps>(
  function TrackWaveform({ trackVersionId, storageKey, mimeType, startOffsetMs, durationMs, onDurationReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;
    const leftPx = (startOffsetMs / 1000) * PX_PER_SECOND;
    const widthPx = durationSeconds > 0 ? durationSeconds * PX_PER_SECOND : 200;

    useEffect(() => {
      if (!containerRef.current) return;
      setLoadError(null);

      if (mimeType) {
        const audio = document.createElement('audio');
        if (audio.canPlayType(mimeType) === '') {
          setLoadError('This audio format is not supported in this browser.');
          return;
        }
      }

      let ws: import('wavesurfer.js').default | null = null;
      let isCancelled = false;

      async function init() {
        try {
          const WaveSurfer = (await import('wavesurfer.js')).default;

          if (!containerRef.current || isCancelled) return;

          ws = WaveSurfer.create({
            container: containerRef.current,
            url: storageKey,
            waveColor: '#6366f1',
            progressColor: '#a5b4fc',
            cursorWidth: 0,
            height: 56,
            normalize: true,
            interact: false,
          });

          ws.on('ready', () => {
            const dur = ws?.getDuration() ?? 0;
            if (dur > 0) {
              onDurationReady(trackVersionId, dur * 1000);
            }
          });

          ws.on('error', (error) => {
            console.warn('[TrackWaveform] Failed to decode audio waveform', {
              trackVersionId,
              mimeType,
              error,
            });
            setLoadError('Unable to decode this audio in the current browser.');
          });

          wavesurferRef.current = ws;
        } catch (error) {
          console.warn('[TrackWaveform] Failed to initialize waveform', {
            trackVersionId,
            mimeType,
            error,
          });
          setLoadError('Unable to load waveform preview.');
        }
      }

      void init();

      return () => {
        isCancelled = true;
        ws?.destroy();
        wavesurferRef.current = null;
      };
      // storageKey is stable per TrackVersion — intentionally not re-running on other prop changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mimeType, storageKey, trackVersionId]);

    useImperativeHandle(ref, () => ({
      play() {
        wavesurferRef.current?.play();
      },
      pause() {
        wavesurferRef.current?.pause();
      },
      stop() {
        const ws = wavesurferRef.current;
        if (!ws) return;
        ws.pause();
        ws.seekTo(0);
      },
      seekToTimeMs(timeMs: number) {
        const ws = wavesurferRef.current;
        if (!ws) return;
        const dur = ws.getDuration();
        if (!dur) return;
        const relativeMs = timeMs - startOffsetMs;
        if (relativeMs < 0) {
          ws.seekTo(0);
          return;
        }
        const progress = Math.min(relativeMs / (dur * 1000), 1);
        ws.seekTo(progress);
      },
      setMuted(muted: boolean) {
        wavesurferRef.current?.setMuted(muted);
      },
      setVolume(volume: number) {
        wavesurferRef.current?.setVolume(volume);
      },
    }));

    return (
      <div
        className="absolute top-0 h-full overflow-hidden rounded border border-indigo-800 bg-gray-900"
        style={{ left: leftPx, width: widthPx }}
      >
        {loadError ? (
          <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] leading-tight text-gray-500">
            {loadError}
          </div>
        ) : (
          <div ref={containerRef} className="h-full w-full" />
        )}
      </div>
    );
  },
);
