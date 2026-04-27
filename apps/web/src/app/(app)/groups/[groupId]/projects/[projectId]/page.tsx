import { prisma } from '@git-for-music/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string }>;
}) {
  const { groupId, projectId } = await params;

  const project = await prisma.project.findFirst({
    where: {
      slug: projectId,
      group: {
        slug: groupId,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/groups/${groupId}`}
        className="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
      >
        Back
      </Link>
      <h1 className="text-2xl font-bold text-white">{project.name}</h1>
    </div>
  );
}
