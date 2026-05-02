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
    <div className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-4 py-2">
      {leadingSlot && (
        <>
          {leadingSlot}
          <div className="h-5 w-px shrink-0 bg-gray-700" />
        </>
      )}

      <button
        type="button"
        onClick={onStop}
        className="flex h-8 w-8 items-center justify-center rounded bg-gray-700 text-white hover:bg-gray-600"
        title="Stop"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect width="12" height="12" rx="1" />
        </svg>
      </button>

      <button
        type="button"
        onClick={isPlaying ? onPause : onPlay}
        className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600 text-white hover:bg-indigo-500"
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

      <span className="font-mono text-sm tabular-nums text-gray-200">{formatTime(currentTimeMs)}</span>

      {trailingSlot}
    </div>
  );
}
