'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PX_PER_SECOND } from '@/features/daw/components/TimelineRuler';
import type { TrackLaneVisualSegment } from '@/features/daw/rendering/visual-renderer';

export type TrackSegmentClipHandle = {
  playSegmentFromTimelineTime: (timelineTimeMs: number) => void;
  pause: () => void;
  stop: () => void;
  seekToTimelineTimeMs: (timelineTimeMs: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
};

type FadeHandleEdge = 'left' | 'right';

type TrackSegmentClipProps = {
  trackVersionId: string;
  segment: TrackLaneVisualSegment;
  storageKey: string;
  isSelected: boolean;
  isPendingMerge: boolean;
  isPendingCrossfade: boolean;
  isFadeSelected: boolean;
  isMuted: boolean;
  isDragging: boolean;
  isMergeSelectable: boolean;
  isFadeSelectable: boolean;
  isCrossfadeSelectable: boolean;
  timelineTool: 'select' | 'split' | 'merge' | 'fade' | 'crossfade';
  currentTimeMs: number;
  onDurationReady?: (trackVersionId: string, durationMs: number) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onFadeHandlePointerDown: (edge: FadeHandleEdge, event: React.PointerEvent<HTMLDivElement>) => void;
  onFadeHandlePointerMove: (edge: FadeHandleEdge, event: React.PointerEvent<HTMLDivElement>) => void;
  onFadeHandlePointerUp: (edge: FadeHandleEdge, event: React.PointerEvent<HTMLDivElement>) => void;
  onFadeHandlePointerCancel: (edge: FadeHandleEdge) => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export const TrackSegmentClip = forwardRef<TrackSegmentClipHandle, TrackSegmentClipProps>(
  function TrackSegmentClip(
    {
      trackVersionId,
      segment,
      storageKey,
      isSelected,
      isPendingMerge,
      isPendingCrossfade,
      isFadeSelected,
      isMuted,
      isDragging,
      isMergeSelectable,
      isFadeSelectable,
      isCrossfadeSelectable,
      timelineTool,
      currentTimeMs,
      onDurationReady,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onFadeHandlePointerDown,
      onFadeHandlePointerMove,
      onFadeHandlePointerUp,
      onFadeHandlePointerCancel,
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
    const clipWidthPx = Math.max(12, segment.widthPx);
    const leftPx = segment.leftPx;
    const sourceOffsetPx = segment.sourceOffsetPx;
    const sourceWidthPx =
      sourceDurationMs > 0 ? (sourceDurationMs / 1000) * PX_PER_SECOND : Math.max(segment.sourceWidthPx, 300);
    const isPlayheadInside = currentTimeMs >= segment.timelineStartMs && currentTimeMs <= segment.timelineEndMs;
    const clipLabel = segment.isImplicit ? 'Clip 1' : `Clip ${segment.position + 1}`;
    const durationLabel = `${Math.max(0, Math.round(segment.durationMs / 1000))}s`;
    const isFadeToolActive = timelineTool === 'fade';

    function stopHandleEvent(event: React.SyntheticEvent) {
      event.stopPropagation();
    }

    useEffect(() => {
      if (!containerRef.current) return;

      let ws: import('wavesurfer.js').default | null = null;
      let rafId = 0;

      async function init() {
        const host = containerRef.current;
        if (!host) return;

        const { width, height } = host.getBoundingClientRect();
        if (width <= 0 || height <= 0) {
          rafId = window.requestAnimationFrame(() => {
            void init();
          });
          return;
        }

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
            ws?.setOptions({ minPxPerSec: PX_PER_SECOND });
          }
        });

        ws.on('finish', () => {
          isPlayingRef.current = false;
        });

        wavesurferRef.current = ws;
      }

      void init();

      return () => {
        if (rafId) {
          window.cancelAnimationFrame(rafId);
        }
        ws?.destroy();
        wavesurferRef.current = null;
        isPlayingRef.current = false;
      };
    }, [storageKey, trackVersionId, onDurationReady]);

    useEffect(() => {
      if (!wavesurferRef.current) return;
      if (sourceDurationMs <= 0) return;
      wavesurferRef.current.setOptions({ minPxPerSec: PX_PER_SECOND });
    }, [sourceDurationMs]);

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

    const fadeInOverlayWidthPx = segment.fadeInWidthPx;
    const fadeOutOverlayWidthPx = segment.fadeOutWidthPx;
    const crossfadeInOverlayWidthPx = segment.crossfadeInWidthPx > 0 ? Math.max(4, segment.crossfadeInWidthPx) : 0;
    const crossfadeOutOverlayWidthPx = segment.crossfadeOutWidthPx > 0 ? Math.max(4, segment.crossfadeOutWidthPx) : 0;

    function renderFadeHandle(edge: FadeHandleEdge) {
      if (!isFadeToolActive || !isFadeSelected) return null;

      const isLeft = edge === 'left';
      const overlayWidthPx = isLeft ? fadeInOverlayWidthPx : fadeOutOverlayWidthPx;
      const handleDotSizePx = 6;
      const handleInsetPx = Math.ceil(handleDotSizePx / 2);
      const handleCenterX = isLeft
        ? Math.max(handleInsetPx, Math.min(clipWidthPx - handleInsetPx, handleInsetPx + segment.fadeInWidthPx))
        : Math.max(
            handleInsetPx,
            Math.min(clipWidthPx - handleInsetPx, clipWidthPx - handleInsetPx - segment.fadeOutWidthPx),
          );
      const overlayGradientClass = isLeft
        ? 'bg-gradient-to-r from-cyan-400/25 to-transparent'
        : 'bg-gradient-to-l from-cyan-400/25 to-transparent';
      const handleAnchorX = isLeft ? handleInsetPx : clipWidthPx - handleInsetPx;

      return (
        <>
          <div
            className={`pointer-events-none absolute inset-y-0 ${isLeft ? 'left-0' : 'right-0'} ${overlayGradientClass}`}
            style={{ width: overlayWidthPx }}
            aria-hidden
          />
          <svg
            className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
            viewBox={`0 0 ${clipWidthPx} 56`}
            aria-hidden
          >
            <line
              x1={handleAnchorX}
              y1={55}
              x2={handleCenterX}
              y2={5}
              stroke="rgba(165, 243, 252, 0.9)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <div
            role="slider"
            aria-orientation="horizontal"
            aria-label={isLeft ? 'Adjust fade in by dragging the top dot inward' : 'Adjust fade out by dragging the top dot inward'}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, Math.round(segment.durationMs))}
            aria-valuenow={Math.max(0, Math.round(isLeft ? segment.fadeInMs : segment.fadeOutMs))}
            aria-valuetext={`${isLeft ? 'Fade in' : 'Fade out'} ${Math.max(0, Math.round(isLeft ? segment.fadeInMs : segment.fadeOutMs))} ms`}
            className="pointer-events-auto absolute top-0 z-30 flex h-full w-6 -translate-x-1/2 flex-col items-center justify-start cursor-ew-resize select-none touch-none text-cyan-50"
            style={{ left: handleCenterX }}
            onPointerDown={(event) => {
              event.preventDefault();
              stopHandleEvent(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              onFadeHandlePointerDown(edge, event);
            }}
            onPointerMove={(event) => {
              stopHandleEvent(event);
              onFadeHandlePointerMove(edge, event);
            }}
            onPointerUp={(event) => {
              stopHandleEvent(event);
              onFadeHandlePointerUp(edge, event);
            }}
            onPointerCancel={() => {
              onFadeHandlePointerCancel(edge);
            }}
            onClick={(event) => {
              stopHandleEvent(event);
            }}
          >
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full border border-cyan-50/90 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,145,178,0.45)]" />
          </div>
        </>
      );
    }

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
            : timelineTool === 'merge'
              ? isPendingMerge
                ? 'Merge tool: first clip selected. Click a second compatible clip or press Escape to cancel.'
                : isMergeSelectable
                  ? 'Merge tool: click this clip to use it as the first selection'
                  : 'This clip cannot be merged'
              : timelineTool === 'fade'
                ? isFadeSelected
                  ? 'Fade tool: drag the top dot inward to adjust this clip'
                  : isFadeSelectable
                    ? 'Fade tool: click this clip to show its fade dots'
                    : 'This clip cannot be faded'
                : timelineTool === 'crossfade'
                  ? isPendingCrossfade
                    ? 'Crossfade tool: first clip selected. Click a second compatible clip or press Escape to cancel.'
                    : isCrossfadeSelectable
                      ? 'Crossfade tool: click this clip as the first selection'
                      : 'This clip cannot be crossfaded'
                  : 'Select tool: drag this clip to move it'
        }
        className={`absolute top-2 z-10 overflow-visible rounded-md border text-left transition-colors ${
          isPendingMerge
            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
            : isPendingCrossfade
              ? 'border-teal-400 bg-teal-500/20 text-teal-50 shadow-[0_0_0_1px_rgba(45,212,191,0.35)]'
              : isFadeSelected
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]'
            : isSelected
            ? 'border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]'
            : timelineTool === 'merge'
              ? isMergeSelectable
                ? 'border-emerald-500/60 bg-gray-900/70 text-gray-200 hover:border-emerald-400 hover:bg-emerald-500/10'
                : 'border-gray-700 bg-gray-900/70 text-gray-500 opacity-70'
              : timelineTool === 'crossfade'
                ? isCrossfadeSelectable
                  ? 'border-teal-500/60 bg-gray-900/70 text-gray-200 hover:border-teal-400 hover:bg-teal-500/10'
                  : 'border-gray-700 bg-gray-900/70 text-gray-500 opacity-70'
              : timelineTool === 'fade'
                  ? isFadeSelectable
                    ? 'border-cyan-500/60 bg-gray-900/70 text-gray-200 hover:border-cyan-400 hover:bg-cyan-500/10'
                    : 'border-gray-700 bg-gray-900/70 text-gray-500 opacity-70'
                  : 'border-gray-700 bg-gray-900/70 text-gray-300 hover:border-indigo-400 hover:bg-indigo-500/10'
        } ${
          isMuted ? 'opacity-40' : ''
        } ${isPlayheadInside ? 'ring-1 ring-indigo-400/40' : ''} ${
          isDragging
            ? 'cursor-grabbing'
            : timelineTool === 'split'
              ? 'cursor-crosshair'
              : timelineTool === 'merge'
                ? isMergeSelectable
                  ? 'cursor-pointer'
                  : 'cursor-not-allowed'
              : timelineTool === 'crossfade'
                  ? isCrossfadeSelectable
                    ? 'cursor-pointer'
                    : 'cursor-not-allowed'
                  : timelineTool === 'fade'
                    ? isFadeSelectable
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed'
                    : 'cursor-grab'
        }`}
        style={{
          left: leftPx,
          width: clipWidthPx,
          height: 56,
        }}
      >
        <div className="relative h-full w-full overflow-hidden">
          <div
            className="pointer-events-none absolute top-1/2 left-0 h-14 -translate-y-1/2"
            style={{
              width: sourceWidthPx,
              transform: `translateX(-${sourceOffsetPx}px)`,
            }}
          >
            <div ref={containerRef} className="h-full w-full" />
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400/18 to-transparent"
            style={{ width: fadeInOverlayWidthPx }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-cyan-400/18 to-transparent"
            style={{ width: fadeOutOverlayWidthPx }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-teal-400/16 to-transparent"
            style={{ width: crossfadeInOverlayWidthPx }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-teal-400/16 to-transparent"
            style={{ width: crossfadeOutOverlayWidthPx }}
            aria-hidden
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gray-950/10 via-transparent to-gray-950/45" />
          <div className="pointer-events-none absolute left-1 top-1 rounded bg-gray-950/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-100/95 backdrop-blur-[2px]">
            {clipLabel}
          </div>
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-gray-950/55 px-1.5 py-0.5 text-[9px] font-medium text-gray-100/90 backdrop-blur-[2px]">
            {durationLabel}
          </div>
          <div className="pointer-events-none absolute inset-0 border border-white/5" />
        </div>
        {renderFadeHandle('left')}
        {renderFadeHandle('right')}
        {isReady ? null : (
          <div className="pointer-events-none absolute inset-0 z-40 animate-pulse bg-gray-900/20" aria-hidden />
        )}
      </button>
    );
  },
);
