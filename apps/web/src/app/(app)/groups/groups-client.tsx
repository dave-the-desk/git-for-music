'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type GroupListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
};

type GroupsClientProps = {
  groups: GroupListItem[];
};

export function GroupsClient({ groups }: GroupsClientProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function closeModal() {
    setIsModalOpen(false);
    setName('');
    setDescription('');
    setError(null);
  }

  async function onCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setError(data.error ?? 'Could not create group');
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Groups</h1>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          New Group
        </button>
      </div>

      {groups.length > 0 ? (
        <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.slug}`}
              className="block px-6 py-4 transition-colors hover:bg-gray-800/60 focus:bg-gray-800/60 focus:outline-none"
            >
              <p className="font-medium">{group.name}</p>
              {group.description ? (
                <p className="mt-1 text-sm text-gray-300">{group.description}</p>
              ) : null}
              <p className="mt-1 text-sm text-gray-400">
                {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-sm text-gray-400">
          You are not in any groups yet. Create one to get started.
        </div>
      )}

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-lg rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h2 className="text-lg font-semibold text-white">Create a new group</h2>
            <p className="mt-1 text-sm text-gray-400">
              Enter a group name and, if you want, an optional description.
            </p>

            <form className="mt-5 space-y-4" onSubmit={onCreateGroup}>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Group name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                  placeholder="The Velvet Static"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Description (optional)</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                  className="min-h-24 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                  placeholder="A space for demo collaborations and mix reviews."
                />
              </label>

              {error ? <p className="text-sm text-red-400">{error}</p> : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isSubmitting ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
