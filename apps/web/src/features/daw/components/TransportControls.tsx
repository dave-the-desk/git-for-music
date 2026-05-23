'use client';

type TransportControlsProps = {
  isPlaying: boolean;
  currentTimeMs: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  leadingSlot?: React.ReactNode;
  trailingSlot?: React.ReactNode;
};

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

export function TransportControls({
  isPlaying,
  currentTimeMs,
  onPlay,
  onPause,
  onStop,
  leadingSlot,
  trailingSlot,
}: TransportControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3">
      {leadingSlot && (
        <>
          {leadingSlot}
          <div className="h-5 w-px shrink-0 bg-slate-700" />
        </>
      )}

      <button
        type="button"
        onClick={onStop}
        className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-800 text-white hover:bg-slate-700"
        title="Stop"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect width="12" height="12" rx="1" />
        </svg>
      </button>

      <button
        type="button"
        onClick={isPlaying ? onPause : onPlay}
        className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="0" y="0" width="4" height="12" rx="1" />
            <rect x="8" y="0" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2 1l9 5-9 5V1z" />
          </svg>
        )}
      </button>

      <span className="font-mono text-sm tabular-nums text-slate-100">{formatTime(currentTimeMs)}</span>

      {trailingSlot}
    </div>
  );
}
