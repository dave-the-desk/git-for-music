import { prisma } from '@git-for-music/db';
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
    },
  });

  if (!project) {
    notFound();
  }

  return <div />;
}
