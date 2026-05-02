'use client';

import { useEffect, useRef, useState } from 'react';

type RecordingState = 'idle' | 'requesting' | 'recording' | 'error';

type Props = {
  currentTimeMs: number;
  isDisabled: boolean;
  onStreamReady: (stream: MediaStream, startOffsetMs: number) => void;
  onDurationUpdate: (durationMs: number) => void;
  onStopped: (blob: Blob, previewUrl: string, durationMs: number) => void;
};

export function RecordingControls({
  currentTimeMs,
  isDisabled,
  onStreamReady,
  onDurationUpdate,
  onStopped,
}: Props) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const finalDurationMsRef = useRef<number>(0);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function' &&
        typeof MediaRecorder !== 'undefined',
    );
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function startDurationLoop() {
    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setElapsedMs(elapsed);
      onDurationUpdate(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopDurationLoop() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  async function startRecording() {
    setError(null);
    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const capturedStartOffsetMs = currentTimeMs;
      startTimeRef.current = performance.now();
      setElapsedMs(0);
      setRecState('recording');
      onStreamReady(stream, capturedStartOffsetMs);

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
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const previewUrl = URL.createObjectURL(blob);
        onStopped(blob, previewUrl, finalDurationMsRef.current);
        setRecState('idle');
        setElapsedMs(0);
      };

      recorder.start();
      startDurationLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      setRecState('error');
    }
  }

  function stopRecording() {
    finalDurationMsRef.current = performance.now() - startTimeRef.current;
    stopDurationLoop();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  if (isSupported === null) return null;

  if (!isSupported) {
    return (
      <p className="text-sm text-yellow-400">
        Recording is not supported in this browser. Try Chrome, Edge, or Firefox.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {(recState === 'idle' || recState === 'error') && (
        <>
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={isDisabled}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            <span className="h-2 w-2 rounded-full bg-white" />
            Record
          </button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </>
      )}

      {recState === 'requesting' && (
        <p className="text-sm text-gray-400">Requesting microphone access…</p>
      )}

      {recState === 'recording' && (
        <>
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
        </>
      )}
    </div>
  );
}
