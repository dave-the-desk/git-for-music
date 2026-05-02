'use client';

import type { DemoTimingMetadata } from '@git-for-music/shared';
import { formatBarBeatLabel, getBeatTimes, isValidTempoBpm } from '@/features/daw/utils/timing';

const PX_PER_SECOND = 80;

type TimelineRulerProps = {
  totalDurationMs: number;
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
  timing: DemoTimingMetadata | null;
};

export function TimelineRuler({ totalDurationMs, currentTimeMs, onSeek, timing }: TimelineRulerProps) {
  const totalSeconds = Math.max(totalDurationMs / 1000, 10);
  const totalWidth = totalSeconds * PX_PER_SECOND;
  const useMusicalGrid = !!timing && isValidTempoBpm(timing.tempoBpm);
  const secondsPerBeat = useMusicalGrid && timing ? 60 / (timing.tempoBpm ?? 120) : null;
  const tickIntervalSeconds = totalSeconds > 60 ? 5 : 1;
  const ticks = useMusicalGrid
    ? getBeatTimes(totalSeconds, timing)
    : Array.from({ length: Math.floor(totalSeconds / tickIntervalSeconds) + 1 }, (_, index) => index * tickIntervalSeconds);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const seekMs = (x / PX_PER_SECOND) * 1000;
    onSeek(Math.max(0, seekMs));
  }

  const playheadLeft = (currentTimeMs / 1000) * PX_PER_SECOND;

  return (
    <div className="relative select-none" style={{ width: totalWidth, height: 28 }} onClick={handleClick}>
      <div className="absolute inset-0 bg-gray-900" />

      {ticks.map((s) => {
        const left = s * PX_PER_SECOND;
        const isMajor = useMusicalGrid && timing && secondsPerBeat
          ? Math.floor(s / secondsPerBeat) % timing.timeSignature.num === 0
          : s % 5 === 0;
        const label = useMusicalGrid ? formatBarBeatLabel(s, timing) : formatSeconds(s);
        return (
          <div key={s} className="absolute bottom-0 flex flex-col items-center" style={{ left }}>
            <span className="mb-0.5 text-[10px] leading-none text-gray-400">
              {useMusicalGrid || isMajor ? label : ''}
            </span>
            <div
              className="w-px"
              style={{
                height: isMajor ? 8 : 4,
                backgroundColor: isMajor ? '#6b7280' : '#374151',
              }}
            />
          </div>
        );
      })}

      <div
        className="absolute top-0 z-10 h-full w-px bg-yellow-400"
        style={{ left: playheadLeft }}
      />
    </div>
  );
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export { PX_PER_SECOND };
