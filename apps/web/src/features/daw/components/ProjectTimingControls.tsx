'use client';

type ProjectTimingControlsProps = {
  tempoBpm: string;
  timeSignatureNum: string;
  timeSignatureDen: string;
  musicalKey: string;
  saving: boolean;
  error: string | null;
  onTempoChange: (value: string) => void;
  onTimeSignatureNumChange: (value: string) => void;
  onTimeSignatureDenChange: (value: string) => void;
  onMusicalKeyChange: (value: string) => void;
  onSave: () => void;
};

export function ProjectTimingControls({
  tempoBpm,
  timeSignatureNum,
  timeSignatureDen,
  musicalKey,
  saving,
  error,
  onTempoChange,
  onTimeSignatureNumChange,
  onTimeSignatureDenChange,
  onMusicalKeyChange,
  onSave,
}: ProjectTimingControlsProps) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Project Timing</p>
          <p className="text-xs text-slate-400">Tempo, meter, and key update the shared timing model only.</p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save timing'}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Tempo</span>
          <input
            type="number"
            min={40}
            max={240}
            step="0.1"
            value={tempoBpm}
            onChange={(e) => onTempoChange(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
            placeholder="120"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Time Sig</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={timeSignatureNum}
              onChange={(e) => onTimeSignatureNumChange(e.currentTarget.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="4"
            />
            <span className="text-slate-500">/</span>
            <input
              type="number"
              min={1}
              value={timeSignatureDen}
              onChange={(e) => onTimeSignatureDenChange(e.currentTarget.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="4"
            />
          </div>
        </label>
        <label className="space-y-1 md:col-span-3">
          <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Key</span>
          <input
            type="text"
            value={musicalKey}
            onChange={(e) => onMusicalKeyChange(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
            placeholder="C major"
          />
        </label>
      </div>

      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
