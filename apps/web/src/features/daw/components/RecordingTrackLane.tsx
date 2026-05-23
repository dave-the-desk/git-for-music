'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { PX_PER_SECOND } from '@/features/daw/components/TimelineRuler';
import type { RecordingTakeVisualProjection } from '@/features/daw/rendering/visual-renderer';

const TRACK_HEIGHT = 72;
const MS_PER_PEAK = 10;

type Peak = { timeMs: number; min: number; max: number };

type Props = {
  recording: RecordingTakeVisualProjection;
  stream: MediaStream | null;
  currentTimeMs: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDiscard: () => void;
};

export function RecordingTrackLane({
  recording,
  stream,
  currentTimeMs,
  scrollContainerRef,
  onNameChange,
  onSave,
  onDiscard,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasCssWidthRef = useRef(0);
  const canvasCssHeightRef = useRef(0);
  const canvasDprRef = useRef(1);
  const dataBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const peaksRef = useRef<Peak[]>([]);
  const sampleAccRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });
  const recordingDurationMsRef = useRef(recording.durationMs);
  const currentTimeMsRef = useRef(currentTimeMs);
  const autoFollowArmedRef = useRef(false);
  const autoFollowLeftRef = useRef(0);
  const isRecording = recording.status === 'recording';
  const leftPx = recording.leftPx;
  const waveformWidthPx = recording.waveformWidthPx;
  const hitAreaWidthPx = recording.hitAreaWidthPx;

  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);

  useEffect(() => {
    recordingDurationMsRef.current = recording.durationMs;
  }, [recording.durationMs]);

  useEffect(() => {
    if (isRecording) return;
    peaksRef.current = recording.peaks ?? [];
    redrawAllPeaks();
    // redrawAllPeaks only reads refs, so it is safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recording.peaks]);

  function paintPeak(ctx: CanvasRenderingContext2D, peak: Peak) {
    const height = canvasCssHeightRef.current;
    const halfHeight = height / 2;
    const x = (peak.timeMs / 1000) * PX_PER_SECOND;
    const yTop = Math.max(0, halfHeight - peak.max * halfHeight);
    const yBottom = Math.min(height, halfHeight - peak.min * halfHeight);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
  }

  function redrawAllPeaks() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const peaks = peaksRef.current;
    const width = canvasCssWidthRef.current;
    const height = canvasCssHeightRef.current;
    const halfHeight = height / 2;
    const dpr = canvasDprRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    if (peaks.length === 0) return;

    ctx.fillStyle = '#374151';
    ctx.fillRect(0, halfHeight, width, 1);

    for (const peak of peaks) {
      paintPeak(ctx, peak);
    }
  }

  useEffect(() => {
    const container = waveformContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const dpr = window.devicePixelRatio ?? 1;
      const { width, height } = entry.contentRect;
      canvasCssWidthRef.current = width;
      canvasCssHeightRef.current = height;
      canvasDprRef.current = dpr;
      const newW = Math.max(1, Math.round(width * dpr));
      const newH = Math.max(1, Math.round(height * dpr));
      if (canvas.width === newW && canvas.height === newH) return;
      canvas.width = newW;
      canvas.height = newH;
      redrawAllPeaks();
    });

    ro.observe(container);
    return () => ro.disconnect();
    // redrawAllPeaks only reads refs, so it is safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function captureAndDraw() {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufLen = analyser.fftSize;
    let data = dataBufferRef.current;
    if (!data || data.length !== bufLen) {
      data = new Float32Array(new ArrayBuffer(bufLen * Float32Array.BYTES_PER_ELEMENT));
      dataBufferRef.current = data;
    }
    analyser.getFloatTimeDomainData(data);

    const acc = sampleAccRef.current;
    for (let i = 0; i < bufLen; i++) {
      const sample = data[i] as number;
      if (sample < acc.min) acc.min = sample;
      if (sample > acc.max) acc.max = sample;
    }

    const targetPeaks = Math.floor(recordingDurationMsRef.current / MS_PER_PEAK);
    const previousCount = peaksRef.current.length;

    while (peaksRef.current.length < targetPeaks) {
      const peakTimeMs = peaksRef.current.length * MS_PER_PEAK;
      peaksRef.current.push({
        timeMs: peakTimeMs,
        min: acc.min,
        max: acc.max,
      });
    }

    if (peaksRef.current.length > previousCount) {
      sampleAccRef.current = { min: 0, max: 0 };
    }

    redrawAllPeaks();
    animFrameRef.current = requestAnimationFrame(captureAndDraw);
  }

  useEffect(() => {
    if (!stream) return;

    peaksRef.current = [];
    sampleAccRef.current = { min: 0, max: 0 };
    recordingDurationMsRef.current = recording.durationMs;
    dataBufferRef.current = null;

    redrawAllPeaks();

    async function initAudio() {
      if (!stream) return;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;
      captureAndDraw();
    }

    void initAudio();

    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
    };
    // captureAndDraw and redrawAllPeaks only access refs — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  useEffect(() => {
    if (!isRecording) return;
    if (!stream) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const rightEdgePaddingPx = 240;
    const triggerThresholdPx = 240;
    let rafId = 0;
    autoFollowArmedRef.current = false;
    autoFollowLeftRef.current = scrollContainer.scrollLeft;

    const followPlayhead = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      if (!isRecording || !stream) return;

      const playheadX = (currentTimeMsRef.current / 1000) * PX_PER_SECOND;
      const rightVisiblePx = container.scrollLeft + container.clientWidth;

      if (!autoFollowArmedRef.current && playheadX >= rightVisiblePx - triggerThresholdPx) {
        autoFollowArmedRef.current = true;
      }

      if (autoFollowArmedRef.current) {
        const targetLeft = Math.max(
          autoFollowLeftRef.current,
          playheadX - container.clientWidth + rightEdgePaddingPx,
        );
        autoFollowLeftRef.current = targetLeft;
        if (Math.abs(container.scrollLeft - targetLeft) > 1) {
          container.scrollTo({ left: targetLeft, behavior: 'auto' });
        }
      }

      rafId = requestAnimationFrame(followPlayhead);
    };

    rafId = requestAnimationFrame(followPlayhead);

    return () => {
      cancelAnimationFrame(rafId);
      autoFollowArmedRef.current = false;
      autoFollowLeftRef.current = 0;
    };
  }, [isRecording, scrollContainerRef, stream]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div
        className="absolute top-0 pointer-events-auto"
        style={{
          left: leftPx,
          width: hitAreaWidthPx,
          minWidth: isRecording ? 120 : 8,
        }}
      >
        <div
          className="relative overflow-hidden rounded border border-red-500/50 bg-gray-950"
          style={{ width: waveformWidthPx, minWidth: isRecording ? 120 : 8, height: TRACK_HEIGHT }}
        >
          <div className="absolute left-1 top-1 z-20 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-md border border-red-500/50 bg-gray-950/90 px-1.5 py-0.5 shadow-lg shadow-black/30 backdrop-blur-sm">
            <input
              value={recording.name}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              placeholder={recording.targetTrackName}
              className="w-24 rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-[10px] text-white outline-none"
            />
            <button type="button" onClick={onSave} className="text-[10px] text-indigo-400 hover:text-indigo-300">
              {recording.syncStatus === 'complete' ? 'Saved' : recording.syncStatus === 'uploading' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onDiscard} className="text-[10px] text-gray-500 hover:text-gray-300">
              Discard
            </button>
            <span className="rounded bg-red-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-200">
              {recording.status === 'recording'
                ? 'Rec'
                : recording.syncStatus === 'error'
                  ? 'Err'
                  : recording.syncStatus === 'complete'
                    ? 'Saved'
                    : 'Preview'}
            </span>
          </div>

          <div ref={waveformContainerRef} className="h-full" style={{ width: waveformWidthPx }}>
            <canvas ref={canvasRef} className="h-full w-full" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-gray-950/10 via-transparent to-gray-950/45" />
          <div className="absolute inset-0 border border-white/5" />
          {!recording.previewUrl && recording.status === 'recording' ? (
            <div className="absolute inset-0 animate-pulse bg-gray-900/20" aria-hidden />
          ) : null}
        </div>

        {recording.error ? <p className="mt-1 text-[11px] text-red-400">{recording.error}</p> : null}
      </div>
    </div>
  );
}
