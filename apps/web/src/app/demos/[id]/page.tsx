const PLACEHOLDER_TRACKS = [
  { id: 'tv-1', name: 'Drums', durationMs: 187000 },
  { id: 'tv-2', name: 'Bass', durationMs: 187000 },
  { id: 'tv-3', name: 'Vocals', durationMs: 187000 },
];

const PLACEHOLDER_VERSIONS = [
  { id: 'v-3', label: 'v3 — added bridge', createdAt: '1 hour ago', isCurrent: true },
  { id: 'v-2', label: 'v2 — fixed timing', createdAt: '2 days ago', isCurrent: false },
  { id: 'v-1', label: 'v1 — initial', createdAt: '5 days ago', isCurrent: false },
];

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default async function DemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-400">Demo</p>
        <h1 className="text-2xl font-bold capitalize">{id.replace(/-/g, ' ')}</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Tracks */}
        <div className="col-span-2 space-y-3">
          <h2 className="text-lg font-semibold">Tracks</h2>
          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
            {PLACEHOLDER_TRACKS.map((track) => (
              <div key={track.id} className="flex items-center justify-between px-5 py-3">
                <p className="font-medium">{track.name}</p>
                <p className="text-sm text-gray-400">{formatDuration(track.durationMs)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Version history */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Versions</h2>
          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
            {PLACEHOLDER_VERSIONS.map((v) => (
              <div key={v.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{v.label}</p>
                  {v.isCurrent && (
                    <span className="rounded bg-indigo-900 px-1.5 py-0.5 text-xs text-indigo-300">
                      current
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">{v.createdAt}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Comments placeholder */}
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Comments</h2>
        <p className="text-sm text-gray-500">No comments yet.</p>
      </section>
    </div>
  );
}
