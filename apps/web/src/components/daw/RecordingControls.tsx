'use client';

import { useEffect, useRef, useState } from 'react';

// Recording state machine:
//   idle → requesting (getUserMedia in flight)
//        → recording  (stream open, MediaRecorder running)
//        → idle       (onstop fires, blob assembled)
//   idle → error      (getUserMedia denied / unsupported)
type RecordingState = 'idle' | 'requesting' | 'recording' | 'error';

type Props = {
  currentTimeMs: number;
  isDisabled: boolean;
  selectedAudioInputDeviceId: string | null;
  isAudioInputReady: boolean;
  onNeedsAudioInput?: () => void;
  // Called immediately after the stream is open so RecordingTrackLane starts visualizing.
  // startOffsetMs is the global playhead position at the moment Record was clicked.
  onStreamReady: (stream: MediaStream, startOffsetMs: number) => void;
  // Fires each animation frame while recording so the parent can grow the timeline block.
  onDurationUpdate: (durationMs: number) => void;
  // Fires once MediaRecorder.onstop has assembled the final blob.
  onStopped: (blob: Blob, previewUrl: string, durationMs: number) => void;
};

export function RecordingControls({
  currentTimeMs,
  isDisabled,
  selectedAudioInputDeviceId,
  isAudioInputReady,
  onNeedsAudioInput,
  onStreamReady,
  onDurationUpdate,
  onStopped,
}: Props) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // null = not yet checked (SSR / first hydration pass), avoids server/client mismatch
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // performance.now() when recorder.start() was called
  const startTimeRef = useRef<number>(0);
  // Captured before RAF stops so onstop receives the accurate final duration.
  const finalDurationMsRef = useRef<number>(0);

  // Check browser support once on mount so server and client first-render match
  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function' &&
        typeof MediaRecorder !== 'undefined',
    );
  }, []);

  // Clean up RAF loop and mic tracks on unmount
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

    if (!isAudioInputReady || !selectedAudioInputDeviceId) {
      onNeedsAudioInput?.();
      setError('Choose a microphone before recording.');
      setRecState('error');
      return;
    }

    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedAudioInputDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Open the visual track immediately — before MediaRecorder setup — so waveform
      // appears as soon as the stream is available.
      const capturedStartOffsetMs = currentTimeMs;
      startTimeRef.current = performance.now();
      setElapsedMs(0);
      setRecState('recording');
      onStreamReady(stream, capturedStartOffsetMs);

      // MediaRecorder is for final blob assembly only, not visualization.
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // onstop fires asynchronously after the last chunk is flushed.
      // finalDurationMsRef was already written by stopRecording() before this fires.
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
    // Snapshot duration before stopping the loop so onstop gets the right value.
    finalDurationMsRef.current = performance.now() - startTimeRef.current;
    stopDurationLoop();
    mediaRecorderRef.current?.stop();
    // Stop mic tracks immediately so the browser's active-mic indicator goes away.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Render nothing until the client has confirmed support (avoids hydration mismatch)
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
            disabled={isDisabled || !isAudioInputReady || !selectedAudioInputDeviceId}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            <span className="h-2 w-2 rounded-full bg-white" />
            Record
          </button>
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !isAudioInputReady || !selectedAudioInputDeviceId ? (
            <p className="text-sm text-amber-300">
              {selectedAudioInputDeviceId
                ? 'Allow microphone access from the mic button before recording.'
                : 'Choose a microphone from the mic button before recording.'}
            </p>
          ) : null}
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
