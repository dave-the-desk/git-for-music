'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
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
  startOffsetMs: number;
  durationMs: number;
  onDurationReady: (trackVersionId: string, durationMs: number) => void;
};

export const TrackWaveform = forwardRef<TrackWaveformHandle, TrackWaveformProps>(
  function TrackWaveform({ trackVersionId, storageKey, startOffsetMs, durationMs, onDurationReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null);

    const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;
    const leftPx = (startOffsetMs / 1000) * PX_PER_SECOND;
    const widthPx = durationSeconds > 0 ? durationSeconds * PX_PER_SECOND : 200;

    useEffect(() => {
      if (!containerRef.current) return;

      let ws: import('wavesurfer.js').default;

      async function init() {
        const WaveSurfer = (await import('wavesurfer.js')).default;

        if (!containerRef.current) return;

        ws = WaveSurfer.create({
          container: containerRef.current,
          url: storageKey,
          waveColor: '#6366f1',
          progressColor: '#a5b4fc',
          cursorWidth: 0,
          height: 56,
          normalize: true,
          interact: false,
          backend: 'WebAudio',
        });

        ws.on('ready', () => {
          const dur = ws.getDuration();
          if (dur > 0) {
            onDurationReady(trackVersionId, dur * 1000);
          }
        });

        wavesurferRef.current = ws;
      }

      void init();

      return () => {
        ws?.destroy();
        wavesurferRef.current = null;
      };
      // storageKey is stable per TrackVersion — intentionally not re-running on other prop changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, trackVersionId]);

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
        className="absolute top-0 h-full rounded overflow-hidden border border-indigo-800 bg-gray-900"
        style={{ left: leftPx, width: widthPx }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    );
  },
);
