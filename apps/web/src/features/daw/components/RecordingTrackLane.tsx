'use client';

import { useCallback, useEffect, useRef } from 'react';
import { PX_PER_SECOND } from '@/features/daw/components/TimelineRuler';
import type { TemporaryRecordingTrack } from '@/features/daw/state/daw-state';

const TRACK_LABEL_WIDTH = 160;
const TRACK_HEIGHT = 72;
const MIN_RECORDING_WIDTH_PX = 120;
const MS_PER_PEAK = 10;
const CANVAS_PX_PER_PEAK = 1;

type Peak = { min: number; max: number };

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const peaksRef = useRef<Peak[]>([]);
  const sampleAccRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });
  const recordingStartTimeRef = useRef<number>(0);
  const gainRef = useRef(1);
  const isRecording = track.status === 'recording';
  const leftPx = (track.startOffsetMs / 1000) * PX_PER_SECOND;
  const widthPx = isRecording
    ? Math.max((track.durationMs / 1000) * PX_PER_SECOND, MIN_RECORDING_WIDTH_PX)
    : Math.max((track.durationMs / 1000) * PX_PER_SECOND, 8);

  function drawLatestPeak() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const peaks = peaksRef.current;
    const peak = peaks[peaks.length - 1];
    if (!peak) return;

    const { width: W, height: H } = canvas;
    const halfH = H / 2;
    const gain = gainRef.current;
    const maxPeaks = Math.floor(W / CANVAS_PX_PER_PEAK);

    let drawX: number;

    if (peaks.length > maxPeaks) {
      const img = ctx.getImageData(CANVAS_PX_PER_PEAK, 0, W - CANVAS_PX_PER_PEAK, H);
      ctx.putImageData(img, 0, 0);
      drawX = W - CANVAS_PX_PER_PEAK;
    } else {
      drawX = (peaks.length - 1) * CANVAS_PX_PER_PEAK;
    }

    ctx.fillStyle = '#030712';
    ctx.fillRect(drawX, 0, CANVAS_PX_PER_PEAK, H);

    ctx.fillStyle = '#374151';
    ctx.fillRect(drawX, halfH, CANVAS_PX_PER_PEAK, 1);

    const yTop = Math.max(0, halfH - peak.max * gain * halfH);
    const yBot = Math.min(H, halfH - peak.min * gain * halfH);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(drawX, yTop, CANVAS_PX_PER_PEAK, Math.max(1, yBot - yTop));
  }

  function redrawAllPeaks() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const peaks = peaksRef.current;
    const { width: W, height: H } = canvas;
    const halfH = H / 2;
    const gain = gainRef.current;
    const maxPeaks = Math.floor(W / CANVAS_PX_PER_PEAK);

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    if (peaks.length === 0) return;

    const startIdx = Math.max(0, peaks.length - maxPeaks);
    const visiblePeaks = peaks.slice(startIdx);

    ctx.fillStyle = '#374151';
    ctx.fillRect(0, halfH, W, 1);

    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < visiblePeaks.length; i++) {
      const p = visiblePeaks[i]!;
      const x = i * CANVAS_PX_PER_PEAK;
      const yTop = Math.max(0, halfH - p.max * gain * halfH);
      const yBot = Math.min(H, halfH - p.min * gain * halfH);
      ctx.fillRect(x, yTop, CANVAS_PX_PER_PEAK, Math.max(1, yBot - yTop));
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const dpr = window.devicePixelRatio ?? 1;
      const { width, height } = entry.contentRect;
      const newW = Math.max(1, Math.round(width * dpr));
      const newH = Math.max(1, Math.round(height * dpr));
      if (canvas.width === newW && canvas.height === newH) return;
      canvas.width = newW;
      canvas.height = newH;
      redrawAllPeaks();
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const captureAndDraw = useCallback(() => {
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
      peaksRef.current.push({ min: acc.min, max: acc.max });
      drawLatestPeak();
    }

    if (peaksRef.current.length > prevCount) {
      sampleAccRef.current = { min: 0, max: 0 };
    }

    animFrameRef.current = requestAnimationFrame(captureAndDraw);
  }, []);

  useEffect(() => {
    if (!stream) return;

    peaksRef.current = [];
    sampleAccRef.current = { min: 0, max: 0 };
    recordingStartTimeRef.current = performance.now();

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#030712';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

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
    };
  }, [stream, captureAndDraw]);

  return (
    <div
      className="flex border-b border-gray-800"
      style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth, height: TRACK_HEIGHT }}
    >
      <div
        className="flex shrink-0 flex-col gap-2 border-r border-gray-800 bg-gray-900 px-2 py-2"
        style={{ width: TRACK_LABEL_WIDTH }}
      >
        <input
          value={track.name}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          placeholder="Recording"
          className="w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-xs text-white outline-none"
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSave} className="text-[10px] text-indigo-400 hover:text-indigo-300">
            Save
          </button>
          <button type="button" onClick={onDiscard} className="text-[10px] text-gray-500 hover:text-gray-300">
            Discard
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative shrink-0 select-none bg-gray-950"
        style={{ width: totalTimelineWidth, minHeight: TRACK_HEIGHT }}
      >
        <div
          className="pointer-events-none absolute top-0 z-20 h-full w-px bg-yellow-400/80"
          style={{ left: (currentTimeMs / 1000) * PX_PER_SECOND }}
        />
        <div
          className="absolute top-0 h-full overflow-hidden rounded border border-red-500/50 bg-gray-950"
          style={{ left: leftPx, width: widthPx }}
        >
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
