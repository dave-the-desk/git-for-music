'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PX_PER_SECOND } from '@/features/daw/components/TimelineRuler';
import type { TrackTimelineSegment } from '@/features/daw/utils/segments';

export type TrackSegmentClipHandle = {
  playSegmentFromTimelineTime: (timelineTimeMs: number) => void;
  pause: () => void;
  stop: () => void;
  seekToTimelineTimeMs: (timelineTimeMs: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
};

type TrackSegmentClipProps = {
  trackVersionId: string;
  segment: TrackTimelineSegment;
  storageKey: string;
  isSelected: boolean;
  isMuted: boolean;
  isDragging: boolean;
  timelineTool: 'select' | 'split';
  currentTimeMs: number;
  onDurationReady?: (trackVersionId: string, durationMs: number) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export const TrackSegmentClip = forwardRef<TrackSegmentClipHandle, TrackSegmentClipProps>(
  function TrackSegmentClip(
    {
      trackVersionId,
      segment,
      storageKey,
      isSelected,
      isMuted,
      isDragging,
      timelineTool,
      currentTimeMs,
      onDurationReady,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null);
    const isPlayingRef = useRef(false);
    const durationSecondsRef = useRef<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [sourceDurationMs, setSourceDurationMs] = useState(0);
    const clipWidthPx = Math.max(12, (segment.durationMs / 1000) * PX_PER_SECOND);
    const leftPx = (segment.timelineStartMs / 1000) * PX_PER_SECOND;
    const sourceOffsetPx = (segment.sourceStartMs / 1000) * PX_PER_SECOND;
    const sourceWidthPx = sourceDurationMs > 0 ? (sourceDurationMs / 1000) * PX_PER_SECOND : Math.max(clipWidthPx, 200);
    const isPlayheadInside = currentTimeMs >= segment.timelineStartMs && currentTimeMs <= segment.timelineEndMs;

    useEffect(() => {
      if (!containerRef.current) return;

      let ws: import('wavesurfer.js').default | null = null;

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
          minPxPerSec: PX_PER_SECOND,
          fillParent: false,
          hideScrollbar: true,
        });

        ws.on('ready', () => {
          const dur = ws?.getDuration() ?? 0;
          if (dur > 0) {
            durationSecondsRef.current = dur;
            setSourceDurationMs(dur * 1000);
            setIsReady(true);
            onDurationReady?.(trackVersionId, dur * 1000);
          }
        });

        ws.on('finish', () => {
          isPlayingRef.current = false;
        });

        wavesurferRef.current = ws;
      }

      void init();

      return () => {
        ws?.destroy();
        wavesurferRef.current = null;
        isPlayingRef.current = false;
      };
    }, [storageKey, trackVersionId, onDurationReady]);

    function seekWaveformToTimelineTimeMs(timelineTimeMs: number) {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const durationSeconds = durationSecondsRef.current;
      if (!durationSeconds) return;

      const clampedTimelineTimeMs = Math.max(segment.timelineStartMs, Math.min(timelineTimeMs, segment.timelineEndMs));
      const sourceTimeSeconds =
        (segment.sourceStartMs + (clampedTimelineTimeMs - segment.timelineStartMs)) / 1000;
      const progress = Math.max(0, Math.min(sourceTimeSeconds / durationSeconds, 1));
      ws.seekTo(progress);
    }

    function syncPlayback(timelineTimeMs: number, shouldPlay: boolean) {
      const ws = wavesurferRef.current;
      if (!ws) return;

      const isInside = timelineTimeMs >= segment.timelineStartMs && timelineTimeMs <= segment.timelineEndMs;
      if (!shouldPlay) {
        pause();
        seekWaveformToTimelineTimeMs(timelineTimeMs);
        return;
      }

      if (!isInside) {
        if (isPlayingRef.current) {
          pause();
        }
        seekWaveformToTimelineTimeMs(timelineTimeMs);
        return;
      }

      if (isPlayingRef.current) {
        return;
      }

      const sourceTimeSeconds =
        (segment.sourceStartMs + (timelineTimeMs - segment.timelineStartMs)) / 1000;
      const endSeconds = segment.sourceEndMs / 1000;
      isPlayingRef.current = true;
      void ws.play(sourceTimeSeconds, endSeconds).catch(() => {
        isPlayingRef.current = false;
      });
    }

    function pause() {
      const ws = wavesurferRef.current;
      if (!ws) return;
      ws.pause();
      isPlayingRef.current = false;
    }

    function stop() {
      const ws = wavesurferRef.current;
      if (!ws) return;
      ws.stop();
      isPlayingRef.current = false;
      seekWaveformToTimelineTimeMs(segment.timelineStartMs);
    }

    useImperativeHandle(ref, () => ({
      playSegmentFromTimelineTime(timelineTimeMs: number) {
        syncPlayback(timelineTimeMs, true);
      },
      pause,
      stop,
      seekToTimelineTimeMs(timelineTimeMs: number) {
        syncPlayback(timelineTimeMs, false);
      },
      setMuted(muted: boolean) {
        wavesurferRef.current?.setMuted(muted);
      },
      setVolume(volume: number) {
        wavesurferRef.current?.setVolume(volume);
      },
    }));

    useEffect(() => {
      wavesurferRef.current?.setMuted(isMuted);
    }, [isMuted]);

    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        title={
          timelineTool === 'split'
            ? 'Cut tool: click a clip to split it'
            : 'Select tool: drag this clip to move it'
        }
        className={`absolute top-2 z-10 rounded-md border px-2 py-1 text-left transition-colors ${
          isSelected
            ? 'border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]'
            : 'border-gray-700 bg-gray-900/70 text-gray-300 hover:border-indigo-400 hover:bg-indigo-500/10'
        } ${
          isMuted ? 'opacity-40' : ''
        } ${isPlayheadInside ? 'ring-1 ring-indigo-400/40' : ''} ${
          isDragging ? 'cursor-grabbing' : timelineTool === 'split' ? 'cursor-crosshair' : 'cursor-grab'
        }`}
        style={{
          left: leftPx,
          width: clipWidthPx,
          minHeight: 56,
        }}
      >
        <div className="pointer-events-none relative h-full overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: sourceWidthPx,
              transform: `translateX(-${sourceOffsetPx}px)`,
            }}
          >
            <div ref={containerRef} className="h-full w-full" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-gray-950/35 via-transparent to-gray-950/55" />
          <div className="absolute bottom-1 left-2 right-2 flex items-end justify-between gap-2">
            <span className="truncate text-[10px] uppercase tracking-wide opacity-75">
              {segment.isImplicit ? 'Clip' : `Clip ${segment.position + 1}`}
            </span>
            <span className="text-[10px] font-medium">
              {Math.max(0, Math.round(segment.durationMs / 1000))}s
            </span>
          </div>
          <div className="absolute inset-0 border border-white/5" />
          {isReady ? null : (
            <div className="absolute inset-0 animate-pulse bg-gray-900/40" aria-hidden />
          )}
        </div>
      </button>
    );
  },
);
