'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type ProjectDemoListItem = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
};

type ProjectPageClientProps = {
  groupSlug: string;
  projectSlug: string;
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  demos: ProjectDemoListItem[];
};

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ProjectPageClient({
  groupSlug,
  projectSlug,
  projectId,
  projectName,
  projectDescription,
  demos,
}: ProjectPageClientProps) {
  const router = useRouter();
  const [isCreateDemoModalOpen, setIsCreateDemoModalOpen] = useState(false);
  const [demoName, setDemoName] = useState('');
  const [demoDescription, setDemoDescription] = useState('');
  const [createDemoError, setCreateDemoError] = useState<string | null>(null);
  const [isSubmittingDemo, setIsSubmittingDemo] = useState(false);

  function closeCreateDemoModal() {
    setIsCreateDemoModalOpen(false);
    setDemoName('');
    setDemoDescription('');
    setCreateDemoError(null);
  }

  async function createDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateDemoError(null);
    setIsSubmittingDemo(true);

    try {
      const response = await fetch('/api/demos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          name: demoName,
          description: demoDescription,
        }),
      });

      const data = (await response.json()) as {
        id?: string;
        error?: string;
      };

      if (!response.ok || !data.id) {
        setCreateDemoError(data.error ?? 'Could not create demo');
        return;
      }

      closeCreateDemoModal();
      router.push(`/groups/${groupSlug}/projects/${projectSlug}/demos/${data.id}`);
      router.refresh();
    } catch {
      setCreateDemoError('Something went wrong. Please try again.');
    } finally {
      setIsSubmittingDemo(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/groups/${groupSlug}`}
        className="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
      >
        Back
      </Link>

      <section>
        <h1 className="text-2xl font-bold text-white">{projectName}</h1>
        {projectDescription ? (
          <p className="mt-2 text-sm text-gray-300">{projectDescription}</p>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No description yet.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Demos</h2>
          <button
            type="button"
            onClick={() => setIsCreateDemoModalOpen(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Create Demo
          </button>
        </div>

        {demos.length > 0 ? (
          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
            {demos.map((demo) => (
              <Link
                key={demo.id}
                href={`/groups/${groupSlug}/projects/${projectSlug}/demos/${demo.id}`}
                className="block px-6 py-4 transition-colors hover:bg-gray-800/60 focus:bg-gray-800/60 focus:outline-none"
              >
                <p className="font-medium text-white">{demo.name}</p>
                {demo.description ? (
                  <p className="mt-1 text-sm text-gray-300">{demo.description}</p>
                ) : null}
                <p className="mt-1 text-xs text-gray-500">Updated {formatUpdatedAt(demo.updatedAt)}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-8 text-sm text-gray-400">
            No demos yet. Create one to get started.
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
        <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900 px-6 py-8 text-sm text-gray-400">
          Activity feed placeholder.
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Equipment Requirements</h2>
        <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900 px-6 py-8 text-sm text-gray-400">
          Equipment requirements placeholder.
        </div>
      </section>

      {isCreateDemoModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="Close create demo modal"
            onClick={closeCreateDemoModal}
            className="absolute inset-0 bg-black/60"
          />

          <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Create demo</h2>
            <p className="mt-1 text-sm text-gray-400">
              Enter a demo name and, if you want, an optional description.
            </p>

            <form className="mt-5 space-y-4" onSubmit={createDemo}>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Demo name</span>
                <input
                  type="text"
                  required
                  value={demoName}
                  onChange={(event) => setDemoName(event.currentTarget.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                  placeholder="Rough Mix v1"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Description (optional)</span>
                <textarea
                  value={demoDescription}
                  onChange={(event) => setDemoDescription(event.currentTarget.value)}
                  className="min-h-24 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                  placeholder="Current arrangement with guide vocal and scratch bass."
                />
              </label>

              {createDemoError ? <p className="text-sm text-red-400">{createDemoError}</p> : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCreateDemoModal}
                  className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDemo}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isSubmittingDemo ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
