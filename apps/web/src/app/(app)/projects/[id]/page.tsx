const PLACEHOLDER_DEMOS = [
  { id: 'demo-1', name: 'Rough Mix v1', updatedAt: '2 days ago' },
  { id: 'demo-2', name: 'Bridge idea', updatedAt: '5 days ago' },
];

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-400">Project</p>
        <h1 className="text-2xl font-bold capitalize">{id.replace(/-/g, ' ')}</h1>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Demos</h2>
          <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500">
            New Demo
          </button>
        </div>

        <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
          {PLACEHOLDER_DEMOS.map((demo) => (
            <div key={demo.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium">{demo.name}</p>
                <p className="text-sm text-gray-400">Updated {demo.updatedAt}</p>
              </div>
              <a
                href={`/demos/${demo.id}`}
                className="text-sm text-indigo-400 hover:text-indigo-300"
              >
                Open →
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
