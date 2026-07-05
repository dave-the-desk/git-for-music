'use client';

import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from 'react';

type RecordingState = 'idle' | 'requesting' | 'recording' | 'error';

type Props = {
  currentTimeMs: number;
  recordedTempoBpm: number;
  isDisabled: boolean;
  recordingTarget: {
    trackId: string;
    trackVersionId: string;
    trackName: string;
  } | null;
  selectedAudioInputDeviceId: string | null;
  isAudioInputReady: boolean;
  microphoneSelector?: ReactNode;
  onNeedsAudioInput?: () => void;
  onStreamReady: (
    stream: MediaStream,
    startOffsetMs: number,
    target: {
      trackId: string;
      trackVersionId: string;
      trackName: string;
    },
    recordedTempoBpm: number,
  ) => void;
  onDurationUpdate: (durationMs: number) => void;
  onStopped: (blob: Blob, durationMs: number) => void;
};

export type RecordingControlsHandle = {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
};

export const RecordingControls = forwardRef<RecordingControlsHandle, Props>(function RecordingControls(
  {
    currentTimeMs,
    recordedTempoBpm,
    isDisabled,
    recordingTarget,
    selectedAudioInputDeviceId,
    isAudioInputReady,
    microphoneSelector,
    onNeedsAudioInput,
    onStreamReady,
    onDurationUpdate,
    onStopped,
  },
  ref,
) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const wallClockDurationMsRef = useRef<number>(0);

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

    if (!recordingTarget) {
      setError('Arm a track before recording.');
      setRecState('error');
      return;
    }

    if (!isAudioInputReady || !selectedAudioInputDeviceId) {
      onNeedsAudioInput?.();
      setError('Choose a microphone before recording.');
      setRecState('error');
      return;
    }

    setRecState('requesting');
    try {
      const capturedStartOffsetMs = currentTimeMs;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedAudioInputDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      startTimeRef.current = performance.now();
      setElapsedMs(0);
      setRecState('recording');
      onStreamReady(stream, capturedStartOffsetMs, recordingTarget, recordedTempoBpm);

      const mimeType = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        onStopped(blob, wallClockDurationMsRef.current);
        setRecState('idle');
        setElapsedMs(0);
      };

      recorder.start();
      startDurationLoop();
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
        setError('Selected microphone is unavailable. Choose another input.');
      } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone permission was denied. Allow access from the mic button.');
      } else {
        setError(err instanceof Error ? err.message : 'Microphone access denied');
      }
      setRecState('error');
    }
  }

  function stopRecording() {
    wallClockDurationMsRef.current = performance.now() - startTimeRef.current;
    stopDurationLoop();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useImperativeHandle(ref, () => ({
    startRecording,
    stopRecording,
  }));

  if (isSupported === null) return null;

  if (!isSupported) {
    return (
      <p className="text-sm text-yellow-400">
        Recording is not supported in this browser. Try Chrome, Edge, or Firefox.
      </p>
    );
  }

  return (
    <div className="grid gap-2 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
      {microphoneSelector ? (
        <div className="inline-flex w-fit items-center rounded-lg border border-slate-700 bg-slate-950/60 p-2">
          {microphoneSelector}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2">
        {(recState === 'idle' || recState === 'error') && (
          <>
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={isDisabled || !isAudioInputReady || !selectedAudioInputDeviceId}
              className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              Record
            </button>
            {error ? (
              <p className="min-w-0 text-sm leading-tight text-red-400">{error}</p>
            ) : !recordingTarget ? (
              <p className="min-w-0 text-sm leading-tight text-amber-300">Arm a track before recording.</p>
            ) : !isAudioInputReady || !selectedAudioInputDeviceId ? (
              <p className="min-w-0 text-sm leading-tight text-amber-300">
                {selectedAudioInputDeviceId
                  ? 'Allow microphone access from the mic button before recording.'
                  : 'Choose a microphone from the mic button before recording.'}
              </p>
            ) : null}
          </>
        )}

        {recState === 'requesting' && (
          <p className="min-w-0 text-sm leading-tight text-gray-400">Requesting microphone access…</p>
        )}

        {recState === 'recording' && (
          <>
            <span className="flex items-center gap-2 rounded-md bg-red-500/10 px-2 py-1 text-sm font-medium text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {formatTime(elapsedMs)}
            </span>
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600"
            >
              Stop Recording
            </button>
          </>
        )}
      </div>
    </div>
  );
});
