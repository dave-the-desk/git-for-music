'use client';

type CommentInputProps = {
  value: string;
  submitting: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function CommentInput({
  value,
  submitting,
  error,
  onChange,
  onSubmit,
  onCancel,
}: CommentInputProps) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Add Comment</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          Clear
        </button>
      </div>

      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder="Leave a note for this moment..."
        className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
      />

      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}
