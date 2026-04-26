export default function DashboardPage() {
  const stats = [
    { label: 'Groups', value: '—' },
    { label: 'Projects', value: '—' },
    { label: 'Demos', value: '—' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">Welcome back.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">{s.label}</p>
            <p className="mt-1 text-3xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
          Recent Projects
        </h2>
        <p className="text-sm text-gray-500">No projects yet. Create a group to get started.</p>
        <a
          href="/groups"
          className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          Go to Groups
        </a>
      </div>
    </div>
  );
}
