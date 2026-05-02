'use client';

import { useEffect, useRef, useState } from 'react';
import { PX_PER_SECOND } from './TimelineRuler';
import type { TemporaryRecordingTrack } from './DemoDawClient';

const TRACK_LABEL_WIDTH = 160;
const TRACK_HEIGHT = 72;

// Minimum clip width during active recording so waveform movement is visible immediately.
const MIN_RECORDING_WIDTH_PX = 120;

// ~10 ms window per peak for smooth real-time feedback (was 50 ms).
const MS_PER_PEAK = 10;

type Peak = { timeMs: number; min: number; max: number };

type Props = {
  track: TemporaryRecordingTrack;
  stream: MediaStream | null;
  currentTimeMs: number;
  totalTimelineWidth: number;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDiscard: () => void;
};

export function RecordingTrackLane({
  track,
  stream,
  currentTimeMs,
  totalTimelineWidth,
  onNameChange,
  onSave,
  onDiscard,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Watched by ResizeObserver to size the canvas backing store to actual rendered pixels.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasCssWidthRef = useRef(0);
  const canvasCssHeightRef = useRef(0);
  const canvasDprRef = useRef(1);

  // All committed peaks — one entry per MS_PER_PEAK ms of audio.
  // Kept in a ref to avoid triggering React re-renders at 60 fps.
  const peaksRef = useRef<Peak[]>([]);

  // Running min/max accumulator folded into a committed peak once MS_PER_PEAK has elapsed.
  const sampleAccRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });

  // Wall-clock time when the current recording started.
  const recordingStartTimeRef = useRef<number>(0);

  // Mirror of waveformDisplayGain in a ref so the RAF closure always reads the latest value.
  const gainRef = useRef(1);

  const [waveformDisplayGain, setWaveformDisplayGain] = useState(1);

  const isRecording = track.status === 'recording';
  const leftPx = (track.startOffsetMs / 1000) * PX_PER_SECOND;
  // The recording preview uses the same PX_PER_SECOND timeline scale as saved tracks,
  // so the live and final waveforms stay visually aligned.
  const widthPx = isRecording
    ? Math.max((track.durationMs / 1000) * PX_PER_SECOND, MIN_RECORDING_WIDTH_PX)
    : Math.max((track.durationMs / 1000) * PX_PER_SECOND, 8);

  // ── Drawing ────────────────────────────────────────────────────────────────

  function paintPeak(ctx: CanvasRenderingContext2D, peak: Peak) {
    const H = canvasCssHeightRef.current;
    const halfH = H / 2;
    const gain = gainRef.current;
    const x = (peak.timeMs / 1000) * PX_PER_SECOND;
    const yTop = Math.max(0, halfH - peak.max * gain * halfH);
    const yBot = Math.min(H, halfH - peak.min * gain * halfH);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }

  // The live waveform uses timeline CSS pixels, while devicePixelRatio is only
  // for sharp rendering. Saved and live waveforms must share PX_PER_SECOND so
  // the preview does not visually jump after stopping.
  function redrawAllPeaks() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const peaks = peaksRef.current;
    const W = canvasCssWidthRef.current;
    const H = canvasCssHeightRef.current;
    const halfH = H / 2;
    const dpr = canvasDprRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    if (peaks.length === 0) return;

    ctx.fillStyle = '#374151';
    ctx.fillRect(0, halfH, W, 1);

    for (const peak of peaks) {
      paintPeak(ctx, peak);
    }
  }

  // ── ResizeObserver — sizes canvas backing store to actual rendered dimensions ──

  useEffect(() => {
    const container = containerRef.current;
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

  // ── RAF capture loop ───────────────────────────────────────────────────────

  // Each frame folds the AnalyserNode PCM buffer into a running min/max accumulator.
  // A new waveform column is committed and painted once per MS_PER_PEAK ms.
  function captureAndDraw() {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufLen = analyser.frequencyBinCount;
    const data = new Float32Array(bufLen);
    analyser.getFloatTimeDomainData(data);

    const acc = sampleAccRef.current;
    for (let i = 0; i < bufLen; i++) {
      const s = data[i] as number;
      if (s < acc.min) acc.min = s;
      if (s > acc.max) acc.max = s;
    }

    const elapsed = performance.now() - recordingStartTimeRef.current;
    const targetPeaks = Math.floor(elapsed / MS_PER_PEAK);
    const prevCount = peaksRef.current.length;

    while (peaksRef.current.length < targetPeaks) {
      const peakTimeMs = peaksRef.current.length * MS_PER_PEAK;
      peaksRef.current.push({
        timeMs: peakTimeMs,
        min: acc.min,
        max: acc.max,
      });
    }

    if (peaksRef.current.length > prevCount) {
      sampleAccRef.current = { min: 0, max: 0 };
    }

    redrawAllPeaks();
    animFrameRef.current = requestAnimationFrame(captureAndDraw);
  }

  // ── Stream effect ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!stream) return;

    peaksRef.current = [];
    sampleAccRef.current = { min: 0, max: 0 };
    recordingStartTimeRef.current = performance.now();

    redrawAllPeaks();

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // fftSize 2048 → 1024 samples per read (~23 ms at 44.1 kHz).
    // Not connected to destination so mic is never heard through speakers.
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    source.connect(analyser);
    animFrameRef.current = requestAnimationFrame(captureAndDraw);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      source.disconnect();
      analyser.disconnect();
      void audioCtx.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      // peaksRef intentionally preserved — canvas keeps final waveform through recording→preview.
    };
    // captureAndDraw and redrawAllPeaks only access refs — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ── Gain effect ────────────────────────────────────────────────────────────

  useEffect(() => {
    gainRef.current = waveformDisplayGain;
    if (track.status !== 'recording') {
      redrawAllPeaks();
    }
    // track.status intentionally omitted — we only react to gain changes here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformDisplayGain]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showPreviewPanel =
    track.status === 'preview' || track.status === 'uploading' || track.status === 'error';

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      {/* Track row */}
      <div className="flex" style={{ height: TRACK_HEIGHT }}>
        {/* Label */}
        <div
          className="flex shrink-0 flex-col justify-center gap-0.5 border-r border-gray-800 bg-gray-900 px-3"
          style={{ width: TRACK_LABEL_WIDTH }}
        >
          <div className="flex items-center gap-1.5">
            {isRecording && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
            <span
              className={`text-xs font-bold uppercase tracking-wide ${isRecording ? 'text-red-400' : 'text-gray-400'}`}
            >
              {isRecording ? 'REC' : 'Preview'}
            </span>
          </div>
          <p className="truncate text-xs text-gray-300">{track.name || 'New Recording'}</p>

          {/* Visual-only gain — scales waveform display without touching audio */}
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-[10px] text-gray-500">gain</span>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={waveformDisplayGain}
              onChange={(e) => setWaveformDisplayGain(Number(e.currentTarget.value))}
              className="h-1 w-14 cursor-pointer accent-red-500"
              title={`Waveform display gain: ${waveformDisplayGain}×`}
            />
            <span className="text-[10px] tabular-nums text-gray-500">{waveformDisplayGain}×</span>
          </div>
        </div>

        {/* Timeline area */}
        <div
          className="relative shrink-0 bg-gray-950"
          style={{ width: totalTimelineWidth, height: TRACK_HEIGHT }}
        >
          {/* Global playhead */}
          <div
            className="pointer-events-none absolute top-0 z-20 h-full w-px bg-yellow-400/80"
            style={{ left: (currentTimeMs / 1000) * PX_PER_SECOND }}
          />

          {/* Waveform block — CSS width grows with durationMs on the same timeline scale as saved tracks. */}
          <div
            ref={containerRef}
            className={`absolute top-2 bottom-2 overflow-hidden rounded border ${
              isRecording ? 'border-red-700 bg-gray-900' : 'border-indigo-800 bg-gray-900'
            }`}
            style={{ left: leftPx, width: widthPx }}
          >
            {/*
              Canvas has no fixed width/height attributes — the ResizeObserver sets the
              backing store to contentRect × devicePixelRatio on every layout change.
              Always mounted so the accumulated waveform survives the recording→preview transition.
            */}
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              style={{ display: track.status === 'uploading' ? 'none' : 'block' }}
            />
            {track.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-gray-400">Saving…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview / save panel — shown after the user stops recording */}
      {showPreviewPanel && (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 bg-gray-900/50 px-4 py-3">
          {track.previewUrl ? (
            <audio src={track.previewUrl} controls className="h-8 flex-shrink-0" />
          ) : null}
          <input
            type="text"
            value={track.name}
            onChange={(e) => onNameChange(e.currentTarget.value)}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs outline-none ring-indigo-500 focus:ring"
            placeholder="Track name (optional)"
            disabled={track.status === 'uploading'}
          />
          {track.error ? <p className="text-xs text-red-400">{track.error}</p> : null}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={track.status === 'uploading'}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {track.status === 'uploading' ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={track.status === 'uploading'}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-60"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
