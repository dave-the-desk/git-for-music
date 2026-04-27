import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string }>;
}) {
  const { groupId, projectId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionCookie.value },
    select: { id: true },
  });

  if (!user) {
    redirect('/login');
  }

  const project = await prisma.project.findFirst({
    where: {
      slug: projectId,
      group: {
        slug: groupId,
        members: {
          some: {
            userId: user.id,
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/groups/${groupId}`}
        className="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
      >
        Back
      </Link>

      <section>
        <h1 className="text-2xl font-bold text-white">{project.name}</h1>
        {project.description ? (
          <p className="mt-2 text-sm text-gray-300">{project.description}</p>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No description yet.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Demos</h2>
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white opacity-80"
          >
            Create Demo
          </button>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-8 text-sm text-gray-400">
          No demos yet. Demo creation is coming soon.
        </div>
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
    </div>
  );
}
