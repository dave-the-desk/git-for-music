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
    <section className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2.5">
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-white">Project Timing</p>
        </div>

        <div className="grid gap-2 lg:grid-cols-2 lg:items-end">
          <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-1.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Shared demo tempo</p>
            <p className="mt-1 text-sm font-semibold text-white">{sharedDemoTempoBpm} bpm</p>
          </div>

          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Local tempo</span>
            <input
              type="number"
              min={20}
              max={300}
              step="0.1"
              value={localTempoBpm}
              onChange={(e) => onLocalTempoChange(e.currentTarget.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="100"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
