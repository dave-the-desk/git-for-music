'use client';

type ProjectTimingControlsProps = {
  sharedDemoTempoBpm: number;
  localTempoBpm: string;
  onLocalTempoChange: (value: string) => void;
};

export function ProjectTimingControls({
  sharedDemoTempoBpm,
  localTempoBpm,
  onLocalTempoChange,
}: ProjectTimingControlsProps) {
  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)]">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Project Timing</p>
        </div>

        <div className="grid gap-2 lg:grid-cols-2 lg:items-end">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Shared demo tempo</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{sharedDemoTempoBpm} bpm</p>
          </div>

          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-[0.22em] text-slate-400">Local tempo</span>
            <input
              type="number"
              min={20}
              max={300}
              step="0.1"
              value={localTempoBpm}
              onChange={(e) => onLocalTempoChange(e.currentTarget.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="100"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
