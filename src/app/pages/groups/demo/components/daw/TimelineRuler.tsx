'use client';

import type { DemoTimingMetadata } from '@git-for-music/shared';
import { PX_PER_SECOND } from '@/app/lib/daw/rendering/visual-renderer';
import { formatBarBeatLabel, getBeatTimes, isValidTempoBpm } from '@/app/lib/daw/utils/timing';

type TimelineRulerProps = {
  totalDurationMs: number;
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
  timing: DemoTimingMetadata | null;
};

export type TimelineTick = {
  leftPx: number;
  label: string;
  isMajor: boolean;
};

export function getTimelineWidthPx(totalDurationMs: number) {
  return Math.max(totalDurationMs / 1000, 10) * PX_PER_SECOND;
}

export function getTimelineTicks(totalDurationMs: number, timing: DemoTimingMetadata | null) {
  const totalSeconds = Math.max(totalDurationMs / 1000, 10);
  const useMusicalGrid = !!timing && isValidTempoBpm(timing.tempoBpm);
  const secondsPerBeat = useMusicalGrid && timing ? 60 / (timing.tempoBpm ?? 120) : null;
  const tickIntervalSeconds = totalSeconds > 60 ? 5 : 1;
  const tickTimes = useMusicalGrid
    ? getBeatTimes(totalSeconds, timing)
    : Array.from({ length: Math.floor(totalSeconds / tickIntervalSeconds) + 1 }, (_, index) => index * tickIntervalSeconds);

  return tickTimes.map<TimelineTick>((s) => {
    const isMajor = useMusicalGrid && timing && secondsPerBeat
      ? Math.floor(s / secondsPerBeat) % timing.timeSignature.num === 0
      : s % 5 === 0;

    return {
      leftPx: Math.round(s * PX_PER_SECOND),
      label: useMusicalGrid ? formatBarBeatLabel(s, timing) ?? '' : formatSeconds(s),
      isMajor,
    };
  });
}

export function TimelineRuler({ totalDurationMs, currentTimeMs, onSeek, timing }: TimelineRulerProps) {
  const totalWidth = getTimelineWidthPx(totalDurationMs);
  const ticks = getTimelineTicks(totalDurationMs, timing);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const seekMs = (x / PX_PER_SECOND) * 1000;
    onSeek(Math.max(0, seekMs));
  }

  const playheadLeft = Math.round((currentTimeMs / 1000) * PX_PER_SECOND);

  return (
    <div className="relative select-none" style={{ width: totalWidth, height: 28 }} onClick={handleClick}>
      <div className="absolute inset-0 bg-gray-900" />

      {ticks.map((tick) => (
        <div
          key={tick.leftPx}
          className="absolute bottom-0 flex flex-col items-center"
          style={{ left: tick.leftPx }}
        >
          <div
            className="w-px"
            style={{
              height: 12,
              backgroundColor: '#475569',
            }}
          />
        </div>
      ))}

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
