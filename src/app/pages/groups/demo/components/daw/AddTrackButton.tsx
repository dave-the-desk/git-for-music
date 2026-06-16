'use client';

type AddTrackButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

export function AddTrackButton({ onClick, disabled }: AddTrackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center justify-center rounded-full border border-slate-600 bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-60"
      title="Add a new track"
    >
      + Add track
    </button>
  );
}
