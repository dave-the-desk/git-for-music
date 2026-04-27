'use client';

import { useEffect, useRef, useState } from 'react';

type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'uploading' | 'error';

type Props = {
  demoId: string;
  onSaved: () => void;
};

export function RecordingControls({ demoId, onSaved }: Props) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [recordingName, setRecordingName] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewUrl, setPreviewUrlState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const blobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Web Audio / live waveform refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  function setPreviewUrl(url: string | null) {
    previewUrlRef.current = url;
    setPreviewUrlState(url);
  }

  const isSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
  }, []);

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  // Uses only refs — safe to define as a regular function; stale closure not an issue.
  function drawWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    const { width, height } = canvas;
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] as number) / 128.0;
      const y = (v / 2) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    animationFrameRef.current = requestAnimationFrame(drawWaveform);
  }

  function setupLiveWaveform(stream: MediaStream) {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    // Connect source → analyser only; not to destination (no monitoring)
    source.connect(analyser);

    animationFrameRef.current = requestAnimationFrame(drawWaveform);
  }

  function cleanupLiveWaveform() {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }

  async function startRecording() {
    setError(null);
    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        blobRef.current = recorded;
        setPreviewUrl(URL.createObjectURL(recorded));
        setRecState('stopped');
      };

      recorder.start();
      startTimeRef.current = performance.now();
      setElapsedMs(0);
      // State update is async but canvas is always mounted, so canvasRef is already set
      setRecState('recording');
      setupLiveWaveform(stream);

      timerRef.current = setInterval(() => {
        setElapsedMs(performance.now() - startTimeRef.current);
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      setRecState('error');
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cleanupLiveWaveform();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function discard() {
    cleanupLiveWaveform();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setPreviewUrl(null);
    blobRef.current = null;
    setElapsedMs(0);
    setError(null);
    setRecordingName('');
    setRecState('idle');
  }

  async function saveRecording() {
    const blob = blobRef.current;
    const url = previewUrlRef.current;
    if (!blob || !url) return;
    setRecState('uploading');
    setError(null);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
      const formData = new FormData();
      formData.append('demoId', demoId);
      if (recordingName.trim()) formData.append('name', recordingName.trim());
      formData.append('file', file);

      const res = await fetch('/api/tracks/upload', { method: 'POST', body: formData });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not save recording');
        setRecState('stopped');
        return;
      }

      URL.revokeObjectURL(url);
      setPreviewUrl(null);
      blobRef.current = null;
      setRecordingName('');
      setElapsedMs(0);
      setRecState('idle');
      onSaved();
    } catch {
      setError('Something went wrong while saving. Please try again.');
      setRecState('stopped');
    }
  }

  if (!isSupported) {
    return (
      <div className="mt-4 rounded-md border border-gray-800 bg-gray-900 p-4">
        <p className="text-sm font-medium text-white">Record Audio Track</p>
        <p className="mt-2 text-sm text-yellow-400">
          Recording is not supported in this browser. Try Chrome, Edge, or Firefox.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
      <p className="text-sm font-medium text-white">Record Audio Track</p>

      {/*
        Canvas is always mounted so canvasRef is populated before setupLiveWaveform runs.
        Shown only while recording via display class — hidden elements take no layout space.
      */}
      <canvas
        ref={canvasRef}
        width={800}
        height={64}
        className={`w-full rounded bg-gray-950 ${recState === 'recording' ? 'block' : 'hidden'}`}
      />

      {(recState === 'idle' || recState === 'error') && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">
              Track Name (optional)
            </span>
            <input
              type="text"
              value={recordingName}
              onChange={(e) => setRecordingName(e.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
              placeholder="Lead Vocal"
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Start Recording
          </button>
        </>
      )}

      {recState === 'requesting' && (
        <p className="text-sm text-gray-400">Requesting microphone access…</p>
      )}

      {recState === 'recording' && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {formatTime(elapsedMs)}
          </span>
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
          >
            Stop Recording
          </button>
        </div>
      )}

      {(recState === 'stopped' || recState === 'uploading') && (
        <>
          {previewUrl ? (
            <audio src={previewUrl} controls className="w-full" />
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">
              Track Name (optional)
            </span>
            <input
              type="text"
              value={recordingName}
              onChange={(e) => setRecordingName(e.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
              placeholder="Lead Vocal"
              disabled={recState === 'uploading'}
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveRecording()}
              disabled={recState === 'uploading'}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {recState === 'uploading' ? 'Saving…' : 'Save Recording'}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={recState === 'uploading'}
              className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-60"
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
