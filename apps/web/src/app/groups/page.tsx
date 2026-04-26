const PLACEHOLDER_GROUPS = [
  { id: '1', name: 'The Velvet Static', slug: 'velvet-static', memberCount: 3 },
  { id: '2', name: 'Solo Workspace', slug: 'solo', memberCount: 1 },
];

export default function GroupsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Groups</h1>
        <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
          New Group
        </button>
      </div>

      <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
        {PLACEHOLDER_GROUPS.map((group) => (
          <div key={group.id} className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="font-medium">{group.name}</p>
              <p className="text-sm text-gray-400">{group.memberCount} member{group.memberCount !== 1 ? 's' : ''}</p>
            </div>
            <a
              href={`/groups/${group.slug}`}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              View →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
